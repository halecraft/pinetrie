# `@pineta/reads` — technical notes

What the session document says, read once, by the host and the client alike.

## Which document a read takes (ADR-0063)

- **A root's reads take its `RootDocHandle`**: `readTreeIndex`,
  `readRenderableEntries`, `readLatestPrompt`, `readRevisions`, `readMarks`,
  `readStops`, `readDigests`, and `readRootRecord`, the root's directory
  record as the host writes it.
- **The session's reads take its `SessionDocHandle`**: every record read
  across roots (`readLaneRecords`, `readNames`, `readOffers`, `readWorkflow`,
  `readBoardPlaces`, `readArchived`,
  `readRoots`, the singletons…), `readRunningLanes` with `pineta:live`, and
  `readReferencedBlobs`, which takes each root's images from its directory
  record, so no root is opened to sweep.
- **A read of several takes a `RootView`** (`{ root, doc, session, live }`):
  `workAt` and `worksOwn`. `readLanes` and `readAgentActivity` take its
  `doc` and `live`.
- **`readRecords(doc, spec)` takes the document the spec's home names**
  (`HomeDoc<H>`), so a session record cannot be read from a root.
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
`readRenderableEntries`, `readTreeIndex`, `readLanes` (and `readLane`, one
of them), `readRunning`, `readLatestPrompt` (what a lane's run is: a
run's end and `split_offer` decide by it), `readRunAuthor` (the person
behind it, `promptAuthor`, ADR-0080),
`readParticipantNames`, `readParticipants`, `readReading`, `readTyping`,
`readAgentActivity`, `readSeats`, `readPlaces` and `readPlacesRev` (ADR-0059),
`readWorkflow`, `readBoardPlaces` and `readArchived` (the board, ADR-0085:
the roots in the closed state, derived and kept while the same, since every
write to the session's values wakes it), `readMarks` (ADR-0045), `readStops`
and `readDigests` (ADR-0056), and
where lanes work (ADR-0032, ADR-0034): `readLaneRecords`, `readRevisions`, `readLandings`,
`readProject` (`lanes`, or `direct` and why). `workAt` is where a lane created
at an entry would work, and the commit and snapshot it would start from: the
composer shows it, and the host creates the lane by it, and decides by it
whether a sent message's paths are stored under `/mnt/host-working-copy`. The board's items are a
client-only read, in `packages/client/board-view.ts`. Live streams are read with `readStreams` in
`@pineta/schema`; an entry count stays in `packages/client/projection.ts`.

## Where entry ids are branded

A stored row's id is a plain `string` (Kyneta's `Schema.string()` carries no
brand), and `renderableEntry` is the first Pineta code to see one: it mints
the entry's `id` and `parentId` as `EntryId`s, and everything read from the
index after that carries the brand (S95). Presence's `reading` and `typing`
values are thread ends, written by clients: `presenceField` mints them too.
Lane names, lane tips and run ids are branded one layer down, by
`@pineta/schema`'s readers (`readLaneNames`, `readLaneTip`, `readActiveRun`),
and each record's ids by its decoder in `@pineta/rules`. `entryId` is
the identity at run time, so the frozen entries and the index's cache are
unchanged by it.

`readReferencedBlobs` is every image something still shows (ADR-0042): each
chat's, each tool result's (`messageImages`, ADR-0051), and each in the
texts people type, cards' (queued ones among them), which its caller must
pass for every one, not only those it holds (the host gathers them all
through its card port). `planSweep` decides which
stored images to delete from it.

**Each record reader is `readRecords(doc, SPEC)`** (ADR-0062): the
record's values decoded by its spec in `@pineta/rules` and keyed by their address.
A reader keeps its own name and return type, and shapes the map only where
its readers want something else: `readSeats` and `readLandings` sort,
`readNames` and `readParticipantNames` give the name alone, and the
singletons (`readLine`, `readProject`, `readCommands`) take their one key.

It declares core, schema and rules only (`workspace.test.ts`), so it runs
in the host and in the browser alike: no pi, no transport.

A read caches only by an object Kyneta keeps while its content is unchanged
(S54): a hit returns what reading again would, and the cache holds nothing
Kyneta has let go.

## Gotchas

- **`readTreeIndex` returns the same index while the `entries` record is
  unchanged**, so a write elsewhere (a checkpoint, a value, a lane tip)
  costs no indexing, and the host's many reads within one command share one
  index. Every caller shares it: copy a list before sorting it
  (`packages/core/roots.ts` does).
- **`readRenderableEntries` returns the same entry for the same stored row**,
  frozen. Kyneta gives an unchanged row the same object across writes, so a
  new entry decodes only itself.

- **`readLanes` reads two documents**: the session, and every card's record
  (`readPlaces` of the places document), passed in. A lane's `waiting` is its
  queued cards (`queuedOn`), so a lane with cards queued is busy (`isBusy`)
  even between two pops. The client reads lanes with its cards, in `App`;
  a read that needs only runs and tips uses `readRunning` and
  `readLaneNames`, as `readAgentActivity` does.
- **`readLanes`' `askedBy`** is the writer of the message a running lane is
  answering, its run's prompt (`promptOf`, the ask, ADR-0056), when a
  person's message started it; or else who queued its first card. A land,
  stack or carry-on message names no one. It is what a `conflict` names.
- **`readLanes`' `lastWaiting`** is who queued the lane's last card: a card
  queued now waits behind it, so it is who the queue button names. It is null exactly when `waiting` is 0. It
  differs from `askedBy` while a run goes: `askedBy` is who the agent
  answers, `lastWaiting` who is last in line.
- **A presence read gives one entry per key** (`readReading`, `readTyping`), as
  `[writer, value]` pairs: a person here from two seats
  appears twice (ADR-0037), and `core/presence.ts` shows them once. Each
  read is of one field, so Kyneta wakes it only for writes to that field, and
  each keeps its last array while the entries are the same: the page's
  refresh writes the same values again, and Kyneta's record is then a new
  object (S59).
  `readReadingRoots` (each end's reported root, ADR-0063) keeps its map the
  same way, and so does `readParticipantNames`, which reads the session's
  whole `values` and so wakes on every directory write.
- **Build a `Record<EntryId, …>` from each entry's own `id`.** `Object.entries`
  and `Object.keys` give back `string`, which cannot index it (TS7053), so
  `renderableEntries` walks `Object.values` and keys by `entry.id`.
- **A map keyed by an entry, a root or a lane says so in its type** (`readArchived`,
  `readRevisions`, `readOffers`…). A `string`-keyed map still accepts an
  `EntryId`, so a key type left `string` compiles and leaves its lookups
  unchecked (S95).
- **`readRenderableEntries` decodes chat** (`renderableMessage`), so the index
  carries each chat's writer, whether it compelled the agent, and its send id:
  `threadOf`'s race reads the first two, a fresh column the third.
- **A compaction entry carries the pinned cards its retained tail holds**
  (`carried`, ADR-0048 step 5): the tail's newest cards entry, read from the
  row's payload (`rowRetainedTail`, `@pineta/schema`). pi stores the tail on
  the compaction itself, and the model reads it after the summary, so
  `pinnedInView` stops there.
- **`readPlaces` keeps an unchanged card the same object.** Kyneta gives an
  unchanged `json` row the same object across writes, so the decoded record
  is kept in a `WeakMap` keyed by the row (S54's rule). A change to one card
  redraws only what shows it.
