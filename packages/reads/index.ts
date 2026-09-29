// reads — what the session document says, read once, for the host and the
// client alike.
//
// The composer promises "send" or "queue" from the same facts the host then
// decides from. If the two read those facts separately, the promise holds only
// while two copies stay in step, which is the drift this project keeps
// meeting. So both read here. View-shaped reads (a stream's text, a count)
// stay in `packages/client/projection.ts`.
//
// Pure reads of a document handle: no subscription, no caching, no pi.

import {
  type Above,
  type AgentRun,
  type ArchiveRecord,
  agentActivity,
  ancestry,
  type ChatMode,
  type CommandSummary,
  type EntryLike,
  type HaveRecord,
  indexTree,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type NoteRecord,
  nearestRevision,
  type OfferRecord,
  type Position,
  type ProjectRecord,
  type RevisionRecord,
  rootOf,
  type ThreadLane,
  type ThreadName,
  type TreeIndex,
  type WorkSetting,
  type WriterId,
  workFor,
} from "@pineta/core"
import {
  ARCHIVE_NAMESPACE,
  archiveRecords,
  COMMANDS_NAMESPACE,
  commandsRecord,
  decodeReference,
  HAVE_NAMESPACE,
  type Held,
  haveRecords,
  heldBy,
  heldMessages,
  heldRuns,
  indexReferences,
  LANDING_NAMESPACE,
  LANE_NAMESPACE,
  landingRecords,
  laneRecords,
  lastHeld,
  NAME_NAMESPACE,
  NOTE_NAMESPACE,
  nameRecords,
  noteAt,
  noteRecords,
  OFFER_NAMESPACE,
  OUTBOX_NAMESPACE,
  offerRecords,
  PARTICIPANT_NAMESPACE,
  PROJECT_NAMESPACE,
  participantNames,
  participants,
  projectRecord,
  REFERENCE_NAMESPACE,
  REVISION_NAMESPACE,
  type Reference,
  type ReferenceIndex,
  renderableMessage,
  revisionRecords,
} from "@pineta/marginalia"
import {
  type PresenceDocHandle,
  readActiveRun,
  readEntries,
  readLaneNames,
  readLaneTip,
  readValues,
  rowMessage,
  type SessionDocHandle,
  writerOfKey,
} from "@pineta/schema"

/**
 * Stored rows -> the shape the projections read (ADR-0015). `message` is pi's
 * variant data, lifted by `rowMessage`; a human's chat is decoded here, by
 * `renderableMessage`, into role `chat` with its author and writer.
 */
export function readRenderableEntries(
  doc: SessionDocHandle,
): Record<string, EntryLike> {
  const out: Record<string, EntryLike> = {}
  for (const [id, row] of Object.entries(readEntries(doc))) {
    out[id] = {
      id: row.id,
      parentId: row.parentId,
      type: row.type,
      message: renderableMessage(rowMessage(row)),
    }
  }
  return out
}

/** The tree, indexed once per document change (`indexTree`). */
export const readTreeIndex = (doc: SessionDocHandle): TreeIndex =>
  indexTree(readRenderableEntries(doc))

/** Every held message, oldest first (`pineta.outbox`). */
export const readOutbox = (doc: SessionDocHandle): readonly Held[] =>
  heldMessages(readValues(doc, OUTBOX_NAMESPACE))

/**
 * Every thread lane: its tip, whether it runs, how many messages wait for it,
 * who holds it (for a conflict's "by"): the writer of the compelled message
 * it is answering, or of the first one waiting; and who wrote the last one
 * waiting, whom a message queued now follows.
 */
export function readLanes(
  doc: SessionDocHandle,
  index: TreeIndex,
): readonly LaneView[] {
  const outbox = readOutbox(doc)
  // Lane names are read from storage: branded here, the one edge they cross.
  return readLaneNames(doc).map(stored => {
    const name = stored as LaneName
    const tip = readLaneTip(doc, name)
    const running = readActiveRun(doc, name) !== undefined
    const waiting = outbox.filter(h => h.lane === name)
    const asking = running
      ? ancestry(index, tip)
          .path.map(id => index.entries[id]?.message)
          .find(m => m?.role === "chat" && m.compelled === true)?.writer
      : (() => {
          const first = waiting.find(heldRuns)
          return first === undefined ? undefined : heldBy(first)
        })()
    return {
      name,
      tip,
      running,
      waiting: waiting.length,
      askedBy: asking ?? null,
      lastWaiting: (() => {
        const last = lastHeld(outbox, name)
        return last === undefined ? null : heldBy(last)
      })(),
    }
  })
}

