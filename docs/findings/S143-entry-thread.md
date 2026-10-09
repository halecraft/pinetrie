# S143 — Every write knows its thread: pi's lane commits carry the lane in their context and their tip write, and a stored row can be given its thread by a migration that moves 3 entries

- **Status:** Answered
- **Led to:** ADR-0125

**Question.** Can every stored entry row name its thread, set when it is
written instead of inferred by walking the tree? That has three parts:
1. Does every commit that writes entries know its thread?
2. Can the existing rows be labelled exactly, and how many does that change?
3. Does the host's migration path add a column to the entry row and rewrite
   every row of a real store?

The problem behind it: `threadEnd` (`packages/core/tree.ts`) takes the
oldest child that starts no thread. A branch's first run writes its context
entries (`pinetrie.canvas` and the others) under the fork, above the chat
that carries `starts`. When the trunk carries on from the same fork, its
end becomes the branch's canvas entry, and its column stops there.

**Kill criterion.** Any of these:
- a pi commit that writes entries during a lane's work and names no lane,
  or two lanes;
- a thread in a real store with no single first entry or no single end;
- a migration that cannot open old rows under the new schema, or loses
  data.

**Throw away.** The instrumentation of `KynetaStorage.commit` and the
migration probe. Both are kept as sources in this spike's folder, since a
plan builds on them:
- `commit-probe.diff`: the logging hook;
- `classify.py`: how its log was read;
- `migrate-probe.ts`: the migration run on a copy of the store.

## Answers

**1. Each lane commit names its lane twice, and the scribe's names none.**
Logged by `commit-probe.diff`, a temporary hook in `KynetaStorage.commit`
(`packages/pi/storage.ts`) that recorded, for every commit that inserts an
entry:
- its `pi.branch.tip` writes;
- the lane its `Context` carries (`laneOf`, `packages/pi/lanes.ts`);
- its entries' kinds;
- its caller.

Classified with `classify.py`.

| run | commits with entries | one tip, context names the same lane | no tip, no lane in context |
|---|---|---|---|
| `vitest run packages/pi apps/pinetrie/host` (539 tests) | 102 | 94 | 2 from `scribe.ts`, 6 from `stored-images.test.ts` committing directly |
| `pnpm run e2e` (55 pass, 1 skip: `live`) | 93 | 86 | 7 from `scribe.ts` |
| `pnpm run conformance` (pi's storage suite, 21/21) | 28 | 1 (tip `main`, not a thread id) | 27 |

No commit wrote two tips, and no context disagreed with its tip. Between
them, the lane commits covered every kind of entry pine·trie writes in a
lane:
- prompts (`pinetrie.chat`, `pinetrie.carry-on`);
- `assistant` and `toolResult`;
- compactions;
- context entries (`pinetrie.pinned`, `pinetrie.behind`, `pinetrie.canvas`);
- a steered `pinetrie.canvas-fact`.

They came through `Lane.prompt`, `appendMessage`, `steer` and `resume`.

The source agrees (`@earendil-works/pi-agent-core` 0.87.1, `dist/harness`):
- **Every write site that inserts an entry for a lane** also writes
  `branchTip(lane.name)` in the same `writes`: `runtime/drive/response.js`
  256–258, `tool-placement.js` 108 and 135, `structural.js` 168 and 186,
  `boundary.js` 79 and 132, `checkpoint.js` 47–48, and
  `session/session.js` `appendToBranch` 322–336.
- **A lane's creation writes its tip and no entry** (`runtime/harness.js`
  105).
- **The caller's `Context` reaches `Storage.commit`**: `Session.mutate(m,
  context)` hands it to `SessionMutator.commit`, which passes it on
  (`session/session.js` 58–71, 182–189).

`thread-lanes.ts` already passes `laneContext(name, CTX)` to every call
that drives a lane, for the tools (S36 item 18), and pi keeps it into the
commits it makes during a run. The scribe passes `BACKGROUND_CONTEXT`.

**2. Duane's store labels exactly, with one rule beyond today's.** Read
from a consistent copy of `.pinetrie/pinetrie.db` (SQLite's backup API on
a read-only connection):
- 140 roots;
- 71,099 entries;
- 202 threads.

Today's `threadAt` gives every entry a thread: none is above every
thread's first message. The labelling rule:
1. A chat that is its thread's first message (`details.starts`, the oldest
   per thread) is in that thread.
2. A context entry (`pinetrie.behind`, `pinetrie.canvas`,
   `pinetrie.task-pinned`, `pinetrie.pinned`) follows its single-child
   chain through other context entries. If the first other entry it reaches
   is a first message, the context entry is in that message's thread.
3. Any other entry is in its parent's thread.

Results:
- Rule 2 moves 3 entries. Among them is noble-cookie's canvas entry, under
  `01a1229f-4fd2…` in root `r-01a12295…`.
- Every thread is then one path, with one first entry and one end.
- All 201 threads that have a lane tip end at it.

A first draft of rule 2 also walked through `assistant` and `toolResult`
entries. It moved 105 entries and put a whole trunk into the branch below
its last reply. So the rule must stop at anything that is not a context
entry.

**3. The host's migration path does it in 16 s.** `migrate-probe.ts` ran
the host's own `migrate` (`apps/pinetrie/host/migrations/index.ts`) on the
copy, with a `Migration` from the root schema's stored hash
(`0275a1b400b7e3a6e6add33f58cfbe0542`, `RootDoc.schemaHash` in this build).
The migration:
- opened every root under a schema whose entry row adds `thread:
  Schema.string().nullable()`;
- labelled every row by the rule above, and dropped `details.starts`;
- wrote each root in one batch, and compacted.

Measured:
- **Old rows open under the new schema**, their `thread` reading as `null`.
- **The run:** 140 documents, 71,099 rows, 3 moved, none left without a
  thread, in 16.2 s.
- **Reopened from the file:**
  - all 140 roots' stored hashes are the new schema's;
  - no row lacks a thread, and no chat keeps `starts`;
  - 202 threads, 201 of 201 lane tips at their thread's end;
  - hearty-pigeon (`t-01a12295-0ffc-7d1b…`) ends at `01a122ce-ae8a…`,
    its lane's tip, where today's `threadEnd` gives noble-cookie's canvas
    entry.
- **Size:** root records 344 MB → 346 MB of payload after compaction. The
  SQLite file grew from 496 MB to 797 MB, 325 MB of it free pages that
  later writes reuse. Add the `backup` copy, about 0.5 GB.

**4. A non-null column works the same.** The same probe was run with
`thread: Schema.string()` (no `.nullable()`), on a fresh copy of the store
(71,185 rows by then).
- **An old row reads with the key present**, `thread: ""`: Kyneta fills an
  absent field with the schema's default.
- **The migration's results were the same:**
  - 3 moved, none left without a thread, in 15.5 s;
  - after reopening, every root on the new hash, no row without a thread;
  - 201 of 201 lane tips at their thread's end, hearty-pigeon at its tip.

`""` is not a thread id, so the migration treats it as unlabelled. Since a
store on the old hash is refused unless migrated (ADR-0096), no reader ever
meets it.

## Decision this supports

- A stored entry row gets a typed `thread` column, never null.
- A commit's thread is the one its `Context` names: `laneContext` for a
  lane, and the same key from the scribe for a lane-less append. A tip
  write for another lane in the same commit is an error.
- A commit that writes entries and names no thread throws. pi's
  conformance suite, which commits entries outside any thread, gives its
  storage a fallback thread; the host gives none.
- A one-time migration labels the existing rows by the rule above.
