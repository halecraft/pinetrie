# S263 — which compaction in a run's end upkeep stalls the host, and can it stay off the event loop?

Numbered S261 until 2026-10-19, when two files held that number.

- **Status:** Open
- **Led to:** ADR-0188

**Question.** In Duane's host log (2026-10-19), each run's end was
followed by the documents' upkeep running 1.3-2.5 s and the event loop
stalling 1.4-2.6 s, 0.6-1.7 s of it on the CPU. Everything the host
awaited meanwhile was held: two refreshes waited 1.6 and 2.5 s in their
shared facts, which ran no command. After a settle, the upkeep
(`planUpkeep`, `apps/pinetrie/host/roots.ts`) compacts the roots the run
changed, the roots it lets go, and the session's three documents
(`pinetrie:session`, `pinetrie:card-places`, `pinetrie:live`).

1. Which of those compactions costs the time, and how does the cost
   split between reading the stored records, taking them into the replica,
   exporting the whole document and writing it?
2. How big is each document now, in records and bytes? S221 measured the
   session at 109 MB on 2026-10-17, 97 MB of it shared-file lineages,
   which ADR-0135 has since trimmed.
3. Can the work leave the event loop, or happen less often: compact a
   document only when what it holds outside its whole record passes a
   size; skip one whose store already holds only its whole record at the
   replica's version; or run the store's reads and writes off the main
   thread?

Read from source before running anything (Kyneta at
`/kyneta/workspace/pineta`):

- **A compaction always reads and rewrites the whole document.**
  `Runtime.#compact` (`packages/exchange/src/runtime.ts`) reads every
  stored record (`loadAll`), takes them into the replica
  (`takeStoredEntries`), then writes `replica.exportEntirety()` as one
  record, deleting what it read (`storeWrite` with the mark).
  `#prepareWrite` makes the whole record whatever changed; nothing skips
  a document the store already holds whole at this version.
- **The store is synchronous.** The host's store is `node:sqlite`'s
  `DatabaseSync` (`apps/pinetrie/host/store.ts`), so every read and the
  write's transaction run on the event loop, between the awaits.

**Measured on a copy of Duane's store** (`pinetrie.db`), cloned as a
file with its journal (`cp -c`) while his host runs, since the host holds
the store's lock, and checked whole (`PRAGMA quick_check`): per document, its records and
bytes; then, for the session's three documents and the largest roots,
the time to read every record, to parse each JSON payload, to serialize
it again, and a transaction that deletes and inserts the same bytes, on
the copy. Those stand in for the compaction's own steps; a replica's
merge and export are Kyneta's and are measured only if these leave the
stall unexplained.

**Kill criterion.** If no document's read, parse, serialize and write
together comes to 0.5 s, the stall is not the compaction, and the spike
turns to what else the upkeep runs (a root's release, its `onReleasing`
listeners, the unloads).

**Throw away.** The copy of the store (`/tmp/s257/`). The probe stays in
`docs/findings/S263-the-run-end-upkeep/` if a plan builds on it.

## Answers so far

Run on Duane's Mac on 2026-10-18 at 21:55 MDT, on a clone of his store
taken while his host ran (`quick_check: ok`), by `probe.ts`
(`mac-output.txt`). 268 documents, 546 MB of records.

1. **The session is no longer the cost it was.** `pinetrie:session` is
   17.4 MB in 22 records, against S221's 109 MB: ADR-0135's trim of
   shared-file tracking took most of it. Reading, parsing, serializing and
   rewriting it came to 251 ms, 186 ms of it the write.
   `pinetrie:card-places` came to 6 ms and `pinetrie:live` to 86 ms. The
   three together are about 0.35 s of the 1.4-2.6 s stalls.
2. **The cost follows a document's record count, not its bytes.** Roots
   held as one whole record took 107-170 ms for 9-13 MB. One of 1,512
   records and 11.4 MB took 1,409 ms, 1,360 ms of it the delete and
   insert of its rows: about 0.9 ms a row. A compaction deletes every row
   it read and inserts two, so its delete is the probe's write half or
   so; how SQLite splits the time between deleting and inserting rows was
   not measured.
