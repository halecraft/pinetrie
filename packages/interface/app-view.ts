// interface/app-view — what the page shows, decided.
//
// `appView` decides; it does not project. The projections (`projectColumns`,
// `pathIds`, `branchColors`, `unsentSignals`) stay in `App`'s own `useMemo`s and
// their results come in: one tree rebuilt each render would give every
// memoised child new props.

import {
  type AccessRecord,
  type AgentWork,
  type ArchivedCanvas,
  ancestry,
  type CanvasId,
  type EntryId,
  isBusy,
  type LaneRecord,
  type LaneView,
  laneWork,
  moreWork,
  type ProposedChangesRecord,
  projectRail,
  type RailRow,
  type RootId,
  type ThreadId,
  type ThreadName,
  type TreeIndex,
  threadFirstMessage,
  type Workflow,
  type WriterId,
} from "@pinetrie/core"
import { displayName, proposedChangesStatus } from "@pinetrie/rules"
import { PENDING_TRACK } from "./column-paths.ts"
import type { Column } from "./columns.ts"
import type { Intent } from "./intent.ts"
import type { Here } from "./layout.ts"
import { rootSeed, SLOTS, STRIDE } from "./palette.ts"
import type { Reader } from "./send.ts"
import { linkWords, type ThreadLink } from "./thread-link.ts"

/**
 * A column nothing may be written in: its composer stays mounted,
 * disabled, so what was typed survives, and shows `label` and `action` in
 * place of its buttons. `action` is null when nothing can restore it (no
 * workflow yet).
 */
export interface ReadOnly {
  readonly label: string
  readonly action: { readonly title: string; readonly intent: Intent } | null
}

/** One thread column drawn whole, of the canvas you are on or of a new canvas. */
export interface ColumnSlot {
  readonly key: string
  readonly track: number
}

export type Stage =
  /** Before the first `prune`: nothing is chosen yet. */
  | { readonly kind: "connecting" }
  /** No canvas: the board, and ＋. */
  | { readonly kind: "nothing" }
  | {
      readonly kind: "canvas"
      readonly canvas: CanvasId
      readonly readOnly: ReadOnly | null
      readonly slots: readonly ColumnSlot[]
    }

/** Facts `App` already holds; nothing here is projected again. */
export interface AppViewInput {
  readonly active: Here | null
  /** The canvas's thread columns drawn whole (`openColumns`). */
  readonly columns: readonly Column[]
  /** `branchColors(tracks, views).track`, memoised by `App`. */
  readonly tracks: readonly number[]
  readonly archived: ReadonlyMap<CanvasId, ArchivedCanvas>
  readonly workflow: Workflow | null
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly proposedByLane: ReadonlyMap<ThreadId, ProposedChangesRecord>
  /** Each lane's ssh identities and its owner's answers. */
  readonly access: ReadonlyMap<ThreadId, AccessRecord>
  /** The lanes of the roots this tab holds. */
  readonly lanes: readonly LaneView[]
  /** Every lane's root entry (`laneRootEntries`), held or not. */
  readonly laneRoots: ReadonlyMap<ThreadId, EntryId>
}

/** Every lane's root entry: its `LaneRecord`'s root, through `rootEntries`. */
export const laneRootEntries = (
  records: ReadonlyMap<ThreadId, LaneRecord>,
  rootEntries: ReadonlyMap<RootId, EntryId>,
): ReadonlyMap<ThreadId, EntryId> =>
  new Map(
    [...records.values()].flatMap(r => {
      const entry = rootEntries.get(r.root)
      return entry === undefined ? [] : [[r.lane, entry] as const]
    }),
  )

/**
 * The agent's work in each thread, held by this tab or not: each held
 * lane's that is busy (`laneWork`), and every lane running in the session,
 * running winning. What refuses a canvas's move to the
 * archive, and, but for `held`, what rings it in the sidebar and on the
 * board (`threadStatus`).
 */
export function threadWork(input: {
  /** The lanes of the roots this tab holds. */
  readonly lanes: readonly LaneView[]
  /** Lanes running in any root (`readRunningLanes`). */
  readonly running: readonly { readonly lane: ThreadId }[]
}): ReadonlyMap<ThreadId, AgentWork> {
  const work = new Map<ThreadId, AgentWork>()
  for (const lane of input.lanes)
    if (isBusy(lane)) work.set(lane.name, laneWork(lane))
  for (const { lane } of input.running) work.set(lane, "running")
  return work
}

