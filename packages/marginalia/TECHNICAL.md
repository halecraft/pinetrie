# `@pineta/marginalia` — technical notes

The notes and links people write in the margins of the agent's work. Each shape
is stored in pi's extension slots and typed here, by Pineta, which is its single
authority. Every module decodes through `decodeWith` (`decode.ts`), which is
total: a malformed value is dropped, never thrown. `decodeAll` does it for a
namespace's stored values.

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
total decoder like every shape here. A landing waits there too (ADR-0033): a
held item is `kind: "chat"` or `kind: "land"`, and a record stored before
landings, with no `kind`, decodes as a chat. `heldBy` and `heldRuns` read
either kind; `planDrain` takes a held landing as a run. Ids are uuidv7, so `heldMessages` sorts
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

# The archive (`archive.ts`, ADR-0029)

A root put aside for everyone. The record is a host-written `pineta.archive`
value keyed by the root's entry id, `archived` or `restored`, with who changed
it and when. Archiving writes only the record: entries are immutable, so a root
is hidden and made read-only, never removed, and restoring keeps the record.

- **`planArchive` decides**, pure. A root is anything `rootOf` maps to itself
  (a root is always a message, S30). Archiving is refused `root_busy` while
  `rootWork` lists the root: a lane with its tip there runs, or has messages
  waiting. `ROOT_BUSY_REASON` is the one wording, which the tab's menu shows
  too. The state it already has is `unchanged`, and answered the same.
- **The gate keys on the entry a command writes at.** `writesAt` names it for
  every intent (a chat's or a reference's `at`, a note's entry or place via
  `noteAt`), or null for one that writes in no root (a new root, a name, a
  stop, an archive action). `archivedAt` maps that entry to its root's
  record. One rule, applied by the host before dispatch; `sendChat` needs no
  copy, because a sent draft reaches it only through a `note` `send`.
- **A reference is judged by where it is written**, its `at`, not what it
  cites: citing an archived message from an open root is accepted.
- **Yjs writes are not refused for archiving.** A note's text in an archived
  root stays writable to the host's policy, as ADR-0026 requires (a refused
  write cannot be recovered from, S28); the screen offers no editor there.

# Where lanes work (`work.ts`, ADR-0032, ADR-0034)

Four host-written records, each with a total decoder. `encodeWorkRecord` is
the one place their namespaces and keys are chosen, and the agent writes them
through one `setWorkRecord`:

| record | namespace | key | written |
|---|---|---|---|
| a lane's setting: its own copy, or directly in a directory | `pineta.lane` | the lane | once, when the lane is created |
| the commit and disk at an entry | `pineta.revision` | the entry | for every run's prompt, and every assistant message of a lane of its own that made tool calls |
| how a landing ended | `pineta.landing` | its own id | when its run ends; again when taken |
| what the host found where it runs: `lanes`, or `direct` and why | `pineta.project` | `project` | at every start |

- **Every run's prompt has a revision record**, so the nearest record above
  any entry names its lane, its commit and its disk (`nearestRevision`, in
  core, finds the nearest commit and the nearest snapshot independently).
  `planTurnRecord` is the rule:
  - A lane of its own records every turn that made tool calls, with its
    snapshot, because ignored files change without a commit. The commit is
    there only when one was made.
  - A prompt with nothing to commit records the lane's newest commit, so a
    branch from it names what its disk was at.
  - A lane working directly records its prompts with neither: it counts as
    the lane above, and the walk passes it.
  - A record from before lane containers has no `snapshot` key, which decodes
    as null. A project record of kind `workspaces` no longer decodes; the
    host rewrites it at start.
- **`forkPoint`** is where a new lane of its own starts: the nearest snapshot
  above it, else the base snapshot; and the nearest commit, else your `@-`,
  with several commits when your `@` is a merge. The commit is always named:
  a cloned disk carries its parent's working-copy change, and the fork's
  first `jj new` must leave it.
- **`planRetention`** keeps every snapshot of an open root, and each lane's
  newest when the root is archived; the base snapshot is never deleted.
- **`showYours`** shows a path under your working copy's root as the same
  path under `/yours`, whole path prefixes only. `planChat` applies it to a
  message's text when its thread works, or will work, in its own copy, so
  people and the model read the same stored text (ADR-0034).
- **A landing in progress has no record**: it is a running lane whose prompt is
  a land message. A `running` state would repeat that, and a crash would
  leave it stale. A run whose prompt is a land message ends with the
  landing's outcome, however it started: from a send, the outbox or a resume.
- **`planLand`** refuses a lane with no copy of its own, and holds a
  landing for a busy lane as it would a message (`isBusy`).
- **`planTake`** takes only a resolved landing, and only while your `@-` is
  the one it merged: `jj rebase -r @` moves only `@`, so a commit you made
  since would drop out of `@`'s ancestry.
- **`landingOutcome`** is resolved only when the agent did not ask for
  guidance and jj finds no conflicts: the agent can always stop, and can never
  claim a success the repository contradicts (ADR-0033).

# Landing's prompt (`land.ts`, ADR-0033)

A land message is a pi `CustomMessage`, `customType: "pineta.land"`, like a
chat. Its `content` is what the model reads: the resolution skill, then each
conflicted file with its markers and both sides, labelled `ours` (the lane)
and `theirs` (what comes in), each with why it changed the file. Its `details`
are what the column shows: `landLine`'s one line, from the file count.
`renderableMessage` makes it role `land`, and `entryText` its line, so citing
it cites that line, never the prompt.

`planResolution` builds it. Over its budget, each side's reasons are trimmed,
oldest first; the labels, both sides and every file's content are always
kept (ADR-0010). The skill's path and a hash of its content are recorded, so a
surprising resolution can be traced to the policy that produced it.

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
- **Spans are UTF-16 code units over `entryText`.** That is the source the
  client renders from, as markdown; a DOM selection reaches it through the
  source ranges the renderer records (`packages/client/markdown.ts`). A
  surrogate pair is two units; the unit test pins it.
- **Only committed entries are citable.** A streaming message is not an entry,
  and its text is still changing, so an offset into it would not be stable.
- **Absent and textless are different facts.** `CitedEntry` keeps them apart:
  citing a compaction whole is allowed; a span on it is `invalid_span`.
- **It ships to the browser.** The client decodes references, so TypeBox is in
  the bundle: +42 kB raw, +12 kB gzipped when added.
