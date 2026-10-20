// host/commands/board — move a canvas on the board, or change its workflow
// states.
//
// A move runs in up to three parts. On the documents' keeper: gather the
// workflow and the places, plan the canvas card's move (`planBoardMove`); if it
// crosses the archive's edge, gather the documents of the canvas's roots and plan
// the crossing (`planArchive`); then write the card (`placeCanvas`), from which
// moment the archive gate refuses writes into the archived canvas. Off the
// keeper: the crossing's teardown (its lanes' containers, their refs in your
// repo through the owner, snapshots). Then, on archiving, the task's stacks of
// moves let go on the keeper again. The sender's reply comes after all of it.
// Its roots go as any root does: the upkeep lets go of what nothing holds.

import {
  type CanvasId,
  type EntryId,
  ERR,
  type Intent,
  type RevisionRecord,
  refused,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readLaneRecords,
  readLanes,
  readPlaces,
  readQueueHolds,
  readRevisions,
  readRunEndReports,
  readTreeIndex,
  readWorkflow,
} from "@pinetrie/reads"
import {
  type ArchiveTeardown,
  type Crossing,
  planArchive,
  planBoardMove,
  planWorkflowChange,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import type { Basics, HostKeeper } from "../basics.ts"
import { canvasesNow } from "../canvases.ts"
import type { CardPort } from "../cards.ts"
import type { MoveHistories } from "../move-history.ts"
import type { Records } from "../records.ts"
import type { StepDocs } from "../roots.ts"

import type { LaneWork } from "../work/index.ts"
import {
  type CardCommands,
  type Settled,
  settled,
  unmovedOutcome,
} from "./cards.ts"

export interface BoardDeps {
  readonly basics: Pick<Basics, "session" | "live" | "places" | "now" | "newId">
  readonly records: Pick<Records, "writeValues">
  readonly work: Pick<LaneWork, "teardown" | "destination">
  readonly keeper: Pick<HostKeeper, "run" | "track">
  /** Which queued cards are blank: they leave a lane idle. */
  readonly cards: Pick<CardPort, "blankQueued">
  /** The canvas's card written, with its history (`placeCanvas`), in the step whose documents are `roots`. */
  readonly moves: (roots: StepDocs) => Pick<CardCommands, "placeCanvas">
  /** An archived canvas's stacks of moves are let go. */
  readonly histories: Pick<MoveHistories, "unloadCanvas">
}

/** What the keeper's first step decided: the answer, and what follows it. */
type Recorded =
  | { readonly kind: "done"; readonly outcome: Settled }
  | {
      readonly kind: "follow"
      readonly outcome: Settled
      readonly teardown: ArchiveTeardown
      readonly crossing: Crossing
    }

export async function handleCanvasMove(
  deps: BoardDeps,
  writer: WriterId,
  intent: Extract<Intent, { kind: "move-canvas" }>,
): Promise<Settled> {
  const recorded = await deps.keeper.run(roots =>
    record(deps, roots, writer, intent),
  )
  if (recorded.kind === "done") return recorded.outcome
  // Off the keeper: no other seat's command waits on containers or your repo.
  await deps.keeper.track(deps.work.teardown(recorded.teardown))
  if (recorded.crossing === "archive")
    await deps.keeper.run(() => deps.histories.unloadCanvas(intent.canvas))
  return recorded.outcome
}

/** Gather, plan, and write the canvas's card: the first part, on the keeper. */
async function record(
  deps: BoardDeps,
  roots: StepDocs,
  writer: WriterId,
  intent: Extract<Intent, { kind: "move-canvas" }>,
): Promise<Recorded> {
  const { session, places } = deps.basics
  // gather: the board
  const workflow = readWorkflow(session)
  if (workflow === null)
    return done(refused(ERR.UNKNOWN_STATE, "the board has no states yet"))
  const cards = readPlaces(places)
  // plan the move (pure)
  const moved = planBoardMove({
    canvas: intent.canvas,
    from: intent.from,
    to: intent.to,
    before: intent.before,
    sender: writer,
    workflow,
    cards,
  })
  if (moved.kind === "refused")
    return {
      kind: "done",
      outcome: settled(unmovedOutcome(moved), places.rev()),
    }
  if (moved.kind === "unchanged") return done({ kind: "moved" })
  if (moved.transition === "within")
    return {
      kind: "done",
      outcome: await deps.moves(roots).placeCanvas(writer, moved),
    }
  // gather what crossing the archive's edge needs, and plan it (pure)
  const crossed = await planCrossing(
    deps,
    roots,
    intent.canvas,
    moved.transition,
  )
  if (crossed.kind === "refused") return done(crossed)
  // execute
  const outcome = await deps.moves(roots).placeCanvas(writer, moved)
  if (crossed.writes.length > 0) await deps.records.writeValues(crossed.writes)
  return {
    kind: "follow",
    outcome,
    teardown: crossed.teardown,
    crossing: moved.transition,
  }
}

/**
 * The documents of the canvas's roots, loaded through the step's `roots`, and
 * `planArchive` over them: the canvas's threads' lanes, its lanes of their own
 * with their tips, and their revisions, and which of its roots another canvas or an inventory still
 * holds.
 */
async function planCrossing(
  deps: BoardDeps,
  docs: StepDocs,
  canvas: CanvasId,
  crossing: Crossing,
): Promise<ReturnType<typeof planArchive>> {
  const { session, live, places } = deps.basics
  const cards = readPlaces(places)
  const canvases = canvasesNow(deps.basics)
  const threads = canvases.threadsOf.get(canvas) ?? []
  const roots = canvases.rootsOf.get(canvas) ?? []
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
    if (deps.work.destination !== null)
      for (const lane of threads) {
        const r = records.get(lane)
        if (r?.root === root && r.history !== null)
          own.push({ lane, tip: readLaneTip(doc, lane), index })
      }
  }
  return planArchive({
    crossing,
    threads,
    lanes,
    own,
    revisions,
    trees,
    runEndReports: readRunEndReports(session),
  })
}

const done = (outcome: Outcome): Recorded => ({
  kind: "done",
  outcome: settled(outcome),
})

/**
 * Change the workflow's states: gather, plan, write. One step on the
 * documents' keeper, which the dispatcher runs it in (`placeOfCommand`).
 */
export async function handleWorkflow(
  deps: Pick<BoardDeps, "basics" | "records">,
  intent: Extract<Intent, { kind: "workflow" }>,
): Promise<Outcome> {
  const { session, newId } = deps.basics
  const planned = planWorkflowChange({
    workflow: readWorkflow(session),
    cards: readPlaces(deps.basics.places),
    edit: intent.edit,
    newId,
  })
  if (planned.kind === "refused") return planned
  if (planned.kind === "write") await deps.records.writeValues(planned.writes)
  return { kind: "workflow-changed" }
}
