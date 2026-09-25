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
  agentActivity,
  ancestry,
  type EntryId,
  type EntryLike,
  indexTree,
  type LaneName,
  type LaneView,
  type Responder,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import {
  decodeReference,
  type Held,
  heldMessages,
  indexReferences,
  OUTBOX_NAMESPACE,
  PARTICIPANT_NAMESPACE,
  participantNames,
  REFERENCE_NAMESPACE,
  type Reference,
  type ReferenceIndex,
  renderableMessage,
  THREAD_NAMESPACE,
  threadDefaults,
} from "@pineta/marginalia"
import {
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

/** Every lane the agent is replying on, and what each reads. */
export function readAgentActivity(
  doc: SessionDocHandle,
  index: TreeIndex,
): readonly AgentRun[] {
  return agentActivity(
    index,
    readLanes(doc, index)
      .filter(l => l.running)
      .map(l => ({ lane: l.name, tip: l.tip })),
  )
}

/** Every thread rule, by the entry it is set at (`pineta.thread`). */
export const readThreadRules = (
  doc: SessionDocHandle,
): ReadonlyMap<EntryId, Responder> =>
  threadDefaults(readValues(doc, THREAD_NAMESPACE))

/** Each writer's display name (`pineta.participant`). */
export const readParticipantNames = (
  doc: SessionDocHandle,
): ReadonlyMap<WriterId, string> =>
  participantNames(readValues(doc, PARTICIPANT_NAMESPACE))

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
