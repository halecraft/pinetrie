# S22 — a tool run through Pineta's storage

**Answers.**
1. **Tool calls and results store and reload intact**, but Pineta's projections
   hide them. An assistant message's tool calls render as nothing, and tool
   results are dropped.
2. **A run's assistant messages each stream on their own**
   (`message_start` … `message_end`). Pineta streams per *run*, so the second
   message's live text is added after the first's, which is already shown as
   committed.
3. **A restart over a Kyneta store resumes the thread.** The lane comes back
   with its tip, and it runs again. A Kyneta SQLite store over Node's built-in
   `node:sqlite` survives a real process restart.
4. **Abort works mid-tool.** The run ends at once, the tool result is recorded
   as "Command aborted", and the lane takes the next prompt.
5. **pi writes several full copies of a long command's output.** For a
   51 KB result, the store grew 309 KB. `pi.pending.tool_output`, a checkpoint
   of the whole output every 2 s, accounted for 235 KB of the writes.
6. **Written as text edits, the output costs roughly what the command
   printed.** Replaying the live updates as whole values appends 4.35 MB; as
   "cut the front, append the end" text edits, 96 KB.

## Why it was asked

Before giving the agent pi's editing tools (`read`, `write`, `edit`, `bash`),
four things were unmeasured:
- what their calls and results look like in Pineta's storage and projections;
- how a run with several model turns streams;
- whether a session survives a restart, which self-editing needs;
- what streaming a tool's output would cost in a CRDT document that keeps
  every write.

## Result

The real stack: `KynetaStorage`, `StorageBackedSession` and
`createAgentHarness`, with pi-agent-core's four tools over `NodeExecutionEnv`.
The model is pi-ai's `faux` provider, scripting tool calls, so every run is
deterministic. The document lives in a Kyneta `Exchange` with a store, and
every write through `KynetaStorage.commit` was logged.

**Q1: read a file, then answer.** Stored, in order:

| stored | Pineta's projection |
|---|---|
| `user(text)` | the question |
| `assistant(text + toolCall)` | "Let me look.", with the call invisible |
| `toolResult(text)` | dropped |
| `assistant(text)` | "The word is MANGO." |

An assistant message that is only a tool call would render as an empty agent
message.

**Q2: events for that run.** Each message has its own `message_start`,
`message_update`… and `message_end`, with `tool_start` / `tool_end` between.
The harness names its tool events `tool_start`, `tool_update` and `tool_end`.
The `tool_execution_*` events in pi's types belong to its older agent loop,
and the harness never emits them.

**Q3: restart.** The first `Exchange` was shut down, and a second one opened
the same store:
- `harness.lanes()` lists the lane at its old tip, and all 13 entries are there;
- a new prompt continues the thread: 12 messages, first to last.

A second probe wrote through `@kyneta/sqlite-store` over `node:sqlite` in one
process, and read the same value back in a new process.

**Q4: abort 400 ms into `sleep 3`.**
- The run returned at 404 ms.
- The tool result is `Command aborted`.
- `inspectExecution` shows the lane idle, and the next prompt ran.

**Q5: a long `bash`.** 400 lines of random base64 over about 12 s: roughly
80 KB printed, of which pi keeps the last 51,029 characters. There were 123
`tool_update`s.

| written through storage | writes | bytes |
|---|---|---|
| `pi.pending.tool_output` (checkpoints) | 7 | 234,655 |
| entries (including the 53 KB tool result) | 4 | 53,426 |
| `pi.pending.entry` | 2 | 52,140 |
| op, lane and branch state | 22 | 9,137 |
| `pi.pending.assistant_frame` | 17 | 4,503 |

| where it lands | growth |
|---|---|
| store (the append-only record stream) | **+309,238 bytes** in 31 records |
| document snapshot | +171,212 bytes |

No `pi.pending` value is left after the run, but deleting a value does not
remove it from Loro's history or from the store.

**Q6: the same 123 updates, replayed into fresh Loro documents.** "Appended" is
the sum of each commit's update, which is what a store appends. The stream is
cleared at the end, as `endStream` does.

| replayed | appended | snapshot after clearing |
|---|---|---|
| every update, as whole values | 4,354,829 | 1,329,976 |
| every update, as tail edits | **96,008** | 85,224 |
| 6 checkpoint-like updates, as whole values | 201,180 | 100,088 |
| 6 checkpoint-like updates, as tail edits | 83,288 | 82,422 |

