# `@pineta/marginalia` — technical notes

The notes and links people write in the margins of the agent's work. Each shape
is stored in pi's extension slots and typed here, by Pineta, which is its single
authority. Every module decodes through `decodeWith` (`decode.ts`), which is
total: a malformed value is dropped, never thrown.

Namespaces are stored data and name the owner, `pineta.`, following pi's own
`pi.` convention. They deliberately do not follow the package name: renaming a
package must never require changing stored data. This package was
`@pineta/references`; its namespace is still `pineta.reference`.

# Chat (`chat.ts`)

A human message is a pi `CustomMessage`, `customType: "pineta.chat"` (ADR-0018).
`content` is the attributed text the model reads ("Alice: …"); `details` hold
the author (a `WriterId`, from the transport), the display name as written, the
text, and the `Responder` it compels. `encodeChat` and the total `decodeChat`
are the only code that builds or reads the shape.

- **Who a message is for is `address`** (`@pineta/core`, ADR-0021): `@agent`
  asks the agent; a message naming only participants is for them; with no
  mention that resolves, the thread decides (`agentByDefault`: the agent where
  the thread has a lane or the column is a Start Agent column, and never by a
  lane's default for a `branch`, which is a new thread). A handle resolves
  against `participants`: every named writer and every writer in the tree,
  guests by their `guest-…` label, through `handleOf`: letters and digits in
  any script, `_` and `-`, lower-cased and composed (NFC), so "José" typed
  either way is `@josé`. An unknown handle (`@types/node`) is ignored, so it
  never silences the agent; `normalizeName` refuses a name with no handle, or
  the handle `agent`.
- **`planChat` decides what a message does** (ADR-0020), over the thread
  `threadOf` gives, and names exactly where to write:

  | a message… | no lane | idle lane | busy lane (running, or messages waiting) |
  |---|---|---|---|
  | plain | `appendToTree` at the end | `appendToLane` | `hold` |
  | compelled `reply`, not raced | `createAndRun` at the end | `run` | `conflict` |
  | compelled `reply`, raced | `conflict` | `conflict` | `conflict` |
  | compelled `queue` | `createAndRun` | `run` | `hold` |
  | `branch` | plain: `appendToTree` at `at`; compelled: `createAndRun` at `at` | the same: a branch never continues a lane | the same |

  A race is another writer's compelled message on the thread's path since what
  the sender saw; plain remarks, agent replies and sibling forks are not. A
  `branch` at a lane's tip is stepping down: a new thread there, the lane left
  where it is.
- **Each chat stores its send's id** (`sendId`, the command's id), so the
  column that sent it finds it exactly (`TreeIndex.bySend`).
  `detailsFromStored` is the one conversion of stored details, for a chat and
  for a held message alike.
- **`entryText` is the one definition of an entry's citable text**: a chat's
  own `text`, never its attributed `content`, so a span covers exactly what its
  author wrote. The host's citation path reads through it.
- **`renderableMessage`** turns a stored chat into role `chat` with its author
  and whether it compelled the agent, for `core`'s projections, which only
  admit the role and so need no schema library.
- **Names are labels, never identities** (`participant.ts`). The name is copied
  into each message, so a rename never rewrites what the agent already read,
  nor invalidates the provider's prompt cache.

# The outbox (`outbox.ts`)

A thread's lane is never written while it runs (S21), so every message for a
busy thread waits in `pineta.outbox`, keyed by its own id (ADR-0016), with a
total decoder like every shape here. Ids are uuidv7, so `heldMessages` sorts
into send order, and `nextHeld` takes a lane's oldest. "A lane with messages
waiting" counts as busy even between two of them, or a new message would jump
the queue. The host executes three pure decisions from here:

- **`planDrain`**: when a lane's run ends, its oldest held message is appended
  (plain) or run (compelled); that run's end brings the next step. A plain
  message is released only once it is written, so a refused append stays held.
- **`settleRun`**: a compelled message pi refuses to run is kept, appended with
  no reply, rather than lost; the author already heard `started`.
