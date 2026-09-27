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
  type AgentRun,
  type ArchiveRecord,
  agentActivity,
  ancestry,
  type EntryLike,
  indexTree,
  type LaneName,
  type LaneView,
  type NoteRecord,
  rootOf,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import {
  ARCHIVE_NAMESPACE,
  archiveRecords,
  decodeReference,
  type Held,
  heldMessages,
  indexReferences,
  NOTE_NAMESPACE,
  noteAt,
  noteRecords,
  OUTBOX_NAMESPACE,
  PARTICIPANT_NAMESPACE,
  participantNames,
  participants,
  REFERENCE_NAMESPACE,
  type Reference,
  type ReferenceIndex,
  renderableMessage,
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
 * and who holds it (for a conflict's "by"): the writer of the compelled message
 * it is answering, or of the first one waiting.
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
      : waiting.find(h => h.details.compels.kind === "agent")?.details.author
    return {
      name,
      tip,
      running,
      waiting: waiting.length,
      askedBy: asking ?? null,
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

/** Who is here, as the presence document says it: decayed (null) values dropped. */
export interface PresenceFacts {
  /** One entry per open column: its writer, and the thread end it follows. */
  readonly reading: readonly (readonly [WriterId, string])[]
  readonly typing: ReadonlyMap<WriterId, string>
  readonly editing: ReadonlyMap<WriterId, string>
}

/**
 * The presence document's live entries. A decayed value is `null` and its key
 * stays, so nulls are skipped here, once. `reading` keys are
 * `${writer}:${columnKey}`; the writer is everything before the last colon.
 */
export function readPresence(doc: PresenceDocHandle): PresenceFacts {
  const reading: [WriterId, string][] = []
  for (const [key, end] of Object.entries(doc.reading())) {
    const at = key.lastIndexOf(":")
    if (end !== null && at > 0)
      reading.push([key.slice(0, at) as WriterId, end])
  }
  const live = (record: Record<string, string | null>) =>
    new Map(
      Object.entries(record).flatMap(([w, v]) =>
        v === null ? [] : [[w as WriterId, v] as const],
      ),
    )
  return { reading, typing: live(doc.typing()), editing: live(doc.editing()) }
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
