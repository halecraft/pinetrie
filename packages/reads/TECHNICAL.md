# `@pinetrie/reads` — technical notes

What the session document says, read once, by the host and the client alike.

## Which document a read takes (ADR-0063)

- **A root's reads take its `RootDocHandle`**: `readTreeIndex`,
  `readLatestPrompt`, `readRevisions`,
  `readDigests`, and `readRootRecord`, the root's directory
  record as the host writes it.
- **The session's reads take its `SessionDocHandle`**: every record read
  across roots (`readLaneRecords`, `readNames`, `readProposedByLane`, `readWorkflow`,
  `readArchived` (with the places, ADR-0126) and `readMarks`, each by
  canvas (ADR-0116), `readThreads`,
  `readRoots`, the singletons…), `readRunningLanes` with `pinetrie:live`, and
  `readReferencedBlobs`, which takes each root's images from its directory
  record, so no root is opened to sweep.
- **A read of several documents takes a `RootView`** (`{ root, doc,
  session, live }`): `readLanes` and `readAgentActivity` take its `doc` and
  `live`.
- **`readRecords(doc, spec)` takes the document the spec's home names**
  (`HomeDoc<H>`), so a session record cannot be read from a root: the two
  documents have their own schemas (ADR-0095).
- **A page reads several roots as one** (`readHeldIndex`, `readHeld`): one
  index over the entries of the roots it holds, kept while none changes.

## Why it exists

The composer promises *send* or *queue*, and *agent will reply*, from the
thread's lane, its queued cards and the participants. The host then decides from the same
facts. When the two read those facts separately, the promise holds only while
two copies stay in step, which is the drift this project keeps meeting (S11,
the scanner, the e2e projection). So both read here, through one set of
functions.

## What belongs here

