# `@pineta/reads` — technical notes

What the session document says, read once, by the host and the client alike.

## Why it exists

The composer promises *send* or *queue*, and *agent will reply*, from the
thread's lane, the outbox and the participants. The host then decides from the same
facts. When the two read those facts separately, the promise holds only while
two copies stay in step, which is the drift this project keeps meeting (S11,
the scanner, the e2e projection). So both read here, through one set of
functions.

## What belongs here

Reads the host decides from, or that more than one reader needs:
`readRenderableEntries`, `readTreeIndex`, `readLanes`, `readOutbox`,
`readParticipantNames`, `readParticipants`, `readReferences`, `readPresence`,
`readAgentActivity`, `readNotes`, `readArchive`, and where lanes work
(ADR-0032, ADR-0034): `readLaneRecords`, `readRevisions`, `readLandings`,
`readProject` (`lanes`, or `direct` and why). `workAt` is where a lane created
at an entry would work, and the commit and snapshot it would start from: the
composer shows it, and the host creates the lane by it, and decides by it
whether a sent message's paths are stored under `/mnt/host-working-copy`. `notesIndex` is one root's
notes index: the records a filter keeps whose place is in that root, newest
first, each with where it sits now (`noteAt`). The Archive tab's rows are a
client-only read, in `packages/client/archive-rows.ts`. Live streams are read with `readStreams` in
`@pineta/schema`; an entry count stays in `packages/client/projection.ts`.

It declares core, schema and marginalia only (`workspace.test.ts`), so it runs
in the host and in the browser alike: no pi, no transport.

## Gotchas

- **`readLanes`' `askedBy`** is the writer of the compelled message a running
  lane is answering (the nearest compelled chat on its path), or else of the
  first compelled message waiting for it. It is what a `conflict` names.
- **`readRenderableEntries` decodes chat** (`renderableMessage`), so the index
  carries each chat's writer, whether it compelled the agent, and its send id:
  `threadOf`'s race reads the first two, a fresh column the third.