**Tail edits, not a plain splice.** pi keeps only the tail of the output, so
once output passes its limit each snapshot has lost lines at the front *and*
gained lines at the end. A single common-prefix/common-suffix splice then
shares neither end, and degrades into replacing everything: 2,517,737 bytes
appended in the first attempt. The edit that works is to find where the new
snapshot begins inside the old one, delete the front up to there, and append
the rest. A snapshot that doesn't fit that shape falls back to one splice.
The replay checked the text after every edit against the snapshot.

**Compressible test data hides all of this.** A first run printed `line N`
plus 200 `x`s. The document then grew only 10.8 KB, and whole values looked
*smaller* than edits, because Loro's snapshot compression squeezed the
repeats. Real output (test logs, file contents) doesn't compress like that.

## Consequences

1. **Projections must admit tool calls and tool results.** Columns show a call
   as a compact row, with its result expandable. The model's context is
   unchanged: pi builds it.
2. **Stream per assistant message, not per run.** Begin at `message_start` and
   clear at `message_end`. A run then never shows text twice.
3. **Tool output streams as a `Schema.text()` keyed by tool call,** written
   with tail edits from each `tool_update`, and cleared at `tool_end`. The tool
   result entry is the durable record, as ADR-0014 does for text.
4. **`KynetaStorage` routes `pi.pending.tool_output` into text written with the
   same edits** (ADR-0015's typed routing). pi's crash recovery is unchanged,
   and its checkpoints cost about 2.4× less. `pi.pending.entry` (one pending
   copy of the result) and the committed entry remain.
5. **Everything written stays**, in the Loro history and the store. What is
   written is the only lever until the store can be compacted; `compact()` on a
   live Loro substrate still throws (reported to Kyneta). That report is now
   more pressing: every tool run grows the store for good.
6. **Persistence is a configuration step:** `@kyneta/sqlite-store` over
   `node:sqlite`, with no native dependency. Lanes restore with no Pineta code
   beyond what `hasLaneRecord` and `planStartup` already do.
7. **A stop command maps directly to `lane.abort`.**

## Method

Two disposable probes in `packages/pi`, not checked in, run with `node`: one
for the tool run and one for SQLite across two processes. The faux model made
Q1–Q6 deterministic. Q5 and Q6 ran three times, and the tables show the
first run. Across the three, with the random output and timing varying:

| measure | range |
|---|---|
| tool updates | 123–136 |
| store growth | 309–352 KB |
| `pi.pending.tool_output` writes | 231–235 KB |
| every update as whole values | 4.35–4.81 MB |
| every update as tail edits | 96–97 KB |

## Addendum: measured in the host, and a Kyneta store redundancy

Implementing the plan (`PLAN-2026-09-27-agent-tools`) measured the same long
`bash` through the real host, with a SQLite store:

| stored for 82 KB printed, a 51 KB result | bytes |
|---|---|
| store records (blob + payload) | about 345 KB, in about 87 records |
| of which, records that repeat an earlier record's operations | about 133 KB, in 6 records |
| SQLite file growth | about 520 KB (page overhead for large blobs) |

The pieces are what the design predicts:
- the live tool stream, as tail edits: about 109 KB in about 80 small records;
- pi's checkpoints, as edits: about 72 KB;
- pi's pending copy of the result and the committed result: about 52 KB each.

The rest is Kyneta's store repeating itself.

**The redundancy.** Each store record is a Loro update exported "since" a
version. In `packages/exchange/src/runtime.ts`, `#persistIfAdvanced` computes
`exportSince(confirmedVersion)`, the version of the last *completed* write. When
a change arrives while a write is still in flight, its delta therefore starts
from before that write, and repeats everything the in-flight write carries. In
the run above, pi's commit of its 52 KB pending entry was still being written
when the host closed the tool's stream. The close's record then held the
52 KB again. `decodeImportBlobMeta` shows it: that record's operation range
starts where the previous record's starts.

The existing dedup there (`#versionAlreadyTargeted`) catches two writes that
target the *same* version, not overlapping ones. Imports are idempotent, so
nothing is wrong, but the bytes are stored twice, and the redundancy grows with
the size of whatever write was in flight.

**Fixed in Kyneta** (locally, not yet released). The store program now asks for
a write owed, and the runtime reads the replica when each write *starts*
(`#prepareWrite`), so a write behind another diffs from the version that one
confirmed. Re-measured on the same run, three times: **0 overlapping records**
(before: 6, holding 133 KB); the whole store about 297 KB, where the bash run
alone had added about 345 KB. Replaying the records rebuilds the session, and
Pineta's gates pass on it, the restart over the store included (the e2e figure
for the run fell from 343 KB to 287 KB). Kyneta's own tests for the change
could not be run from Pineta's sandbox.
