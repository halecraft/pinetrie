# ADR-0125 — Every entry names its thread, in a column of its row, set by the commit that writes it

- **Status:** Accepted (Duane, 2026-10-09)
- **Area:** `packages/schema/TECHNICAL.md`
- **Evidence:** S143
- **Amends:**
  - ADR-0117: each entry of a thread names it, not only its first message.
  - ADR-0015: the entry row has a sixth typed column, `thread`.

**Context.**

- **Only one entry says which thread it is in.** ADR-0117 gave every thread
  an id, recorded on its first message alone (`ChatDetails.starts`).
  Everything else is inferred by walking the tree (`packages/core/tree.ts`):
  - `threadAt` walks up to the nearest first message;
  - `threadEnd` walks down from the first message, taking the oldest child
    that starts no thread.
- **The walk relies on a rule nothing checks.** It needs a branch's first
  entry to be the chat that names it. A run writes its context entries
  (base news, the canvas list, the cards pinned to the task and to the
  thread) before its prompt, in one commit. So a branch's first run puts
  them under the fork, above that chat. ADR-0116's canvas entry is written
  on almost every branch's first run.
- **When the trunk carries on from the same fork, it loses its end.**
  `threadEnd` takes the branch's canvas entry, which is older, and stops
  there. The trunk's column ends at the fork. Its own continuation is drawn
  as a closed branch, "⑂ 3 messages", which opens nothing.
- **Every reader of a thread's end inherits the error:**
  - the race check, and where a remark in a thread with no lane lands;
  - cards kept at a thread's end;
  - the snapshots archiving keeps;
  - the inventory's preview;
  - the rail, whose oldest child continues the track.
- **Each new kind of entry written ahead of a branch's first message would
  break it again.**

**Decision.**

- **Every entry row names its thread**, in a typed column, `thread`,
  beside `parentId`. pine·trie types what it traverses (ADR-0015), and it
  traverses this.
- **An entry is in the thread that writes it.** A commit's thread is the
  one its pi `Context` names:
  - the key every call that drives a lane already carries, for the tools;
  - the same key from the scribe, for a message in a thread with no lane.

  pi keeps a lane call's context in every commit of its run (S143). A
  commit that also moves another lane's tip is an error.
- **Every entry is written in a thread.** The column is never null, and a
  commit with entries whose context names no thread throws. The only storage
  given a fallback thread is the one pi's own conformance suite drives,
  since its commits name no thread. The host gives none.
- **A thread's first entry, its end, and an entry's thread are read, not
  inferred.** The index keeps each thread's first entry (whose parent is in
  another thread, or none) and its end (with no child in its own thread).
  When two replicas could disagree, the oldest first entry and the newest
  end win. `ChatDetails.starts` is deleted.
- **On the rail, a child continues its parent's track when it is in its
  parent's thread.**
- **Stored rows are given their thread once, by a migration.** It labels
  each row by today's rules, plus one: a context entry belongs to the first
  message below it, through other context entries alone, when that message
  starts a thread. It drops `starts` from every stored chat, and refuses
  to write if any row would be left with no thread.

**Consequences.**

- **The root schema's hash changes**, so a store that has not run the
  migration is refused at startup (ADR-0096). On Duane's store the
  migration took 16 s and moved 3 entries. Every thread is then one path,
  and each lane's tip is its thread's end (S143).
- **Every stored row is rewritten once.** After compaction the roots'
  payload is about what it was. The SQLite file keeps about 300 MB of free
  pages, and the migration's backup copy needs room for the whole store.
- **History is edited once more**, as ADR-0117's naming of first messages
  edited it. Entries stay immutable in every other sense (ADR-0004).
- **Colours change where the bug was.** In those roots, the trunk takes
  back the trunk's track on the rail and in its column.
- **The write side has one check that fails loudly.** An entry written
  through a path that names no thread throws in the host, where before it
  would have been inferred into the wrong thread.

**Alternatives rejected.**

- **Widen the walk**: a context entry on a single-child chain to a first
  message belongs to its thread, in `threadAt`, `threadEnd` and the rail.
  No migration, but every reader keeps a special case, and the next kind of
  entry written ahead of a branch's first message breaks it again. The rule
  is used once, in the migration.
- **Mark the first entry of a branch, whatever its kind.** It keeps one
  marker, but a writer must know which of its entries comes first, every
  kind of history message must carry the marker, and readers still walk.
- **A thread record that stores its end.** A pointer written on every
  append: it repeats the lane's tip, can race, and can go stale. A column
  set by the write cannot disagree with the tree.
- **The thread inside `payload`.** `payload` is pi's, sealed; what
  pine·trie reads is a column (ADR-0015).
- **Take a lane commit's thread from its tip write.** Every lane commit that
  writes entries moves its lane's tip (S143). But a message in a thread
  with no lane moves none, so that would need the context too: two
  mechanisms where one does. The tip stays as a cross-check.
