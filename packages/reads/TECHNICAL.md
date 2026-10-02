# `@pineta/reads` — technical notes

What the session document says, read once, by the host and the client alike.

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
of them), `readRunning`,
`readParticipantNames`, `readParticipants`, `readReading`, `readTyping`,
`readAgentActivity`, `readSeats` and `readCards` (ADR-0048),
`readArchive`, `readMarks` (ADR-0045), `readStops` and `readDigests`
(ADR-0056), and
where lanes work (ADR-0032, ADR-0034): `readLaneRecords`, `readRevisions`, `readLandings`,
`readProject` (`lanes`, or `direct` and why). `workAt` is where a lane created
at an entry would work, and the commit and snapshot it would start from: the
composer shows it, and the host creates the lane by it, and decides by it
whether a sent message's paths are stored under `/mnt/host-working-copy`. The Archive tab's rows are a
client-only read, in `packages/client/archive-rows.ts`. Live streams are read with `readStreams` in
`@pineta/schema`; an entry count stays in `packages/client/projection.ts`.

`readReferencedBlobs` is every image something still shows (ADR-0042): each
chat's, each tool result's (`messageImages`, ADR-0051), and each in the
texts people type, cards' (queued ones among them), which its caller must
pass for every one, not only those it holds (the host gathers them all
through its card port). `planSweep` decides which
stored images to delete from it.

It declares core, schema and marginalia only (`workspace.test.ts`), so it runs
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
  (`readCards` of the cards document), passed in. A lane's `waiting` is its
  queued cards (`queuedOn`), so a lane with cards queued is busy (`isBusy`)
  even between two takes. The client reads lanes with its cards, in `App`;
  a read that needs only runs and tips uses `readRunning` and
  `readLaneNames`, as `readAgentActivity` does.
- **`readLanes`' `askedBy`** is the writer of the message a running lane is
  answering, its run's prompt (`promptOf`, the ask, ADR-0056), when a
  person's message started it; or else who queued its first card. A land or
  stack message names no one. It is what a `conflict` names.
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
- **`readRenderableEntries` decodes chat** (`renderableMessage`), so the index
  carries each chat's writer, whether it compelled the agent, and its send id:
  `threadOf`'s race reads the first two, a fresh column the third.
- **`readCards` keeps an unchanged card the same object.** A Yjs read gives
  new objects every time, so it remembers each card's decoded record beside
  the stored value it came from, per cards document, and reuses the record
  while that value is unchanged (S54's rule, by value here). A change to one
  card redraws only what shows it.
