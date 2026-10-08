// host/commands/board — move a root on the board, or change its workflow
// states (ADR-0122).
//
// A move runs in up to three parts (ADR-0065). On the documents' keeper:
// gather the workflow and the places, plan the move (`planRootMove`); if it
// crosses the closed state's edge, gather the root's document and plan the
// crossing (`planArchive`); then write the place, from which moment the
// archive gate refuses writes into a closed root. Off the keeper: the
// crossing's teardown (its lanes' containers, their refs in your repo through
// the owner, snapshots). Then, for a close, the root's document unloaded on
// the keeper again. The sender's reply comes after all of it.

import {
  type EntryId,
  ERR,
  type Intent,
  type LaneName,
  type RootId,
  refused,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readBoardPlaces,
  readLaneRecords,
  readLanes,
  readParticipantNames,
  readPlaces,
  readQueueHolds,
  readRevisions,
  readRoots,
  readTreeIndex,
  readWorkflow,
} from "@pinetrie/reads"
import {
  type ArchiveTeardown,
  BOARD,
  boardOf,
  type Crossing,
  planArchive,
  planRootMove,
  planWorkflowEdit,
  setRecord,
  WORKFLOW,
} from "@pinetrie/rules"
import { readLaneTip, type SessionDocHandle } from "@pinetrie/schema"
import type { Basics, HostKeeper } from "../basics.ts"
import type { CardPort } from "../cards.ts"
import type { Records } from "../records.ts"
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

/** The lanes of their own that work in `root`, from their records. */
const lanesIn = (session: SessionDocHandle, root: RootId): LaneName[] =>
  [...readLaneRecords(session).values()]
    .filter(r => r.root === root && r.ownCopy)
    .map(r => r.lane)

/** The roots the board shows: every root in the directory with a message. */
const boardRoots = (session: SessionDocHandle): readonly RootId[] =>
  [...readRoots(session).values()].flatMap(r =>
    r.entry === null ? [] : [r.root],
  )

/** What the keeper's first step decided: the answer, and what follows it. */
type Recorded =
  | { readonly kind: "done"; readonly outcome: Outcome }
  | {
      readonly kind: "follow"
      readonly outcome: Outcome
      readonly teardown: ArchiveTeardown
      readonly unload: RootId | null
    }

const MOVED: Outcome = { kind: "moved-root" }

export async function handleRootMove(
  deps: BoardDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "move-root" }>,
): Promise<Outcome> {
  const recorded = await deps.keeper.run(() => record(deps, writer, intent))
  if (recorded.kind === "done") return recorded.outcome
  // Off the keeper: no other seat's command waits on containers or your repo.
  await deps.keeper.track(deps.work.teardown(recorded.teardown))
  const { unload } = recorded
  if (unload !== null)
    await deps.keeper.run(() => deps.basics.docs.unload(unload))
  return recorded.outcome
}

/** Gather, plan, and write the place: the first part, on the keeper. */
async function record(
  deps: BoardDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "move-root" }>,
): Promise<Recorded> {
  const { session, now } = deps.basics
  // gather: the board
  const workflow = readWorkflow(session)
  if (workflow === null)
    return done(refused(ERR.UNKNOWN_STATE, "the board has no states yet"))
  // plan the move (pure)
  const moved = planRootMove({
    root: intent.root,
    from: intent.from,
    to: intent.to,
    before: intent.before,
    by: writer,
    now: now(),
    workflow,
    places: readBoardPlaces(session),
    roots: boardRoots(session),
    names: readParticipantNames(session),
  })
  if (moved.kind === "refused") return done(moved)
  if (moved.kind === "unchanged") return done(MOVED)
  const writes = moved.places.map(p => setRecord(BOARD, p))
  if (moved.transition === "within") {
    await deps.records.writeValues(writes)
    return done(MOVED)
  }
  // gather what crossing the closed state's edge needs, and plan it (pure)
  const entry = readRoots(session).get(intent.root)?.entry ?? null
  if (entry === null) return done(refused(ERR.UNKNOWN_TARGET, "no such root"))
  const crossed = await planCrossing(deps, intent.root, entry, moved.transition)
  if (crossed.kind === "refused") return done(crossed)
  // execute
  await deps.records.writeValues(writes)
  return {
    kind: "follow",
    outcome: MOVED,
    teardown: crossed.teardown,
    unload: crossed.unload ? intent.root : null,
  }
}

/** The root's own document (ADR-0063), opened if it is not, and `planArchive` over it. */
async function planCrossing(
  deps: BoardDeps,
  root: RootId,
  entry: EntryId,
  crossing: Crossing,
): Promise<ReturnType<typeof planArchive>> {
  const { session, docs, live, places } = deps.basics
  const doc = await docs.root(root)
  const blank = await deps.cards.blankQueued(readPlaces(places))
  const index = readTreeIndex(doc)
  const own =
    deps.work.repo === null
      ? []
      : lanesIn(session, root).map(lane => ({
          lane,
          tip: readLaneTip(doc, lane),
        }))
  return planArchive({
    crossing,
    root: entry,
    index,
    lanes: readLanes(
      { doc, live },
      index,
      readPlaces(places),
      readQueueHolds(session),
      blank,
    ),
    own,
    revisions: readRevisions(doc),
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
  const board = boardOf(workflow, readBoardPlaces(session), boardRoots(session))
  const planned = planWorkflowEdit(workflow, board, intent.edit, newId)
  if (planned.kind === "refused") return planned
  if (planned.kind === "write")
    await deps.records.writeValues([setRecord(WORKFLOW, planned.workflow)])
  return { kind: "workflow-changed" }
}
