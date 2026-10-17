// interface/projection — what `App` draws from, read from the session's
// documents in one moment: the session's, `pinetrie:live`, and the roots this
// tab holds, read as one tree.
//
// The facts the host also decides from (the tree, rules, names, references)
// are read by `@pinetrie/reads`, shared with the host, so a composer cannot
// promise what the host will not do. This only gathers them. Lanes are read
// with the cards (`session.cards`), read on their own, by `readHeldLanes` in
// `App`. Which streams are drawn is `liveWork` (`live.ts`), over the stream
// records alone: a stream's text is read where it is drawn, so a delta does
// not re-run this.
//
// Pure reads: no subscription, no pi.

import {
  type AgentRun,
  type AskIndex,
  type CanvasId,
  type CardHistoryRecord,
  type CardId,
  type CardRecord,
  type DigestRecord,
  type EntryId,
  indexAsks,
  type LaneView,
  type MarkRecord,
  type NoteColumnId,
  type NoteColumnRecord,
  type RootId,
  type SeatRecord,
  type ThreadId,
  type ThreadRecord,
  type TraceRecord,
  type TreeIndex,
  type VerdictRecord,
  type Workflow,
} from "@pinetrie/core"
import {
  readAccepted,
  readAccess,
  readAgentActivity,
  readBanners,
  readBases,
  readBudgets,
  readCardHistories,
  readCommands,
  readConflicts,
  readDigests,
  readHeld,
  readHeldIndex,
  readIcons,
  readLaneForks,
  readLaneRecords,
  readLanes,
  readMarks,
  readNames,
  readNoteColumns,
  readProject,
  readProposedByLane,
  readQueueHolds,
  readRevisions,
  readRunningLanes,
  readSeats,
  readSetup,
  readStates,
  readThreads,
  readTraces,
  readVerdicts,
  readWorkflow,
} from "@pinetrie/reads"
import {
  type LiveDocHandle,
  type RootDocHandle,
  readStreamRecords,
  type SessionDocHandle,
} from "@pinetrie/schema"
import type { WorkFacts } from "./column-view.ts"
import { type LiveWork, liveWork } from "./live.ts"
import { sameData } from "./same-data.ts"

/** The documents a page reads: the session's, what streams, and the roots it holds. */
export interface HeldView {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly roots: readonly RootDocHandle[]
}

export interface SessionFacts {
  readonly index: TreeIndex
  /** Every ask, from `index`: the rail and the columns read one. */
  readonly asks: AskIndex
  /** Each ask's model-written digest, when digests are on, by its prompt. */
  readonly digests: ReadonlyMap<EntryId, DigestRecord>
  readonly activity: readonly AgentRun[]
  /** Every lane replying, in any root, held or not (`readRunningLanes`). */
  readonly running: readonly {
    readonly lane: ThreadId
    readonly root: RootId
  }[]
  /** The streams to draw, from the same moment as `index`. */
  readonly live: LiveWork
  /** Every seat the host has seen: who wrote in a card. */
  readonly seats: readonly SeatRecord[]
  /** The board's workflow states, or null before the host wrote them. */
  readonly workflow: Workflow | null
  /** Each canvas's title: its label. */
  readonly marks: ReadonlyMap<CanvasId, MarkRecord>
  /** Each titled note column's title. */
  readonly noteColumns: ReadonlyMap<NoteColumnId, NoteColumnRecord>
  /** Every thread, by id: each one's root. */
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** Each thread's last run's verdict, in any root, by lane. */
  readonly verdicts: ReadonlyMap<ThreadId, VerdictRecord>
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  /** Every trace, by id: each column draws its reader's own. */
  readonly traces: ReadonlyMap<string, TraceRecord>
  /** What a column says of its threads' work; its forks are the page's `CanvasIndex`'. */
  readonly workFacts: Omit<WorkFacts, "forks">
}

/**
 * `view`'s documents, read in one `useSelector`: it tracks what a read
 * touches in any of them. The tree is every held root's, in one index.
 */
export function readSessionFacts(view: HeldView): SessionFacts {
  const next = readFacts(view)
  const before = lastFacts.get(view)
  const kept = before === undefined ? next : keptFacts(before, next)
  lastFacts.set(view, kept)
  return kept
}

/** What each view last gave, so a fact that reads the same keeps its identity. */
const lastFacts = new WeakMap<HeldView, SessionFacts>()

/** `next`, field by field, with each one that reads the same as before kept. */
function keptFields<T extends object>(
  before: T,
  next: T,
  byIdentity: readonly (keyof T)[] = [],
): T {
  const out = { ...next }
  let same = true
  for (const k of Object.keys(next) as (keyof T)[])
    if (
      byIdentity.includes(k)
        ? Object.is(before[k], next[k])
        : sameData(before[k], next[k])
    )
      out[k] = before[k]
    else same = false
  return same ? before : out
}

/**
 * Any write to the session's values (a card's move writes its history) reads
 * every fact again, and each read builds new maps. Kept while the same, they
 * redraw nothing: every message list compares its props by identity. The tree
 * and the asks are kept by their own reads, and are too large to compare.
 */
function keptFacts(before: SessionFacts, next: SessionFacts): SessionFacts {
  return keptFields(
    before,
    { ...next, workFacts: keptFields(before.workFacts, next.workFacts) },
    ["index", "asks", "workFacts"],
  )
}

function readFacts(view: HeldView): SessionFacts {
  const { session: doc, live, roots } = view
  const index = readHeldIndex(roots)
  const activity = roots.flatMap(root => readAgentActivity({ doc: root, live }))
  return {
    index,
    asks: indexAsks(index),
    digests: readHeld(roots, readDigests),
    activity,
    running: readRunningLanes(doc, live),
    live: liveWork(readStreamRecords(live), activity),
    seats: readSeats(doc),
    workflow: readWorkflow(doc),
    marks: readMarks(doc),
    noteColumns: readNoteColumns(doc),
    threads: readThreads(doc),
    verdicts: readVerdicts(doc),
    histories: readCardHistories(doc),
    traces: readTraces(doc),
    workFacts: {
      project: readProject(doc),
      commands: readCommands(doc),
      lanes: readLaneRecords(doc),
      revisions: readHeld(roots, readRevisions),
      proposedByLane: readProposedByLane(doc),
      names: readNames(doc),
      banners: readBanners(doc),
      icons: readIcons(doc),
      access: readAccess(doc),
      accepted: readAccepted(doc),
      bases: readBases(doc),
      laneForks: readLaneForks(doc),
      budgets: readBudgets(doc),
      setup: readSetup(doc),
      states: readStates(doc),
      conflicts: readConflicts(doc),
    },
  }
}

/**
 * Every lane in the roots this tab holds, with its queue from the cards and who
 * holds it from the session; a blank queued card (`blank`) does not wait.
 */
export const readHeldLanes = (
  view: HeldView,
  index: TreeIndex,
  cards: readonly CardRecord[],
  blank: ReadonlySet<CardId>,
): readonly LaneView[] => {
  const holds = readQueueHolds(view.session)
  return view.roots.flatMap(root =>
    readLanes({ doc: root, live: view.live }, index, cards, holds, blank),
  )
}
