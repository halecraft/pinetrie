// archive — what crossing the closed workflow state's edge does (ADR-0029,
// ADR-0085), and the gate that keeps a closed root read-only.
//
// A root is archived while its board place is in the closed state
// (`board.ts`). Moving it there or out writes only its place: entries are
// immutable (ADR-0004), so a root is hidden and made read-only, never
// removed. What follows the place is planned here: the busy check, the
// teardown off the documents' keeper (ADR-0065), and the unload.

import {
  type ArchivedRoot,
  type CommitId,
  type EntryId,
  ERR,
  type Intent,
  type LaneName,
  type LaneView,
  nearestRevision,
  type Refusal,
  type RevisionRecord,
  type RootId,
  refused,
  rootOf,
  rootWork,
  type SnapshotId,
  type TreeIndex,
} from "@pinetrie/core"
import { planRetention } from "./work.ts"

/** Into the closed state, or out of it: `transitionOf`'s crossings. */
export type Crossing = "close" | "reopen"

/**
 * What a close or reopen does off the documents' keeper, after the root's
 * place is written (ADR-0065): lanes to forget and remove (their containers
 * and disks), their refs in your repo moved (null deletes, close), and
 * snapshots to delete. Empty on a host without lanes of their own.
 */
export interface ArchiveTeardown {
  readonly forget: readonly LaneName[]
  readonly refs: readonly {
    readonly lane: LaneName
    readonly commit: CommitId | null
  }[]
  readonly snapshots: readonly SnapshotId[]
}

type ArchivePlan =
  | Refusal
  | {
      readonly kind: "cross"
      /** Off the keeper, after the place is written. */
      readonly teardown: ArchiveTeardown
      /** On the keeper again, after the teardown: a close only. */
      readonly unload: boolean
    }

/** Why a root cannot be closed now, as the board and the host both say it. */
export const ROOT_BUSY_REASON = {
  running: "the agent is working here",
  waiting: "cards are queued here",
} as const

/**
 * Decide what crossing the closed state's edge does. A root the agent works
 * in, or where cards are queued, is not closed: stopping the run or holding
 * the queue would do work nobody asked for, so the person chooses
 * (ADR-0029). Reopening is never busy.
 */
export function planArchive(input: {
  readonly crossing: Crossing
  readonly root: EntryId
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  /**
   * The root's lanes of their own, by their records, with each one's tip in
   * the root's document; empty on a host without lanes of their own.
   */
  readonly own: readonly {
    readonly lane: LaneName
    readonly tip: EntryId | null
  }[]
  /** The root's revision records: what its lanes' turns recorded. */
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
}): ArchivePlan {
  const { crossing, root, index } = input
  // A root is always a message (S30), so being a root is enough.
  if (rootOf(index, root) !== root)
    return refused(ERR.UNKNOWN_TARGET, "no such root")
  const busy = rootWork(index, input.lanes).get(root)
  if (crossing === "close" && busy !== undefined)
    return refused(ERR.ROOT_BUSY, ROOT_BUSY_REASON[busy])
  return {
    kind: "cross",
    teardown: planTeardown(crossing, input),
    unload: crossing === "close",
  }
}

/**
 * Close: every own lane forgotten, its ref deleted, and every snapshot but
 * each lane's newest (`planRetention`). Reopen: each lane's ref back at its
 * tip's nearest revision (`nearestRevision`), none for a lane with no tip or
 * no revision yet.
 */
function planTeardown(
  crossing: Crossing,
  input: Pick<Parameters<typeof planArchive>[0], "index" | "own" | "revisions">,
): ArchiveTeardown {
  const lanes = input.own.map(o => o.lane)
  if (crossing === "close") {
    const inRoot = new Set<string>(lanes)
    return {
      forget: lanes,
      refs: lanes.map(lane => ({ lane, commit: null })),
      snapshots: planRetention({
        records: [...input.revisions.values()].filter(r => inRoot.has(r.lane)),
        archived: true,
      }),
    }
  }
  return {
    forget: [],
    refs: input.own.flatMap(({ lane, tip }) => {
      if (tip === null) return []
      const { commit } = nearestRevision(input.index, input.revisions, {
        kind: "entry",
        id: tip,
      })
      return commit === null ? [] : [{ lane, commit }]
    }),
    snapshots: [],
  }
}

/**
 * The roots a command writes in (ADR-0063), none for a new thread at the
 * root, a name, a picture, a stop, a move on the board or a change to its states, a reservation, a card's command,
 * or a card's move into an inventory, or its removal. An offer acts in its
 * lane's root, and so does a carry-on; a move in each root its cards go to;
 * an undo of moves and a retitle in their root (ADR-0066, ADR-0074).
 */
export function writesIn(
  intent: Intent,
  rootOfLane: (lane: LaneName) => RootId | null,
): readonly RootId[] {
  const only = (root: RootId | null): readonly RootId[] =>
    root === null ? [] : [root]
  switch (intent.kind) {
    case "chat":
      return only(intent.at.kind === "root" ? null : intent.root)
    // An offer acts at its lane's tip: an archived root's lanes offer no
    // work out. A carry-on writes its message there.
    case "offer":
    case "carry-on":
    // A queue's hold, and its cards unqueued, are its lane's root's.
    case "queue-hold":
    case "unqueue-all":
      return only(rootOfLane(intent.lane))
    // A reorder stays in the place it names.
    case "reorder":
      return [intent.reorder.at.root]
    case "mark":
    case "retitle":
    case "undo-move":
      return [intent.root]
    // A move into a thread or a fresh column writes in its root; an
    // inventory is in none.
    case "move":
      return intent.moves.flatMap(({ to }) =>
        to === null || to.kind === "inventory" ? [] : [to.root],
      )
    case "name":
    case "picture":
    case "stop":
    // The board is the session's: a move into or out of the closed state
    // writes in no root, so a closed root can be reopened.
    case "move-root":
    case "workflow":
    case "reserve":
    // The line is your repo's, in no root.
    case "line":
    // A command acts only when its card is popped, behind the pop's own check.
    case "set-command":
    // Traces are the session's, in no root.
    case "traces-seen":
      return []
  }
}

/** The archived root among the `written` roots, which makes it read-only, or null. */
export function archivedIn(
  written: readonly RootId[],
  archived: ReadonlyMap<RootId, ArchivedRoot>,
): ArchivedRoot | null {
  for (const root of written) {
    const found = archived.get(root)
    if (found !== undefined) return found
  }
  return null
}