/** Every lane the agent is replying on. */
export function readAgentActivity(
  doc: SessionDocHandle,
  index: TreeIndex,
): readonly AgentRun[] {
  return agentActivity(
    readLanes(doc, index)
      .filter(l => l.running)
      .map(l => ({ lane: l.name, tip: l.tip })),
  )
}

/** Each writer's display name (`pineta.participant`). */
export const readParticipantNames = (
  doc: SessionDocHandle,
): ReadonlyMap<WriterId, string> =>
  participantNames(readValues(doc, PARTICIPANT_NAMESPACE))

/**
 * Every participant's display name, guests included: the list a mention
 * resolves against (`address`), and the names the screen shows.
 */
export function readParticipants(
  doc: SessionDocHandle,
  index: TreeIndex,
): readonly string[] {
  const writers = Object.values(index.entries).flatMap(e =>
    e.message?.writer === undefined ? [] : [e.message.writer],
  )
  return participants(readParticipantNames(doc), writers)
}

/**
 * Every reference, indexed both ways (ADR-0017). Decoded totally: a malformed
 * one is skipped, so it cannot break a render.
 */
export function readReferences(doc: SessionDocHandle): ReferenceIndex {
  const refs: Reference[] = []
  for (const { value } of readValues(doc, REFERENCE_NAMESPACE)) {
    const r = decodeReference(value)
    if (r !== undefined) refs.push(r)
  }
  return indexReferences(refs)
}

/**
 * Who is here, as the presence document says it: decayed (null) values
 * dropped. Each list has one entry per key, so a person here from two seats
 * (ADR-0037) appears twice; `presenceView` shows them once.
 */
export interface PresenceFacts {
  /** One entry per open column: its writer, and the thread end it follows. */
  readonly reading: readonly (readonly [WriterId, string])[]
  /** One entry per seat typing: its writer, and the thread end. */
  readonly typing: readonly (readonly [WriterId, string])[]
  /** One entry per seat editing: its writer, and the note. */
  readonly editing: readonly (readonly [WriterId, string])[]
}

/**
 * The presence document's live entries. A decayed value is `null` and its key
 * stays, so nulls are skipped here, once. Every key starts with its seat's
 * `seatKey`, and the writer is what comes before the first colon
 * (`writerOfKey`).
 */
export function readPresence(doc: PresenceDocHandle): PresenceFacts {
  const live = (record: Record<string, string | null>) =>
    Object.entries(record).flatMap(([key, value]) => {
      const writer = writerOfKey(key)
      return value === null || writer === undefined
        ? []
        : [[writer as WriterId, value] as const]
    })
  return {
    reading: live(doc.reading()),
    typing: live(doc.typing()),
    editing: live(doc.editing()),
  }
}

/** Every note's record (`pineta.note`), oldest first. */
export const readNotes = (doc: SessionDocHandle): readonly NoteRecord[] =>
  noteRecords(readValues(doc, NOTE_NAMESPACE))

/** What the notes index can show: every note, or one kind of note. */
export type NoteFilter = "all" | "draft" | "open" | "done" | "changed" | "mine"
export const NOTE_FILTERS: readonly NoteFilter[] = [
  "all",
  "draft",
  "open",
  "done",
  "changed",
  "mine",
]

/** One row of the notes index. */
export interface NoteRow {
  readonly note: NoteRecord
  /** Where it sits in the tree now (`noteAt`): a column opens there. */
  readonly at: string
}

/**
 * The notes index of one root (ADR-0029): the notes `filter` keeps whose place
 * is in `root`, newest first. "mine" is the notes `me` opened or wrote in. A
 * note with no place yet (a sent draft still waiting) is in no root. Pure.
 */
export function notesIndex(
  notes: readonly NoteRecord[],
  index: TreeIndex,
  lanes: readonly LaneView[],
  filter: NoteFilter,
  me: WriterId,
  root: string,
): readonly NoteRow[] {
  const keep = (n: NoteRecord): boolean => {
    switch (filter) {
      case "all":
        return true
      case "draft":
      case "open":
      case "done":
        return n.state === filter
      case "changed":
        return n.changedSinceDone
      case "mine":
        return n.openedBy === me || n.contributors.includes(me)
    }
  }
  return notes
    .filter(keep)
    .toReversed()
    .flatMap(note => {
      const at = noteAt(note, lanes, index)
      return at !== null && rootOf(index, at) === root ? [{ note, at }] : []
    })
}

