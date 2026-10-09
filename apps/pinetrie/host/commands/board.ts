// host/commands/board — move a task on the board, or change its workflow
// states (ADR-0122, ADR-0116).
//
// A move runs in up to three parts (ADR-0065). On the documents' keeper:
// gather the workflow and the places, plan the move (`planTaskMove`); if it
// crosses the archive's edge, gather the documents of the task's roots and
// plan the crossing (`planArchive`); then write the place, from which moment
// the archive gate refuses writes into the archived task. Off the keeper:
// the crossing's teardown (its lanes' containers, their refs in your repo
// through the owner, snapshots). Then, on archiving, the roots nothing else
// holds unloaded on the keeper again. The sender's reply comes after all of
// it.

import {
  type EntryId,
  ERR,
  type Intent,
  type RevisionRecord,
  type RootId,
  refused,
  type TaskId,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readArchived,
  readBoardPlaces,
  readLaneRecords,
  readLanes,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readRevisions,
  readTasks,
  readThreads,
  readTreeIndex,
  readWorkflow,
} from "@pinetrie/reads"
import {
  type ArchiveTeardown,
  BOARD,
  boardOf,
  type Crossing,
  planArchive,
  planTaskMove,
  planWorkflowEdit,
  rootsHeld,
  setRecord,
  WORKFLOW,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics, HostKeeper } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Records } from "../records.ts"
import { tasksNow } from "../tasks.ts"
import type { LaneWork } from "../work/index.ts"

export interface BoardDeps {
  readonly basics: Pick<
    Basics,
    "session" | "docs" | "live" | "places" | "now" | "newId"
  >
  readonly records: Pick<Records, "writeValues">
  readonly work: Pick<LaneWork, "teardown" | "repo">
  readonly keeper: Pick<HostKeeper, "run" | "track">
  /** Which queued cards are blank: they leave a lane idle (ADR-0113). */
  readonly cards: Pick<CardPort, "blankQueued">
}

/** The tasks the board shows: every task the session holds. */
const boardTasks = (basics: Pick<Basics, "session">): readonly TaskId[] => [
  ...readTasks(basics.session).keys(),
]

/** What the keeper's first step decided: the answer, and what follows it. */
type Recorded =
  | { readonly kind: "done"; readonly outcome: Outcome }
  | {
      readonly kind: "follow"
      readonly outcome: Outcome
      readonly teardown: ArchiveTeardown
      readonly unload: readonly RootId[]
    }

const MOVED: Outcome = { kind: "moved-task" }

export async function handleTaskMove(
  deps: BoardDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "move-task" }>,
): Promise<Outcome> {
  const recorded = await deps.keeper.run(() => record(deps, writer, intent))
  if (recorded.kind === "done") return recorded.outcome
  // Off the keeper: no other seat's command waits on containers or your repo.
  await deps.keeper.track(deps.work.teardown(recorded.teardown))
  const { unload } = recorded
  if (unload.length > 0)
    await deps.keeper.run(async () => {
      for (const root of unload) await deps.basics.docs.unload(root)
    })
  return recorded.outcome
}

/** Gather, plan, and write the place: the first part, on the keeper. */
async function record(
  deps: BoardDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "move-task" }>,
): Promise<Recorded> {
  const { session, now } = deps.basics
  // gather: the board
  const workflow = readWorkflow(session)
  if (workflow === null)
    return done(refused(ERR.UNKNOWN_STATE, "the board has no states yet"))
  // plan the move (pure)
  const moved = planTaskMove({
    task: intent.task,
    from: intent.from,
    to: intent.to,
    before: intent.before,
    by: writer,
    now: now(),
    workflow,
    places: readBoardPlaces(session),
    tasks: boardTasks(deps.basics),
    names: readParticipantNames(session),
  })
  if (moved.kind === "refused") return done(moved)
  if (moved.kind === "unchanged") return done(MOVED)
  const writes = moved.places.map(p => setRecord(BOARD, p))
  if (moved.transition === "within") {
    await deps.records.writeValues(writes)
    return done(MOVED)
  }
  // gather what crossing the archive's edge needs, and plan it (pure)
  const crossed = await planCrossing(deps, intent.task, moved.transition)
  if (crossed.kind === "refused") return done(crossed)
  // execute
  await deps.records.writeValues(writes)
  return {
    kind: "follow",
    outcome: MOVED,
    teardown: crossed.teardown,
    unload: crossed.unload,
  }
}

/**
 * The documents of the task's roots (ADR-0063), opened if they are not, and
 * `planArchive` over them: the task's threads' lanes, its lanes of their
 * own with their tips, their revisions, and which of its roots another task
 * or an inventory still holds.
 */
async function planCrossing(
  deps: BoardDeps,
  task: TaskId,
  crossing: Crossing,
): Promise<ReturnType<typeof planArchive>> {
  const { session, docs, live, places } = deps.basics
  const cards = readPlaces(places)
  const tasks = tasksNow(deps.basics)
  const threads = tasks.threadsOf.get(task) ?? []
  const roots = tasks.rootsOf.get(task) ?? []
  const blank = await deps.cards.blankQueued(cards)
  const records = readLaneRecords(session)
  const holds = readQueueHolds(session)
  const lanes = []
  const own = []
  const revisions = new Map<EntryId, RevisionRecord>()
  const trees = []
  for (const root of roots) {
    const doc = await docs.root(root)
    const index = readTreeIndex(doc)
    trees.push(index)
    lanes.push(...readLanes({ doc, live }, index, cards, holds, blank))
    for (const [entry, r] of readRevisions(doc)) revisions.set(entry, r)
    if (deps.work.repo !== null)
      for (const lane of threads) {
        const r = records.get(lane)
        if (r?.root === root && r.ownCopy)
          own.push({ lane, tip: readLaneTip(doc, lane), index })
      }
  }
  // The roots another live task or an inventory holds a thread of, this
  // one counted as archived.
  const archived = new Set([...readArchived(session).keys(), task])
  return planArchive({
    crossing,
    threads,
    lanes,
    own,
    revisions,
    trees,
    roots,
    stillHeld: rootsHeld(cards, readThreads(session), archived),
  })
}

const done = (outcome: Outcome): Recorded => ({ kind: "done", outcome })

/**
 * Change the workflow's states: gather, plan, write. One step on the
 * documents' keeper, which the dispatcher runs it in (`placeOfCommand`).
 */
export async function handleWorkflow(
  deps: Pick<BoardDeps, "basics" | "records">,
  intent: Extract<Intent, { kind: "workflow" }>,
): Promise<Outcome> {
  const { session, newId } = deps.basics
  const workflow = readWorkflow(session)
  if (workflow === null)
    return refused(ERR.UNKNOWN_STATE, "the board has no states yet")
  const board = boardOf(
    workflow,
    readBoardPlaces(session),
    boardTasks(deps.basics),
  )
  const planned = planWorkflowEdit(workflow, board, intent.edit, newId)
  if (planned.kind === "refused") return planned
  if (planned.kind === "write")
    await deps.records.writeValues([setRecord(WORKFLOW, planned.workflow)])
  return { kind: "workflow-changed" }
}