Reads the host decides from, or that more than one reader needs:
`readTreeIndex`, `readLanes`, `readRunning`, `readLatestPrompt` (what a lane's run is: a
run's end and `split_proposed_changes` decide by it), `readRunAuthor` (the person
behind it, `promptAuthor`, ADR-0080),
`readParticipantNames`, `readParticipantPictures` (ADR-0098), `readParticipants`, `readReading`, `readTyping`,
`readTypingIn` and `readQueueHolds` (ADR-0048 step 7), `readAgentActivity`,
`readSeats`, `readPlaces` and `readPlacesRev` (ADR-0059), `readWorkflow`,
`readCanvases` (the canvases whose card is on the board, from the places,
ADR-0126) and `readArchived` (the board, ADR-0122: the canvases in the
archive, from the board's cards and their histories, derived and kept
while the same, since every write to the session's values wakes it),
`readMarks` (each canvas's title, ADR-0045, ADR-0116), `readReadingCanvases` (each followed end's canvas, from
presence), `readDigests` (ADR-0106), and
where lanes work (ADR-0032, ADR-0034): `readLaneRecords`, `readRevisions`,
`readProject` (the project's root, written only by a host with tools).
`worksOwn` says whether a send's thread works, or will work, in a copy of
its own (the lane's `history` is not null, or, for a lane to be made, whether the host
has a project, ADR-0102): the host decides by it whether a sent message's
paths are stored under `/mnt/host-working-copy`. The board's items are a
client-only read, in `packages/interface/board-view.ts`. Live streams are read with `readStreams` in
`@pinetrie/schema`; an entry count stays in `packages/interface/projection.ts`.

## Where entry ids are branded

A stored row's id is a plain `string` (Kyneta's `Schema.string()` carries no
brand), and `renderableEntry` is the first pine·trie code to see one: it mints
the entry's `id` and `parentId` as `EntryId`s, and everything read from the
index after that carries the brand (S95). Presence's `reading` and `typing`
values are thread ends, written by clients: `presenceField` mints them too.
Lane names, lane tips and run ids are branded one layer down, by
`@pinetrie/schema`'s readers (`readLaneNames`, `readLaneTip`, `readActiveRun`),
and each record's ids by its decoder in `@pinetrie/rules`. `entryId` is
the identity at run time, so the frozen entries and the index's cache are
unchanged by it.

`readReferencedBlobs` is every image something still shows (ADR-0042): each
chat's, each tool result's (`messageImages`, ADR-0051), and each in the
texts people type, cards' (queued ones among them), which its caller must
pass for every one, not only those it holds (the host gathers them all
through its card port). `planSweep` decides which
stored images to delete from it.

**Each record reader is `readRecords(doc, SPEC)`** (ADR-0062): the
record's namespace (`readNamespace`, one lookup, ADR-0095) decoded by its
spec in `@pinetrie/rules` and keyed by its address. The decoded map is
cached by the stored namespace object, which keeps its identity while the
namespace is unchanged (S120): a write decodes only its own namespace again,
and every other reader returns the same map.
A reader keeps its own name and return type, and shapes the map only where
its readers want something else: `readSeats` sorts,
`readNames` and `readParticipantNames` give the name alone, and the
singletons (`readAccepted`, `readProject`, `readCommands`, `readIcons`) take
their one key; `readIcons` is null before a host wrote it, which the page
reads as no built-in icons.

It declares core, schema and rules only (`workspace.test.ts`), so it runs
in the host and in the browser alike: no pi, no transport.

The records it reads, and the decisions that made them:

| reader | record | decision |
|---|---|---|
| `readRoots`, `readRootRecord` | `pinetrie.root` | ADR-0063; each thread's writers on its path, ADR-0077 |
| `readStartedRoots` | `pinetrie.root`'s keys, decoded or not | the roots the directory names, a record in an older shape among them (S199) |
| `readThreads` | `pinetrie.thread` | ADR-0117 |
| `readNames` | `pinetrie.name` | ADR-0039 |
| `readMarks` | `pinetrie.mark` | ADR-0045, ADR-0116 |
| `readNoteColumns` | `pinetrie.note-column` | ADR-0116 |
| `readWorkflow`, `readArchived` | `pinetrie.workflow` | ADR-0122; the archive, ADR-0029 |
| `readVerdicts` | `pinetrie.verdict` | ADR-0077 |
| `readDigests` | `pinetrie.digest` | ADR-0106 |
| `readCardHistories`, `readTraces` | `pinetrie.card-history`, `pinetrie.trace` | ADR-0048 step 6 |
| `readQueueHolds` | `pinetrie.queue-hold` | ADR-0048 step 7 |
| `readParticipantPictures` | `pinetrie.picture` | ADR-0098 |
| `readProposedByLane` | `pinetrie.proposed` | ADR-0105 |
| `readAccepted`, `readBases` | `pinetrie.accepted`, `pinetrie.base` | ADR-0104 |
| `readFilesLost` | `pinetrie.files-lost` | ADR-0124 |
| `readBudgets` | `pinetrie.budget` | ADR-0128 |
| `readCommands` | `pinetrie.commands` | ADR-0036 |
| `readIcons` | `pinetrie.icons` | ADR-0143 |

The lanes' records and revisions (`readLaneRecords`, `readRevisions`)
are where lanes work (ADR-0032, ADR-0033); `worksOwn` decides whether a send's paths are written as its lane sees them (ADR-0034,
ADR-0036, ADR-0102). A renderable entry is the stored row's typed columns
with pi's message lifted out of `payload` (ADR-0015).

A read caches only by an object Kyneta keeps while its content is unchanged
(S54): a hit returns what reading again would, and the cache holds nothing
Kyneta has let go.

## Gotchas

- **`readTreeIndex` returns the same index while the `entries` record is
  unchanged**, so a write elsewhere (a checkpoint, a value, a lane tip)
  costs no indexing, and the host's many reads within one command share one
  index. Every caller shares it: copy a list before sorting it
  (`packages/core/roots.ts` does).
- **`readTreeIndex`'s entries are the same for the same stored row**,
  frozen. Kyneta gives an unchanged row the same object across writes, so a
  new entry decodes only itself.

