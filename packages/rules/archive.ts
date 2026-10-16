// archive — what crossing the archive's edge does, and the canvases a command
// writes in, which the gate (`gate.ts`) keeps out of an archived canvas.

import {
  type AgentWork,
  type ArchivedCanvas,
  atEntry,
  type CanvasId,
  type CardId,
  type CardRecord,
  type EntryId,
  ERR,
  type Gated,
  type LaneView,
  type MoveTarget,
  nearestRevision,
  type PointId,
  type Refusal,
  type RevisionRecord,
  type RootId,
  refused,
  type SnapshotId,
  type ThreadId,
  type TreeIndex,
  threadEnd,
  threadsWork,
  type VerdictRecord,
} from "@pinetrie/core"
import {
  type CanvasIndex,
  canvasOfCard,
  canvasOfTarget,
} from "./canvas-index.ts"
import { unclassifiedPending } from "./verdict.ts"
import { planRetention } from "./work.ts"

/** Into the archive, or out of it: `transitionOf`'s crossings. */
export type Crossing = "archive" | "restore"

/**
 * What archiving or restoring does off the documents' keeper, after the canvas's
 * place is written: lanes to forget and remove (their containers
 * and disks), their refs in your repo moved (null deletes, on archiving), and
 * snapshots to delete. Empty on a host without lanes of their own.
 */
export interface ArchiveTeardown {
  readonly forget: readonly ThreadId[]
  readonly refs: readonly {
    readonly lane: ThreadId
    readonly point: PointId | null
  }[]
  readonly snapshots: readonly SnapshotId[]
}

type ArchivePlan =
  | Refusal
  | {
      readonly kind: "cross"
      /** Off the keeper, after the place is written. */
      readonly teardown: ArchiveTeardown
      /** On the keeper again, after the teardown: the roots to let go of. */
      readonly unload: readonly RootId[]
      /**
       * With the place, on archiving: each of the canvas's threads' verdicts
       * still pending, `unclassified`. Its run's end, a late write, is
       * refused from now on, and would have been the one to write it.
       */
      readonly verdicts: readonly VerdictRecord[]
    }

/** Why a canvas cannot be archived now, as the board and the host both say it. */
export const CANVAS_BUSY_REASON = {
  running: "an agent is working here",
  waiting: "cards are queued here",
  held: "cards are queued here",
} as const satisfies Record<AgentWork, string>

/**
 * Decide what crossing the archive's edge does for a canvas. A canvas an agent
 * of its threads works in, or where cards are queued, is not archived:
 * stopping the run or holding the queue would do work nobody asked for, so
 * the person chooses. Restoring is never busy. Archiving lets go
 * of the roots no canvas outside the archive, and no inventory, still holds a
 * thread of (`stillHeld`).
 */
export function planArchive(input: {
  readonly crossing: Crossing
  readonly threads: readonly ThreadId[]
  readonly lanes: readonly LaneView[]
  /**
   * The canvas's lanes of their own, by their records, with each one's tip
   * and its root's tree; empty on a host without lanes of their own.
   */
  readonly own: readonly {
    readonly lane: ThreadId
    readonly tip: EntryId | null
    readonly index: TreeIndex
  }[]
  /** Its roots' revision records: what its lanes' turns recorded. */
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
  /** Its roots' trees, whose every thread's end keeps its snapshot. */
  readonly trees: readonly TreeIndex[]
  /** The roots of the canvas's threads. */
  readonly roots: readonly RootId[]
  /** The roots a thread outside this canvas, in no archived canvas, is in. */
  readonly stillHeld: ReadonlySet<RootId>
  /** Every thread's verdict, by its lane. */
  readonly verdicts: ReadonlyMap<ThreadId, VerdictRecord>
}): ArchivePlan {
  const { crossing } = input
  const busy = threadsWork(input.lanes, new Set(input.threads))
  if (crossing === "archive" && busy !== undefined)
    return refused(ERR.CANVAS_BUSY, CANVAS_BUSY_REASON[busy])
  return {
    kind: "cross",
    teardown: planTeardown(crossing, input),
    unload:
      crossing === "archive"
        ? input.roots.filter(r => !input.stillHeld.has(r))
        : [],
    verdicts:
      crossing === "archive"
        ? unclassifiedPending(input.verdicts.values(), lane =>
            input.threads.includes(lane),
          )
        : [],
  }
}

/**
 * Archive: every own lane gone (`planLanesGone`). Restore: each lane's ref
 * back at its tip's nearest revision (`nearestRevision`), none for a lane
 * with no tip or no revision yet.
 */
function planTeardown(
  crossing: Crossing,
  input: Pick<Parameters<typeof planArchive>[0], "own" | "revisions" | "trees">,
): ArchiveTeardown {
  if (crossing === "archive")
    return planLanesGone(
      input.own.map(o => o.lane),
      input.revisions,
      input.trees,
    )
  return {
    forget: [],
    refs: input.own.flatMap(({ lane, tip, index }) => {
      if (tip === null) return []
      const { point } = nearestRevision(index, input.revisions, {
        kind: "entry",
        id: tip,
      })
      return point === null ? [] : [{ lane, point }]
    }),
    snapshots: [],
  }
}

/**
 * Lanes that will not run again, an archived canvas's or a deleted thread's: each
 * forgotten, its ref deleted (which withdraws its proposed changes), and every
 * snapshot of it but its newest and the one nearest each thread's end in
 * `trees`, whatever canvas that thread is in (`planRetention`), so a copy from
 * the archive finds its files.
 */
