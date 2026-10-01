// client/projection — what `App` draws from, read from the session document in
// one moment.
//
// The facts the host also decides from (the tree, lanes, the outbox, rules,
// names, references) are read by `@pineta/reads`, shared with the host, so a
// composer cannot promise what the host will not do. This only gathers them.
// Which streams are drawn is `liveWork` (`live.ts`), over the stream records
// alone: a stream's text is read where it is drawn, so a delta does not
// re-run this (S55).
//
// Pure reads: no subscription, no pi.

import type {
  AgentRun,
  ArchiveRecord,
  LaneView,
  MarkRecord,
  SeatRecord,
  TreeIndex,
} from "@pineta/core"
import type { Held } from "@pineta/marginalia"
import {
  readAgentActivity,
  readArchive,
  readBanners,
  readCommands,
  readLandings,
  readLaneRecords,
  readLanes,
  readMarks,
  readNames,
  readOffers,
  readOutbox,
  readParticipants,
  readProject,
  readRevisions,
  readSeats,
  readTreeIndex,
} from "@pineta/reads"
import { readStreamRecords, type SessionDocHandle } from "@pineta/schema"
import type { WorkFacts } from "./column-view.ts"
import { type LiveWork, liveWork } from "./live.ts"

/** The session's facts from one moment: the same reads the host decides from. */
export interface SessionFacts {
  readonly index: TreeIndex
  /** How many entries the document holds, messages or not. */
  readonly count: number
  readonly activity: readonly AgentRun[]
  /** The streams to draw, from the same moment as `index`. */
  readonly live: LiveWork
  readonly lanes: readonly LaneView[]
  readonly outbox: readonly Held[]
  readonly participants: readonly string[]
  /** Every seat the host has seen: who wrote in a card (ADR-0048). */
  readonly seats: readonly SeatRecord[]
  readonly archive: ReadonlyMap<string, ArchiveRecord>
  /** Each entry's title (ADR-0045); a root's is its label. */
  readonly marks: ReadonlyMap<string, MarkRecord>
  readonly workFacts: WorkFacts
}

export function readSessionFacts(doc: SessionDocHandle): SessionFacts {
  const index = readTreeIndex(doc)
  const activity = readAgentActivity(doc, index)
  return {
    index,
    count: Object.keys(index.entries).length,
    activity,
    live: liveWork(readStreamRecords(doc), activity),
    lanes: readLanes(doc, index),
    outbox: readOutbox(doc),
    participants: readParticipants(doc, index),
    seats: readSeats(doc),
    archive: readArchive(doc),
    marks: readMarks(doc),
    workFacts: {
      project: readProject(doc),
      commands: readCommands(doc),
      lanes: readLaneRecords(doc),
      revisions: readRevisions(doc),
      landings: readLandings(doc),
      offers: readOffers(doc),
      names: readNames(doc),
      banners: readBanners(doc),
    },
  }
}
