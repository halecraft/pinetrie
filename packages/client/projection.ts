// client/projection — what `App` draws from, read from the session's
// documents in one moment: the session's, `pineta:live`, and the roots this
// tab holds (ADR-0063), read as one tree.
//
// The facts the host also decides from (the tree, rules, names, references)
// are read by `@pineta/reads`, shared with the host, so a composer cannot
// promise what the host will not do. This only gathers them. Lanes are read
// with the cards (`session.cards`), read on their own, by `readHeldLanes` in
// `App`. Which streams are drawn is `liveWork` (`live.ts`), over the stream
// records alone: a stream's text is read where it is drawn, so a delta does
// not re-run this (S55).
//
// Pure reads: no subscription, no pi.

import {
  type AgentRun,
  type ArchiveRecord,
  type AskIndex,
  type CardRecord,
  type EntryId,
  indexAsks,
  type LaneName,
  type LaneView,
  type MarkRecord,
  type RootId,
  type SeatRecord,
  type StopRecord,
  type TreeIndex,
} from "@pineta/core"
import type { DigestRecord } from "@pineta/marginalia"
import {
  readAgentActivity,
  readArchive,
  readBanners,
  readBases,
  readCommands,
  readDigests,
  readHeld,
  readHeldIndex,
  readLandings,
  readLaneRecords,
  readLanes,
  readLine,
  readMarks,
  readNames,
  readOffers,
  readProject,
  readRevisions,
  readRunningLanes,
  readSeats,
  readStops,
} from "@pineta/reads"
import {
  type LiveDocHandle,
  type RootDocHandle,
  readStreamRecords,
  type SessionDocHandle,
} from "@pineta/schema"
import type { WorkFacts } from "./column-view.ts"
import { type LiveWork, liveWork } from "./live.ts"

/** The documents a page reads: the session's, what streams, and the roots it holds. */
export interface HeldView {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly roots: readonly RootDocHandle[]
}

export interface SessionFacts {
  readonly index: TreeIndex
  /** Every ask (ADR-0056), from `index`: the rail and the columns read one. */
  readonly asks: AskIndex
  /** Who stopped each ask, by its prompt. */
  readonly stops: ReadonlyMap<EntryId, StopRecord>
  /** Each ask's model-written digest, when digests are on, by its prompt. */
  readonly digests: ReadonlyMap<EntryId, DigestRecord>
  readonly activity: readonly AgentRun[]
  /** Every lane replying, in any root, held or not (`readRunningLanes`). */
  readonly running: readonly {
    readonly lane: LaneName
    readonly root: RootId
  }[]
  /** The streams to draw, from the same moment as `index`. */
  readonly live: LiveWork
  /** Every seat the host has seen: who wrote in a card (ADR-0048). */
  readonly seats: readonly SeatRecord[]
  readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
  /** Each entry's title (ADR-0045); a root's is its label. */
  readonly marks: ReadonlyMap<EntryId, MarkRecord>
  readonly workFacts: WorkFacts
}

/**
 * `view`'s documents, read in one `useSelector`: it tracks what a read
 * touches in any of them. The tree is every held root's, in one index.
 */
export function readSessionFacts(view: HeldView): SessionFacts {
  const { session: doc, live, roots } = view
  const index = readHeldIndex(roots)
  const activity = roots.flatMap(root => readAgentActivity({ doc: root, live }))
  return {
    index,
    asks: indexAsks(index),
    stops: readHeld(roots, readStops),
    digests: readHeld(roots, readDigests),
    activity,
    running: readRunningLanes(doc, live),
    live: liveWork(readStreamRecords(live), activity),
    seats: readSeats(doc),
    archive: readArchive(doc),
    marks: readHeld(roots, readMarks),
    workFacts: {
      project: readProject(doc),
      commands: readCommands(doc),
      lanes: readLaneRecords(doc),
      revisions: readHeld(roots, readRevisions),
      landings: readLandings(doc),
      offers: readOffers(doc),
      names: readNames(doc),
      banners: readBanners(doc),
      line: readLine(doc),
      bases: readBases(doc),
    },
  }
}

/** Every lane in the roots this tab holds, with its queue from the cards. */
export const readHeldLanes = (
  view: HeldView,
  index: TreeIndex,
  cards: readonly CardRecord[],
): readonly LaneView[] =>
  view.roots.flatMap(root =>
    readLanes({ doc: root, live: view.live }, index, cards),
  )