export function planLanesGone(
  lanes: readonly ThreadId[],
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
  trees: readonly TreeIndex[],
): ArchiveTeardown {
  const gone = new Set<string>(lanes)
  return {
    forget: lanes,
    refs: lanes.map(lane => ({ lane, point: null })),
    snapshots: planRetention({
      records: [...revisions.values()].filter(r => gone.has(r.lane)),
      archived: true,
      keep: endSnapshots(trees, revisions),
    }),
  }
}

/**
 * The canvases a command or a send writes in, none for a name, a
 * picture, a stop, a move on the board or a change to its states, a
 * reservation, a card's command, or traces seen. A send at a thread's end,
 * or popped from its queue, writes in the thread's canvas, a branch in the
 * canvas it lands in; proposed changes,
 * a carry-on and a queue's hold in their lane's thread's; a card's move in
 * the canvas each card leaves as well as the one it goes to, so nothing moves
 * out of an archived canvas; an undo of moves, a mark and a retitle in their
 * own.
 */
export function writesIn(
  intent: Gated,
  canvases: CanvasIndex,
  cards: readonly CardRecord[],
): readonly CanvasId[] {
  const canvasLookup = {
    thread: (t: ThreadId) => canvases.canvasOfThread.get(t) ?? null,
    place: (to: MoveTarget) => canvasOfTarget(canvases, to),
    card: (id: CardId) => canvasOfCard(canvases, cards, id),
  }
  const only = (
    ...canvases: readonly (CanvasId | null)[]
  ): readonly CanvasId[] =>
    canvases.filter(
      (t, i): t is CanvasId => t !== null && canvases.indexOf(t) === i,
    )
  switch (intent.kind) {
    case "send":
      return only(
        intent.at.kind === "branch"
          ? intent.at.canvas
          : canvasLookup.thread(intent.at.thread),
      )
    // An action on proposed changes acts at its lane's tip: an archived canvas's
    // lanes offer no work out. A carry-on writes its message there.
    case "proposed":
    case "carry-on":
    // A queue's hold, and its cards unqueued, are its lane's thread's.
    case "queue-hold":
    case "unqueue-all":
      return only(canvasLookup.thread(intent.lane))
    // A card queued writes in its queue's canvas, and leaves its own.
    case "queue-card":
      return only(
        canvasLookup.place(intent.move.to),
        canvasLookup.card(intent.move.card),
      )
    // A thread opened writes in the canvas its card lands in, as a
    // proposal's branches do.
    case "open-thread":
    case "branch-out":
      return only(intent.canvas)
    // A spin-off writes a new canvas, in no archive, and the card leaves its
    // own for the history its trash place names.
    case "spin-off":
      return only(
        canvasLookup.card(intent.move.card),
        canvasLookup.place(intent.move.to),
      )
    // A copy writes in the canvas its card lands in alone: an archived
    // thread is copied, since archiving freezes its end, not its history.
    case "copy-thread":
      return only(canvasLookup.place(intent.move.to))
    // A paste writes where it lands, and discards the card it replaces
    // where that is (an edit as text's reference, a slot's card).
    case "paste":
      return only(
        canvasLookup.place(intent.to),
        intent.replacing === null
          ? null
          : canvasLookup.card(intent.replacing.card),
      )
    // A reorder stays in the place it names.
    case "reorder":
      return only(canvasLookup.place(intent.reorder.at))
    // A width is drawn on the canvas it names.
    case "card-width":
      return only(intent.at.canvas)
    // A note column's title writes in its column's canvas.
    case "mark":
      return intent.of.kind === "canvas"
        ? [intent.of.canvas]
        : only(canvasLookup.card(intent.of.column))
    case "retitle":
      return [intent.canvas]
    case "undo-move":
      return intent.canvas === null ? [] : [intent.canvas]
    case "move":
      return only(
        ...intent.moves.flatMap(m => [
          canvasLookup.place(m.to),
          canvasLookup.card(m.card),
        ]),
      )
    case "name":
    case "picture":
    case "stop":
    // The board is the session's: a move into or out of the archive writes
    // in no canvas, so an archived canvas can be restored.
    case "move-canvas":
    case "workflow":
    case "reserve":
    // Accepted work is your repo's, in no canvas.
    case "setup":
    case "publish":
    // A command acts only when its card is popped, its send cleared then.
    case "set-command":
    // Traces are the session's, in no canvas.
    case "traces-seen":
    // An answer to a lane's ssh writes its access record, in no canvas: the
    // owner can take back what an archived canvas's lane holds.
    case "ssh-access":
      return []
  }
}

/** The archived canvas among the `written` canvases, which makes it read-only, or null. */
export function archivedIn(
  written: readonly CanvasId[],
  archived: ReadonlyMap<CanvasId, ArchivedCanvas>,
): ArchivedCanvas | null {
  for (const canvas of written) {
    const found = archived.get(canvas)
    if (found !== undefined) return found
  }
  return null
}

/** The snapshot nearest each thread's end in `trees` (`nearestRevision`). */
function endSnapshots(
  trees: readonly TreeIndex[],
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): ReadonlySet<SnapshotId> {
  const keep = new Set<SnapshotId>()
  for (const index of trees)
    for (const thread of index.firstOf.keys()) {
      const end = threadEnd(index, thread)
      if (end === null) continue
      const { snapshot } = nearestRevision(index, revisions, atEntry(end))
      if (snapshot !== null) keep.add(snapshot)
    }
  return keep
}