/**
 * Each canvas's work: the most among its threads', running over
 * waiting over held. A thread in no canvas counts for none.
 */
export function canvasWork(
  threads: ReadonlyMap<ThreadId, AgentWork>,
  canvasOfThread: ReadonlyMap<ThreadId, CanvasId>,
): ReadonlyMap<CanvasId, AgentWork> {
  const out = new Map<CanvasId, AgentWork>()
  for (const [thread, work] of threads) {
    const canvas = canvasOfThread.get(thread)
    if (canvas !== undefined) out.set(canvas, moreWork(out.get(canvas), work))
  }
  return out
}

/**
 * Open proposed changes (`proposedChangesStatus`), for your inbox and the
 * board's ⇡: its lane, its root entry, and where it opens: its lane's tip, or
 * its root entry in a root this tab does not hold.
 */
export interface OpenProposedChanges {
  readonly lane: ThreadId
  readonly root: EntryId
  readonly end: EntryId
  /**
   * The lane tip it holds (jj proposed changes' `ledger.source`, folder
   * proposed changes' `tip`): "not needed" holds until new work moves it. Null
   * for jj proposed changes whose message carries none.
   */
  readonly source: string | null
}

/** A lane waiting for its owner's answer about ssh, where choosing it opens. */
export interface SshAsk {
  readonly lane: ThreadId
  readonly end: EntryId
  readonly host: string | null
}

export function appView(input: AppViewInput): {
  readonly stage: Stage
  /** Open proposed changes whose lane have a tip, for your inbox and the board. */
  readonly openProposed: readonly OpenProposedChanges[]
  /** Lanes waiting for their owner's answer, for the owner's inbox. */
  readonly sshAsks: readonly SshAsk[]
} {
  return {
    stage: stageOf(input),
    openProposed: openProposed(input),
    sshAsks: sshAsks(input),
  }
}

/** Each lane that waits for its owner, at its tip where this tab holds it, else its root. */
const sshAsks = (input: AppViewInput): readonly SshAsk[] =>
  [...input.access.values()].flatMap(a => {
    const root = input.laneRoots.get(a.lane)
    if (a.personal?.kind !== "waiting" || root === undefined) return []
    const tip = input.lanes.find(l => l.name === a.lane)?.tip ?? null
    return [{ lane: a.lane, end: tip ?? root, host: a.personal.host }]
  })

function stageOf(input: AppViewInput): Stage {
  const { active, columns, tracks } = input
  if (active === null) return { kind: "connecting" }
  const slots = columns.map(
    (c, position): ColumnSlot => ({
      key: c.key,
      track: tracks[position] ?? PENDING_TRACK,
    }),
  )
  switch (active.kind) {
    case "nothing":
      return { kind: "nothing" }
    case "canvas": {
      const archived = input.archived.get(active.canvas)
      return {
        kind: "canvas",
        canvas: active.canvas,
        readOnly:
          archived === undefined
            ? null
            : readOnlyWords(archived, input.workflow, input.nameOf),
        slots,
      }
    }
  }
}

/**
 * The proposed changes with work to add (`proposedChangesStatus`'s `open`; not
 * one accepted, nor one accepted work already holds), each in a root with an
 * entry. A lane this tab holds opens at its tip, and one with none yet is left
 * out; any other lane opens at its root entry.
 */
const openProposed = (input: AppViewInput): readonly OpenProposedChanges[] =>
  [...input.proposedByLane.values()].flatMap(o => {
    const root = input.laneRoots.get(o.lane)
    if (proposedChangesStatus(o).kind !== "open" || root === undefined)
      return []
    const source = o.kind === "jj" ? (o.ledger?.source ?? null) : o.tip
    const held = input.lanes.find(l => l.name === o.lane)
    if (held === undefined) return [{ lane: o.lane, root, end: root, source }]
    return held.tip === null
      ? []
      : [{ lane: o.lane, root, end: held.tip, source }]
  })

