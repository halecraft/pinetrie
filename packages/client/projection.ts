// client/projection — what `App` draws from, read from the session document in
// one moment.
//
// The facts the host also decides from (the tree, lanes, the outbox, rules,
// names, references) are read by `@pineta/reads`, shared with the host, so a
// composer cannot promise what the host will not do. This only gathers them.
// Live replies and tool output are read with `readStreams` in
// `@pineta/schema`.
//
// Pure reads: no subscription, no pi.

import type {
  AgentRun,
  ArchiveRecord,
  LaneView,
  NoteRecord,
  TreeIndex,
} from "@pineta/core"
import type { Held } from "@pineta/marginalia"
import {
  readAgentActivity,
  readArchive,
  readCommands,
  readLandings,
  readLaneRecords,
  readLanes,
  readNames,
  readNotes,
  readOffers,
  readOutbox,
  readParticipants,
  readProject,
  readRevisions,
  readTreeIndex,
} from "@pineta/reads"
import type { SessionDocHandle } from "@pineta/schema"
import type { WorkFacts } from "./column-view.ts"

/** The session's facts from one moment: the same reads the host decides from. */
export interface SessionFacts {
  readonly index: TreeIndex
  /** How many entries the document holds, messages or not. */
  readonly count: number
  readonly activity: readonly AgentRun[]
  readonly lanes: readonly LaneView[]
  readonly outbox: readonly Held[]
  readonly participants: readonly string[]
  readonly notes: readonly NoteRecord[]
  readonly archive: ReadonlyMap<string, ArchiveRecord>
  readonly workFacts: WorkFacts
}

export function readSessionFacts(doc: SessionDocHandle): SessionFacts {
  const index = readTreeIndex(doc)
  return {
    index,
    count: Object.keys(index.entries).length,
    activity: readAgentActivity(doc, index),
    lanes: readLanes(doc, index),
    outbox: readOutbox(doc),
    participants: readParticipants(doc, index),
    notes: readNotes(doc),
    archive: readArchive(doc),
    workFacts: {
      project: readProject(doc),
      commands: readCommands(doc),
      lanes: readLaneRecords(doc),
      revisions: readRevisions(doc),
      landings: readLandings(doc),
      offers: readOffers(doc),
      names: readNames(doc),
    },
  }
}