- **`readLanes` reads two documents**: the session, and every card's record
  (`readPlaces` of the places document), passed in, and the queued cards
  that are blank (`blankQueued`, from the texts its caller holds). A lane's
  `waiting` is its queued cards (`queuedOn`) less the blank ones, so a lane
  with cards queued is busy (`isBusy`) even between two pops, and one with
  only blank cards queued is not: the drain passes over them (ADR-0113). A
  read that uses only the lanes' tips or names passes `NONE_BLANK`. The client reads lanes with its cards, in `App`;
  a read that needs only runs and tips uses `readRunning` and
  `readLaneNames`, as `readAgentActivity` does.
- **`readLanes`' `askedBy`** is the writer of the message a running lane is
  answering, its run's prompt (`promptOf`, the ask, ADR-0106), when a
  person's message started it; or else who queued its first card. A land,
  stack or carry-on message names no one. It is what a `conflict` names.
- **`readLanes`' `lastWaiting`** is who queued the lane's last card: a card
  queued now waits behind it, so it is who the queue button names. It is null exactly when `waiting` is 0. It
  differs from `askedBy` while a run goes: `askedBy` is who the agent
  answers, `lastWaiting` who is last in line.
- **`readLanes`' `heldBy`** is who holds the lane's queue (ADR-0048 step
  7), from the holds its caller passes (`readQueueHolds`, the session's): a
  root document does not hold them, and every caller already has the
  session. `readQueueHolds` keeps its map while the holds are the same,
  since every session write wakes it.
- **`readTypingIn`** is the set of cards someone types in now, from any
  seat; it keeps its set while the cards are the same. The host's drain
  reads it, and pops none of them.
- **A presence read gives one entry per key** (`readReading`, `readTyping`), as
  `[writer, value]` pairs: a person here from two seats
  appears twice (ADR-0037), and `presence.ts` in `@pinetrie/interface` shows them once. Each
  read is of one field, so Kyneta wakes it only for writes to that field, and
  each keeps its last array while the entries are the same: the page's
  refresh writes the same values again, and Kyneta's record is then a new
  object (S59).
  `readReadingCanvases` (each end's reported canvas, ADR-0063, ADR-0116) keeps
  its map the same way, and so do `readParticipantNames` and `readParticipantPictures`,
  which every message's speaker and every circle compare by identity.
- **`readReferencedBlobs` is what the sweep keeps**: each root's images
  from its directory record, every card's text, every banner (ADR-0050)
  and every person's picture (ADR-0098). An image left out of it is deleted after the
  grace period.
- **Build a `Record<EntryId, …>` from each entry's own `id`.** `Object.entries`
  and `Object.keys` give back `string`, which cannot index it (TS7053), so
  `renderableEntries` walks `Object.values` and keys by `entry.id`.
- **A map keyed by an entry, a root, a canvas or a lane says so in its type** (`readArchived`,
  `readRevisions`, `readProposedByLane`…). A `string`-keyed map still accepts an
  `EntryId`, so a key type left `string` compiles and leaves its lookups
  unchecked (S95).
- **`readTreeIndex` decodes chat** (`renderableMessage`), so the index
  carries each chat's writer, whether it compelled the agent, and its send
  id: `threadOfSend`'s race reads the first two, a sender that names its send the third.
- **Each entry's thread is its row's** (ADR-0125), from which `indexTree`
  builds each thread's first entry and end (`TreeIndex.firstOf`, `endOf`).
  A row whose thread fails `isThreadId` is left out, as `readStoredLanes`
  sets aside a malformed lane name: none should exist, since every commit
  names its thread and a store from before is refused until migrated
  (ADR-0096).
- **A compaction entry carries the pinned cards its retained tail holds**
  (`carried`, ADR-0048 step 5, S92): the tail's newest cards entry, read from the
  row's payload (`rowRetainedTail`, `@pinetrie/schema`). pi stores the tail on
  the compaction itself, and the model reads it after the summary, so
  `pinnedInView` stops there.
- **`readPlaces` keeps an unchanged card the same object.** Kyneta gives an
  unchanged `json` row the same object across writes, so the decoded record
  is kept in a `WeakMap` keyed by the row (S54's rule). A change to one card
  redraws only what shows it.