3. **A run leaves its root with thousands of records.** Two roots held
   1,512 and 5,637 records not yet compacted, and the second,
   `r-01a151ad-…`, is the root of lane `t-01a151ad-…`, whose run's end in
   Duane's log (run `a6fc7b64`) was followed by a 1.6 s upkeep and a 1.6 s
   stall. A run writes each change to its root as its own record, and
   only its end's upkeep compacts them, so a compaction at a run's end
   reads, takes into the replica, and deletes as many records as the run
   wrote: the cost grows with the run. Taking the records into the
   replica (`takeStoredEntries`) is Kyneta's step and was not measured.
4. **The stall's time off the CPU fits SQLite's synchronous I/O.** The
   stalls were 0.6-1.7 s on the CPU out of 1.4-2.6 s. `DatabaseSync`
   blocks the thread while it reads and writes the file, which the stall
   counts but the CPU does not (inferred, not measured).
5. **A person's attention document is never compacted.**
   `attention:w-duane@…` holds 2,832 records, 12.6 MB. It is Yjs
   (`packages/schema/attention.ts`), which Kyneta cannot compact live
   (S24), and no upkeep names it. It is not in the run's end upkeep, but
   every start loads all of it.

6. **The host writes deltas, not whole values** (`deltas.ts`,
   `mac-deltas.txt`, the same day). The busiest root, `r-01a151ad-…`, held
   one whole record and 7,770 deltas, one batch each: 7,337 ops appending
   to a list (`sequence`, 0.42 KB on average), 1,176 setting a key on one of
   the root's fields (`map`, 1.0 KB), 60 a key one level down, and 23 text
   edits. Its records were 0.6 KB at the median and 5.6 KB at p99. No path
   is rewritten large and often. (The probe printed the paths' segments as
   objects; its fix is in `deltas.ts`, not rerun.)
7. **That root grew from 5,637 records to 7,771 between the two runs,**
   about an hour apart, with no compaction between. Either its lane ran
   the whole hour, or a compaction there did not fold anything: Kyneta's
   `#compact` appends instead, and deletes nothing, when it cannot take a
   stored record in, and says so only by `console.warn` ("could not take
   in the stored entries"). Not yet told apart.

8. **Most of a running root's deltas are pi's crash-recovery frames,
   deleted before any compaction sees them.** The same root, two hours
   on, held 12,291 deltas (`mac-deltas-2.txt`): 11,539 appends to a list
   (84% of its ops, 4.8 MB of 6.9 MB), 2,023 sets of a key on one of the
   root's fields, 101 a key one level down, 54 text edits. The census of
   whole records holds no `lists` at all, so every list appended to was
   deleted again. pi-agent-core 0.99.2 has one list:
   `pi.pending.assistant_frame` (`dist/harness/session/values.js`). Its
   progress appends each frame of a streaming reply to it
   (`openFrameProgress`, `dist/harness/runtime/progress.js`), so a crash
   can resume the reply, and deletes the list when the reply's entry is
   written (`drive/response.js`, `drive/terminal.js`). Each frame becomes
   a stored record and an op in the replica's log, and the run's end
   compaction reads, takes in, and deletes them all. About six frames go
   with each entry. (The segments were printed as objects again: the
   probe now reads Kyneta's `field` and `entry` segments, not rerun.)
9. **What the twelve largest documents hold** (`census.ts`,
   `mac-census.txt`: the session and eleven roots, read from each one's
   whole record):

   | what | MB |
   |---|---|
   | entries | 71.2 |
   | · assistant replies | 39.6 |
   | · · thinking signatures | 15.4 |
   | · · thinking text | 4.1 |
   | · · tool-call arguments | 8.7 |
   | · · usage | 2.5 |
   | · · diagnostics (now counts) | 0.7 |
   | · tool results | 24.4 |
   | · · their text | 19.1 |
   | · custom entries | 4.4 |
   | records | 23.6 |
   | · `pinetrie.shared` (in the session) | 12.8 |
   | · `pinetrie.revision` | 7.6 |
   | · `pinetrie.base` | 2.3 |
   | usage rows | 4.3 |

   A reply's signatures are almost four times its thinking. Shared-file
   lineages are still 12.8 MB of the session's 17.4 MB.

**Still open.** What a compaction at a run's end costs in the host, by
step: the stored records read, taken into the replica, and the rows
deleted. The next measurement is the host's own: the upkeep timing each
compaction, with the document's id and how many records it read.
