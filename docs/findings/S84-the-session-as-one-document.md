# S84 — the session as one document: what compaction rewrites, and why

- **Status:** Answered
- **Led to:** ADR-0063

Measured on a copy of the person's `.pinetrie/pinetrie.db` (2026-10-03, mid-run),
read with `node:sqlite` in a lane. Kyneta read at
`kyneta/workspace/pineta`. Disposable probes, not committed. ADR-0063 acts on
it: a root is a document, and what is streaming is another.

**Answers.**

1. **Kyneta stores a document as a log of small deltas. The one large row comes
   from pine·trie's compaction.** Since the last compaction, `pinetrie:session` had
   gained 1,438 delta records, 1.7 MB in all, beside one entirety record of
   124.3 M characters. Each write appends `exportSince(confirmed)`
   (`Runtime.#prepareWrite`). Only `compact()` replaces the log with
   `exportEntirety()`, which is one `JSON.stringify` of the materialized state
   (`schema/src/substrates/plain.ts`, `exportEntirety`).
2. **A compaction rewrites about 124 MB to drop well under 1 MB.** Of those 1.7
   MB of deltas, the parts a compaction removes were streams (`streamText` 176
   KB, `streams` 7 KB) and the transient `lists` (520 KB; empty in the state).
   The rest is `entries` (271 KB) and `values` (385 KB), which the entirety
   keeps. The entirety itself holds `entries` 106 MB (22,310), `values` 5.7 MB
   (11,959) and `usageRows` 4.2 MB (10,710). Streams, lists, checkpoints and
   active runs are all empty.
3. **Splitting by root would bound each document well below the limit.** The
   22,310 entries are in 57 roots. The largest has 2,114 entries (13.6 MB),
   the 90th percentile 5.6 MB and the median 0.9 MB. No root comes within 39×
   of V8's string limit (2^29−24).
4. **Every consumer of the whole document pays for all of it.** The browser
   keeps no store (`packages/client/session-view.ts`: an `Exchange` with
   transports only), so every tab load starts at genesis, which is behind the
   compacted base. The host then materializes and stringifies the entirety
   again for that tab. `exportEntirety` caches nothing, and the WebSocket
   transport does not compress.

## Why it is built this way

Each choice was sound for what was known when it was made:

- **One document is the session (ADR-0021: "a session is one document, and
  the boundary of who is in it").** pi's `Storage` port is one session, and
  `KynetaStorage` implements it over one document (ADR-0003). ADR-0029 later
  made roots into tabs, "splitting the session where context splits", but
  only in the interface: storage stayed one document.
- **Transient and permanent state share that document.** Immutable entries
  (ADR-0004) sit beside streams, pi's pending lists, checkpoints and active
  runs (ADR-0014, ADR-0022). Compaction exists to reclaim the transient part
  (S22, S25), and in Kyneta a document is compacted whole. So reclaiming a
  stream means rewriting every entry ever written.
- **ADR-0023 moved the session to `json` on measurements of a few hundred KB**
  (S24: 327 KB → under 1 KB). It said the store is bounded "by the session's
  current state". That is true, but entries are never deleted, so the current
  state is the whole conversation. Kyneta describes its plain substrate as
  "the default binding when no CRDT is needed (`Schema.string`, small configs,
  ephemeral UI state)" (`packages/schema/TECHNICAL.md`, "The plain
  substrate").
- **Compaction runs at every run end and at startup** (`host/settle.ts`,
  `host/housekeeping.ts`). Both are fixed triggers, with no size threshold.

## What Kyneta offers that pine·trie does not use

In Kyneta the document is the unit of storage, compaction, sync and memory:

- **Many documents.** pine·trie already uses one per card and per inventory. The
  session could be one per root, plus one for transient state.
- **`unload`** takes a stored document out of memory and loads it again on
  `get` (exchange `TECHNICAL.md`, "Suspend, unload, destroy"). An archived
  root would cost nothing until it is opened.
- **Interest per document.** A client syncs only the documents it `get`s, so a
  tab would fetch its own root rather than every root.
