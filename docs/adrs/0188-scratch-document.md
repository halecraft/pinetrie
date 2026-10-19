# ADR-0188 — pi's pending state lives in a scratch document named by its root, which exists only while a run in that root needs it, and a document is compacted only once its stored changes outweigh its whole record

Numbered ADR-0185 until 2026-10-19, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/pi/TECHNICAL.md`
- **Evidence:** S263, S262, S221
- **Amends:**
  - ADR-0003: `KynetaStorage` writes pi's `pi.pending.assistant_frame` and
    `pi.pending.tool_output` to a scratch document of the lane, every other
    namespace to the root, splitting a commit in one fixed order.
  - ADR-0162: the upkeep compacts a document only once its stored changes
    outweigh its whole record, never because a run settled or a root leaves
    memory; it destroys a root's scratch document once no run needs it.
- **Revised:**
  - 2026-10-19: the scratch document is named by its root, not its lane: a
    root is one pi session, one `KynetaStorage`, for every lane branched from
    it, and naming by the lane would rest on every pending read carrying its
    lane, which nothing measured. And the root's writes are stored before the
    scratch document's deletes by waiting for the store, not by the order of
    the writes: Kyneta orders a store's calls per document only
    (`serialStore`).

**Context.**

- **A run's end freezes the host.** In Duane's host log, each run's end
  was followed by the documents' upkeep running 1.3-2.5 s and the event
  loop stalling 1.4-2.6 s. Everything awaited meanwhile was held: pages,
  commands, your repo's steps.
- **The upkeep rewrites whole documents, however little changed** (S263).
  A Kyneta compaction reads every stored record of a document, takes them
  into the replica, writes the whole document as one record, and deletes
  what it read. The upkeep does that at every settle for the roots runs
  changed and the session's three documents (17 MB together, about
  0.35 s), and for every root it lets go. The store is synchronous, so all
  of it runs on the event loop.
- **The cost follows the number of records, not their size.** On a copy
  of Duane's store, rewriting a root of 1,512 records (11.4 MB) took about
  1.4 s, about 0.9 ms a record; roots held as one whole record of 9-13 MB
  took 0.1-0.2 s (S263 item 2).
- **Most of a running root's records are pi's frames.** While a reply
  streams, pi appends every frame pi-ai encodes to
  `pi.pending.assistant_frame`, one commit and so one stored record a
  frame, and deletes the list when it writes the reply's entry. In a
  running root they were 84% of the stored changes (S263 item 8). Duane's
  running lanes held 1,323 frame records for 16 replies (S262 item 6).
  None of them outlives its reply: they cost the run's end its
  compaction, and every tab holding the root a sync each, and leave
  nothing behind.
- **Writing them as Kyneta's own changes does not help enough.** Grown
  in place as text edits, a reply stored 0.82 of today's bytes and as
  many records: Kyneta's envelope around an op is about 200 bytes against
  a 15-19 character delta. Records fall only when several frames share a
  write, by the same amount in either form (S262 items 3 and 4). Kept out
  of the root, a reply leaves one record there, its entry: 0.01 of
  today's records, 0.07 of its bytes.
- **pi's commits can be split safely.** A commit ending a reply writes the
  entry, its usage, the branch's tip and the operation's new state with
  the frames' delete; one adding pending data writes it with the state
  that points at it (S262 item 7). Operation-scoped pending data is
  deleted by the operation's cleanup; a queued message's
  `pi.pending.entry` can outlive an operation (S262 item 8).
  `KynetaStorage`'s `seq` is local and never stored, so one index can
  observe two documents (S262 item 9). A root is one pi session for every
  lane branched from it, so one `KynetaStorage` serves them all.

**Decision.**

- **A scratch document, named by its root** (`scratch:<root>`, json,
  written only by the host, held by no tab), holds pi's `pi.pending.assistant_frame` and
  `pi.pending.tool_output`, with a tool output's `checkpointText`.
  `pi.pending.entry` and every other namespace stay in the root.
- **`KynetaStorage` routes by namespace.** Each write and each read goes to
  the document its namespace names, and one arrival index observes both,
  so pi's seqs and its conformance suite are as before.
- **A commit is written in one order:** the scratch document's sets, then
  the root's writes, then the scratch document's deletes, and each part
  that follows a part in the other document waits until the store holds
  that part. A crash between any two leaves pending data that nothing
  points at, never a state that points at pending data that is gone. pi
  never commits a scratch set with a root write, so in practice only a
  commit that ends a reply or a tool waits, once.
- **It exists only while a run in its root needs it.** Its name is the
  root's, so a root has at most one, and recovery finds it as it loads
  the root, without knowing which run left it. It is made by its first
  pending write, held
  with its root, and loaded with the root when one is stored, so recovery
  after a crash reads it as today. The upkeep destroys it once no lane of
  its root runs and it holds nothing: pi's operation cleanup empties it.
  One that still holds something (a run a crash ended) stays until a run
  there has recovered. Between runs, a root has none. It is never
  compacted.
- **A document is compacted only once its stored changes outweigh its
  whole record:** when the bytes of its records after the whole one pass
  the whole one's bytes, or their count passes 1,000. The upkeep reads
  both from the store's table in one query per document, and compacts
  only those over. A settle no longer compacts the session's documents,
  nor does a root's leaving memory compact it: Kyneta unloads a document
  only once the store holds every write.
- **The upkeep says what it compacted.** Each compaction it runs is
  timed, and one longer than half a second is logged with the document,
  the records it read and how long it took, as a slow step is.

**Consequences.**

- **A run's end no longer reads, takes in and deletes the run's frames.**
  A root that held 13,700 stored changes would hold about 2,200; whether
  it is compacted at all is the threshold's call. S263's rates put a
  run's end at a few hundred milliseconds rather than 1.5-2.5 s, and no
  longer growing with the run. That is a forecast from stand-ins for
  Kyneta's steps, not a measurement in the host; the upkeep's log of each
  compaction is what confirms it on Duane's next runs.
- **Tabs holding a running root no longer receive each frame.** Today
  every frame reaches every tab that holds the root, which merges it and
  then its delete, and no tab reads them: a streaming reply is shown from
  `pinetrie:live`, its finished one from its entry. So a tab loses
  nothing, and saves that traffic and merging. A page that followed a
  reply from the root itself would need the scratch document shared too.
- **Storage barely changes:** the frames never outlived their reply. What
  stays on disk is tool results, thinking signatures and shared-file
  lineages (S263 item 9), each a decision of its own.
- **A root loaded after a crash loads its scratch document too,** one
  more read for a root a run was in.
- **Lanes of one root running at once share it.** pi's keys already name
  the operation, so they do not meet; it is destroyed when the last of
  them ends.
- **The thresholds are first values.** The upkeep's log is what tunes
  them: a document whose load grows slow behind its records lowers them.
- **Nothing migrates.** A root's frames from before are deleted by pi as
  it settles each reply, and their records go at the root's next
  compaction.

**Alternatives rejected.**

- **The reply grown in its entry by Kyneta's text edits.** Recovery
  folds to the same message, but records follow writes: it stores as
  many records as today and 0.82 of the bytes (S262 items 1-4).
- **Several frames to a write.** It cuts records in either form, by the
  frames each write carries, which depends on how fast they arrive, and
  that is not measured. The scratch document takes them all out of the
  root whatever their pace.
- **The frames in a plain table of the host's store.** It holds them as
  cheaply, but outside Kyneta: its own writes, its own recovery read, and
  nothing a later use (a tab following a reply from the frames) could
  share.
- **A scratch document named by its lane.** One `KynetaStorage` serves
  every lane of a root, so it would choose a lane's document by the lane
  each call's context names, which every write carries but no one has
  shown every pending read does.
- **A scratch document named by its run.** A run resumed after a crash,
  a new run, would have to find the crashed run's document by an id
  recorded elsewhere.
- **One kept for the root's whole life.** Emptied between runs, it would
  still be loaded with its root and hold a document's records for nothing.
- **Relying on the order the writes are made.** Kyneta runs a store's
  calls on different documents concurrently (`serialStore`), so a delete
  made after a root write may be stored first.
- **One per reply.** A document made and destroyed for each reply, with
  nothing gained over one per lane.
- **Moving the store off the event loop.** It would take the stall off
  the loop for every document, but the work would remain, and it is a
  change to Kyneta's store, not to what the host asks of it.