/** A fork on the rail to a thread on no column of this canvas. */
export interface RailStub {
  /** The row it forks from. */
  readonly from: EntryId
  /** The thread's first entry. */
  readonly at: EntryId
  readonly thread: ThreadId
  /** Where it is: another canvas, your inventory, someone else's. */
  readonly link: ThreadLink
}

/** What the rail draws for the canvas you are on. */
export interface CanvasRail {
  readonly rows: readonly RailRow[]
  readonly stubs: readonly RailStub[]
}

/** No rail: off a canvas. */
export const NO_RAIL: CanvasRail = { rows: [], stubs: [] }

/**
 * The rail of the canvas you are on, a forest: one tree
 * for each root a thread of the canvas is in, in canvas order, each cut to
 * the paths that lead to its threads' ends (`ends`); each fork from those
 * paths to a thread elsewhere a stub naming where it is (`linkOf`). Each
 * tree is drawn in its root's palette: its tracks are shifted so the
 * page's seed (`seed`) gives each one the slot its root's seed would
 * (`trackSlot`), so its columns and fork dots, which take their rows'
 * tracks, agree. None off a canvas.
 */
export function canvasRail(input: {
  readonly index: TreeIndex
  readonly active: Here | null
  /** The canvas's roots and their root entries, in canvas order. */
  readonly roots: readonly { readonly root: RootId; readonly entry: EntryId }[]
  /** Where each thread on the canvas ends (`threadAnchor`, a copy's fork). */
  readonly ends: ReadonlyMap<ThreadId, EntryId>
  readonly linkOf: (thread: ThreadId) => ThreadLink
  /** The page's seed (`rootSeed` of its first root). */
  readonly seed: number
}): CanvasRail {
  const { index, active } = input
  if (active?.kind !== "canvas") return NO_RAIL
  // Every entry on a path to a thread's end, the ends' own included.
  const keep = new Set<EntryId>()
  for (const end of input.ends.values())
    for (const id of ancestry(index, end).path) keep.add(id)
  const rows: RailRow[] = []
  const stubs: RailStub[] = []
  for (const { root, entry } of input.roots) {
    const shift = shiftOf(input.seed, rootSeed(root))
    for (const row of projectRail(index, entry)) {
      if (!keep.has(row.id)) continue
      rows.push({ ...row, track: row.track + shift })
      // A child in another thread starts it; its stub opens at
      // the thread's first message, which is often below a context entry.
      const own = index.entries[row.id]?.thread
      for (const child of index.childrenOf.get(row.id) ?? []) {
        const thread = index.entries[child]?.thread
        if (keep.has(child) || thread === undefined || thread === own) continue
        const link = input.linkOf(thread)
        if (link.kind !== "gone")
          stubs.push({
            from: row.id,
            at: threadFirstMessage(index, thread) ?? child,
            thread,
            link,
          })
      }
    }
  }
  return { rows, stubs }
}

/** A stub's words: the thread's name, and where it is ("Bea has it"). */
export const railStubWords = (
  stub: RailStub,
  names: ReadonlyMap<ThreadId, ThreadName>,
  reader: Reader,
  labelOf: (canvas: CanvasId) => string,
): { readonly label: string; readonly title: string } => ({
  label: `↳ ${names.get(stub.thread) ?? "a thread"}`,
  title: linkWords(stub.link, reader, labelOf),
})

/**
 * How far a tree's tracks move so that `seed`, the page's, draws them as
 * `own`, its root's, would: `STRIDE` is 7, its own inverse in the 12 slots.
 */
const shiftOf = (seed: number, own: number): number =>
  (((STRIDE * (own - seed)) % SLOTS) + SLOTS) % SLOTS

/**
 * What an archived canvas's column says and offers: who moved it to
 * the archive, and Restore, which moves it to the first open state.
 */
export function readOnlyWords(
  archived: ArchivedCanvas,
  workflow: Workflow | null,
  nameOf: ReadonlyMap<WriterId, string>,
): ReadOnly {
  const to = workflow?.open[0]
  return {
    label: `archived by ${displayName(archived.by, nameOf.get(archived.by))}`,
    action:
      workflow === null || to === undefined
        ? null
        : {
            title: "Restore",
            intent: {
              kind: "moveCanvas",
              canvas: archived.canvas,
              from: workflow.archive.id,
              to: to.id,
              before: null,
              closes: false,
            },
          },
  }
}