- **A client store** (`@kyneta/indexeddb-store`): a reload asks for a delta
  from the version it holds, as long as the host has not compacted past it.

## Addendum: where each value belongs, and two costs beside storage

- **Every value has an owner a root can be found from.** Most are keyed by
  lane: `pi.branch.tip`, `pi.lane.config`, `pi.lane.state` (81 each),
  `pinetrie.lane`, `.name`, `.offer`, `.banner`, `.base`. Some are keyed by
  entry: `pinetrie.revision` (10,746), `.landing`, `.mark`, `.stop`. `pinetrie.archive`
  is keyed by root. `pi.result`, `pi.op.meta` and `pi.op.state` name a lane in
  their value. Usage rows name their `entryId`. Five are session-wide, one
  record each or close to it: `pinetrie.project`, `.commands`, `.participant`,
  `.seat` and `.line`.
- **Each new entry rebuilds the whole tree index.** `readTreeIndex`
  (`packages/reads`) is memoized on the `entries` snapshot. The host's
  commands and the client's `readSessionFacts` call it, so every committed
  entry indexes all 22,310 entries again.
- **pi's earlier thinking is dropped once a lane's tools or system prompt
  change.** All 3,926 replies that carry diagnostics report `thinking_dropped`,
  237,599 blocks in all, every one `prefix_binding_mismatch`. The cause is in
  S85.

## Addendum: the three open questions, probed

The probes are in `.plans/s84-probe/`, not committed. Each ran in a lane over
the copied session's entirety, with a real `Exchange` over `openStore`'s
SQLite store.

1. **A pi session and harness per root costs almost nothing.** `createAgent`
   over its own document, with a scripted model, took 0.35 ms and 49 KB of heap
   each at 300, and a run 2.8 ms. A real host would share the model setup and
   tools, which `createAgent` builds each time here. pi's harness holds
   per-session state only (`Harness`: lanes, hooks, config), and serializes
   commits per session, so roots would not wait on each other.
2. **Every record routes to a root or the session.** Routing the copied state
   (entries by parent, values by owner as above, `pi.result` by its `tipId`)
   left 8 records with no root: 3 usage rows whose entry is gone, and 5 values
   of lanes with no tip. 60 documents in all.
3. **Split per root, compaction and loading become cheap:**

   | | one document | per root |
   |---|---|---|
   | compact | 1,498 ms | 182 ms for the largest (2,114 entries), 18 ms median |
   | load from the store | 955 ms | 139 ms for the largest, +24 MB heap |
   | unload all | | 186 MB of heap freed |

   That is the probe's own single delta record, not the host's store. The
   host's real compaction also reads every record back first
   (`Runtime.#compact` calls `store.loadAll`), so at every run end today it
   reads and parses the 124 MB record before it writes the next.
4. **Trimming memory without rewriting storage needs no Kyneta change.**
   `Runtime.compact` already trims (`replica.advance`) before it writes, and
   skips the write only when there is no store. But compacting just the root
   that ran, at its run end, costs under 200 ms, so a document that only grows
   by entries can simply be compacted.
5. **Streams and active runs need a stored `json` document.** Kyneta has one
   transient tier, `ephemeral` (`Durability`, `schema/src/substrate.ts`), and
   its laws exclude `positional-ot`, so it cannot hold a `Schema.text()`. A
   small `pinetrie:now` on `json`, compacted at every run end, holds only what is
   streaming. The live handover (ADR-0044) needs the tip and the entry in one
   change. Both stay in the root's document.

## Open

- **Session-wide values.** `pinetrie.seat`, `.participant` and the rest are
  written through pi's `session.setValue` today. The session document could
  be a pi session with no entries, or be written through `packages/schema`.
- **Atomicity.** A pi commit is one batch on one document. Anything that now
  writes a root and the session-wide document together, like a root's
  archive record and the root itself, becomes two changes.
- **Migration.** The routing in addendum item 2 is a dry run of a one-off
  script that splits `pinetrie:session` into per-root documents.