/** Every root's archive record (`pineta.archive`, ADR-0029), keyed by root. */
export const readArchive = (
  doc: SessionDocHandle,
): ReadonlyMap<string, ArchiveRecord> =>
  archiveRecords(readValues(doc, ARCHIVE_NAMESPACE))

// ── where lanes work (ADR-0032, ADR-0033) ─────────────────────────────────

/** Every lane's record (`pineta.lane`): where it works, by lane. */
export const readLaneRecords = (
  doc: SessionDocHandle,
): ReadonlyMap<string, LaneRecord> =>
  laneRecords(readValues(doc, LANE_NAMESPACE))

/** Every revision record (`pineta.revision`), by the entry it is at. */
export const readRevisions = (
  doc: SessionDocHandle,
): ReadonlyMap<string, RevisionRecord> =>
  revisionRecords(readValues(doc, REVISION_NAMESPACE))

/** Every resolution's record (`pineta.landing`), oldest first. */
export const readLandings = (doc: SessionDocHandle): readonly LandingRecord[] =>
  landingRecords(readValues(doc, LANDING_NAMESPACE))

/** Each lane's offer in your repo (ADR-0038), by lane. */
export const readOffers = (
  doc: SessionDocHandle,
): ReadonlyMap<string, OfferRecord> =>
  offerRecords(readValues(doc, OFFER_NAMESPACE))

/** The commits you have of lanes: delivered by a take, or copies of your `@`. */
export const readHaves = (doc: SessionDocHandle): readonly HaveRecord[] =>
  haveRecords(readValues(doc, HAVE_NAMESPACE))

/** Each lane's name (`pineta.name`, ADR-0039), by lane. */
export const readNames = (
  doc: SessionDocHandle,
): ReadonlyMap<LaneName, ThreadName> =>
  nameRecords(readValues(doc, NAME_NAMESPACE))

/**
 * A lane as people read it: its name, or, before the host has named it, the
 * last eight characters of its id.
 */
export const readThreadName = (doc: SessionDocHandle, lane: LaneName): string =>
  readNames(doc).get(lane) ?? lane.slice(-8)

/** What the host found where it runs (`pineta.project`); null with no tools. */
export const readProject = (doc: SessionDocHandle): ProjectRecord | null =>
  projectRecord(readValues(doc, PROJECT_NAMESPACE))

/** The commands the host's pi loaded (ADR-0036); none before a host wrote them. */
export const readCommands = (
  doc: SessionDocHandle,
): readonly CommandSummary[] =>
  commandsRecord(readValues(doc, COMMANDS_NAMESPACE))

/**
 * Whether a send's thread works, or will work, in its own copy: its lane is
 * one of its own, or the lane the send would create would be. Paths to your
 * working copy, and to granted host paths, are then written as the lane sees
 * them (ADR-0034, ADR-0036). A lane of its own where the host has no lanes
 * of their own now works directly, so it is not.
 */
export function worksOwn(
  doc: SessionDocHandle,
  index: TreeIndex,
  send: {
    readonly lane: ThreadLane
    /** The thread's end: where a reply would create its lane. */
    readonly end: Position
    readonly mode: ChatMode
    /** Where a branch would start. */
    readonly at: Position
    readonly work: WorkSetting | null
  },
): boolean {
  if (readProject(doc)?.kind !== "lanes") return false
  if (send.lane.kind === "lane" && send.mode !== "branch")
    return readLaneRecords(doc).get(send.lane.name)?.work.kind === "own"
  return (
    workAt(doc, index, send.mode === "branch" ? send.at : send.end, send.work)
      .work?.kind === "own"
  )
}

/**
 * Where a lane created at `at` would work, and the files it would start
 * from: the send's choice, else the lane above, else the project's default.
 * The composer shows this, and the host creates the lane by it.
 */
export function workAt(
  doc: SessionDocHandle,
  index: TreeIndex,
  at: Position,
  choice: WorkSetting | null,
): { readonly work: WorkSetting | null; readonly above: Above } {
  const above = nearestRevision(index, readRevisions(doc), at)
  const work = workFor({
    choice,
    above: above.lane,
    lanes: readLaneRecords(doc),
    project: readProject(doc),
  })
  return { work, above }
}