- **`planStartup`**: a starting host drains every lane with messages held for
  it, since no run's end will. What does not survive a process (runs and
  streams) is cleared first, by `clearStreams` in `@pineta/schema`.

# Notes (`note.ts`, ADR-0025)

A note is a message opened for everyone to edit, or a draft of a thread's next
message. Its text is its own Yjs document (`NoteDoc` in `@pineta/schema`); its
record is a host-written `pineta.note` value keyed by note id, typed here as
`NoteRecord` (`@pineta/core`) and stored through `encodeNote`/`decodeNote`.

- **`subject` says what a note is the text of**, as a union: an opened
  message's entry; a draft's place, kept as a send carries it (where it was
  started, and its column's lane); or, once sent, the send's id. `noteEntry`
  finds its message (a sent draft through `TreeIndex.bySend`, so a draft still
  waiting in an outbox has none yet); `noteAt` is where it sits now, a draft at
  its thread's end.
- **A draft is resolved, never stored as an end.** `noteAt` runs `threadOf` from
  its place, as a reply from there would be sent, so the draft follows its
  thread as the thread grows. `draftFor(end, …)` is the draft whose resolved end
  is `end`: one per thread end.
- **`planNote` decides every action**, pure: `open` (a new note seeded with the
  entry's text, or the one it has), `draft` (the thread's draft, or a new one;
  what its requester had typed is theirs), `send` (only a draft; the host sends
  its text through `sendChat`, the one send path, and marks it sent on
  `appended`, `started` or `queued`), `done` and `reopen`.
- **`planNoteEdit` decides what one edit changes**, pure: contributors are the
  `clientID`s whose clocks moved, as known writers (`noteAuthors`), in order of
  first edit; an unknown `clientID`, the host's own among them, is nobody's. A
  reopened note, once edited, is `changedSinceDone`. It returns null when
  nothing changes, so an edit writes nothing to the session unless it matters.
  `changedSinceDone` is stored, not derived: deriving it would open every note's
  document to filter the index.
- **A sent draft's message is its sender's**, with the others in
  `ChatDetails.contributors`, "Ada, with Bea". The model reads only the
  sender's name.

# Participants (`participant.ts`)

A session is its participants (ADR-0021). `pineta.participant` values are names
keyed by writer id; `displayName` gives an unnamed writer the `guest-…` label
the screen shows; `participants` lists every named writer and every writer in
the tree, sorted, which is what a mention resolves against.

# References

A reference is a semantic pointer: from the entry it was attached at (where its
author was reading, or their lane tip) to an entry or a span of one. ADR-0006,
realised by ADR-0017, amended by ADR-0018.

## Storage

A pi value in `pineta.reference`, keyed by the reference's own id, written only
by `Agent.addReference` through `Session.setValue`. Values stay out of pi's
causal graph and out of every model's context; only custom entries can be
projected into context. References therefore travel in pi's JSONL.

## The schema is the single authority

`ReferenceSchema` (TypeBox) is the only definition of the shape. Pineta owns it,
so this is not a mirror of anything pi owns. `decodeReference` is **total**: a
stored value that does not match is dropped, never thrown, because values are
`Schema.any()` in the document and one bad value must not break every render.
Decoding is also where `ReferenceId` and `EntryId` are branded.

## Gotchas

- **Backlinks are derived, never stored.** `indexReferences` builds both
  directions in one pass, each list ascending by id. A stored list per target
  would be a child container created lazily under a key two writers share: the
  S18 shape, which lost a writer's value in 40 of 40 trials.
- **Spans are UTF-16 code units over `entryText`.** That is the string the
  client renders, so a DOM selection maps onto it directly. A surrogate pair is
  two units; the unit test pins it.
- **Only committed entries are citable.** A streaming message is not an entry,
  and its text is still changing, so an offset into it would not be stable.
- **Absent and textless are different facts.** `CitedEntry` keeps them apart:
  citing a compaction whole is allowed; a span on it is `invalid_span`.
- **It ships to the browser.** The client decodes references, so TypeBox is in
  the bundle: +42 kB raw, +12 kB gzipped when added.
