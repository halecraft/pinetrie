// canvas — a canvas, and a thread's opening.

import {
  agentAsk,
  type CanvasId,
  type CanvasKey,
  type CanvasTarget,
  type CardId,
  type CardInPlace,
  type CardPlace,
  type CardRecord,
  type EntryId,
  forkEntry,
  hasPlaceKind,
  isThreadId,
  livePlace,
  type MoveTarget,
  makeCard,
  NO_CONTENT,
  type PlaceKey,
  type PlaceOf,
  type RankedCanvas,
  type RootId,
  type SurfaceOwner,
  surfaceOwner,
  type ThreadFork,
  type ThreadId,
  type ThreadOrigin,
  type ThreadRecord,
  type TreeIndex,
  threadOfPlace,
  type ValueWrite,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import { boardEnd, type Workflow } from "./board.ts"
import { type MakeStep, type PlaceStep, planMake } from "./place-steps.ts"
import { branchAfter, rankAfter, rankOfDrop } from "./rank.ts"
import { setRecord } from "./records.ts"
import { THREAD } from "./thread.ts"

/** A card on a canvas, in its canvas's order. */
export type CardOnCanvas = CardInPlace<"canvas">

/** A canvas card's kinds: what every consumer of a canvas switches over. */
export type KindOnCanvas = CardOnCanvas["kind"]

export const isCardOnCanvas = (c: CardRecord): c is CardOnCanvas =>
  hasPlaceKind(c, "canvas")

const onCanvas = isCardOnCanvas

const byRank = (a: CardOnCanvas, b: CardOnCanvas): number =>
  a.place.order < b.place.order
    ? -1
    : a.place.order > b.place.order
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0

/**
 * Where every card and thread is among canvases, from the places
 * and the threads' records alone: the one derivation the host and the page
 * both read, so they cannot disagree on which canvas something is in.
 */
export interface CanvasIndex {
  /** Each canvas's cards, in its canvas's order: by rank, then by id. */
  readonly cardsOn: ReadonlyMap<CanvasId, readonly CardOnCanvas[]>
  /**
   * Each canvas card's canvas, a thread's, a note column's or a media
   * column's, and each image's, its column's; a trashed one's is the canvas
   * its place was in, so its own cards keep a canvas while it is in the
   * trash.
   */
  readonly canvasOfCard: ReadonlyMap<CardId, CanvasId>
  /** Each thread's canvas, a trashed one's as `canvasOfCard`'s; a thread in an inventory has none. */
  readonly canvasOfThread: ReadonlyMap<ThreadId, CanvasId>
  /** Each canvas's thread cards, in canvas order. */
  readonly threadsOf: ReadonlyMap<CanvasId, readonly ThreadId[]>
  /**
   * The roots of each canvas's threads, each once, in the order its first
   * thread is on the canvas; a thread with no record yet is left out.
   */
  readonly rootsOf: ReadonlyMap<CanvasId, readonly RootId[]>
  /** The canvases each root has a thread in, by canvas id. */
  readonly canvasesOfRoot: ReadonlyMap<RootId, readonly CanvasId[]>
  /**
   * Each recorded thread's root: a place at a thread names no root, so a
   * place's root is its thread's (`THREAD`).
   */
  readonly rootOfThread: ReadonlyMap<ThreadId, RootId>
  /**
   * Each forked thread's fork, a branch's or a copy's: where its
   * column ends before its first send, and what its fork row names after it.
   */
  readonly forkOf: ReadonlyMap<ThreadId, ThreadFork>
}

/** Every card's canvas, as the places and the threads' records say. */
export function indexCanvases(
  cards: readonly CardRecord[],
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
): CanvasIndex {
  const cardsOn = new Map<CanvasId, CardOnCanvas[]>()
  for (const c of cards.filter(onCanvas)) {
    const list = cardsOn.get(c.place.canvas) ?? []
    list.push(c)
    cardsOn.set(c.place.canvas, list)
  }
  const canvasOfCard = new Map<CardId, CanvasId>()
  const canvasOfThread = new Map<ThreadId, CanvasId>()
  const threadsOf = new Map<CanvasId, readonly ThreadId[]>()
  const rootsOf = new Map<CanvasId, readonly RootId[]>()
  const canvasesOfRoot = new Map<RootId, CanvasId[]>()
  for (const canvas of [...cardsOn.keys()].sort()) {
    const here = cardsOn.get(canvas) ?? []
    here.sort(byRank)
    for (const c of here) canvasOfCard.set(c.id, canvas)
    const ids = here.flatMap(c => (isThreadId(c.id) ? [c.id] : []))
    threadsOf.set(canvas, ids)
    const roots: RootId[] = []
    for (const thread of ids) {
      canvasOfThread.set(thread, canvas)
      const root = threads.get(thread)?.root
      if (root !== undefined && !roots.includes(root)) roots.push(root)
    }
    rootsOf.set(canvas, roots)
    for (const root of roots)
      canvasesOfRoot.set(root, [...(canvasesOfRoot.get(root) ?? []), canvas])
  }
  // A trashed card is in the canvas its `left` is in, and on no canvas.
  for (const c of cards) {
    if (c.place.kind !== "trash" || c.place.left.kind !== "canvas") continue
    canvasOfCard.set(c.id, c.place.left.canvas)
    if (isThreadId(c.id)) canvasOfThread.set(c.id, c.place.left.canvas)
  }
  // An image is in its media column's canvas, in the trash too.
  for (const c of cards) {
    const at = c.place.kind === "trash" ? c.place.left : c.place
    if (at.kind !== "image") continue
    const canvas = canvasOfCard.get(at.column)
    if (canvas !== undefined) canvasOfCard.set(c.id, canvas)
  }
  const rootOfThread = new Map(
    [...threads].map(([thread, r]) => [thread, r.root] as const),
  )
  const forkOf = new Map(
    [...threads].flatMap(([thread, r]) =>
      r.origin.kind === "fork" ? [[thread, r.origin] as const] : [],
    ),
  )
  return {
    cardsOn,
    canvasOfCard,
    canvasOfThread,
    threadsOf,
    rootsOf,
    canvasesOfRoot,
    rootOfThread,
    forkOf,
  }
}

/**
 * The root a place is in: a place at a thread, its thread's
 * (`rootOfThread`). Undefined for any other, or a thread with no record.
 */
export const rootOfPlace = (
  place: CardPlace | PlaceKey,
  rootOfThread: ReadonlyMap<ThreadId, RootId>,
): RootId | undefined => {
  const thread = threadOfPlace(place)
  return thread === null ? undefined : rootOfThread.get(thread)
}

/** No canvases: before the places arrive. */
export const NO_CANVAS_INDEX: CanvasIndex = indexCanvases([], new Map())

/**
 * The canvas a place is in: its surface's owner's (`surfaceOwner`). A canvas's own;
 * a column's, an image's or a thread's canvas; none for an inventory, or the board
 * (a canvas's card is in no canvas: the board is the team's). A trashed card's
 * is the place it left's; a trash key names none, since the host fills in
 * where a discard leaves.
 */
export function canvasOfPlace(
  canvases: CanvasIndex,
  place: CardPlace | PlaceKey,
): CanvasId | null {
  if (place.kind === "trash")
    return "left" in place ? canvasOfPlace(canvases, place.left) : null
  return canvasOfOwner(canvases, surfaceOwner(place))
}

/** The canvas a surface's owner is in: a canvas itself, a column's, an image's or a thread's. */
function canvasOfOwner(
  canvases: CanvasIndex,
  owner: SurfaceOwner,
): CanvasId | null {
  switch (owner.kind) {
    case "canvas":
      return owner.canvas
    case "note-column":
    case "media":
      return canvases.canvasOfCard.get(owner.column) ?? null
    case "image":
      return canvases.canvasOfCard.get(owner.image) ?? null
    case "thread":
      return canvases.canvasOfThread.get(owner.thread) ?? null
    case "person":
    case "team":
      return null
  }
}

/**
 * The canvas a move sends a card to: its place's (`canvasOfPlace`); a thread's
 * nearest notes, its thread's; a spot on a canvas, its canvas's.
 */
export function canvasOfTarget(
  canvases: CanvasIndex,
  to: CardPlace | MoveTarget,
): CanvasId | null {
  switch (to.kind) {
    case "notes":
      return to.near === "thread"
        ? (canvases.canvasOfThread.get(to.thread) ?? null)
        : to.canvas
    case "canvas-at":
    case "new-canvas":
      return to.canvas
    // An image's spot is in its column's canvas.
    case "image-at":
      return canvases.canvasOfCard.get(to.column) ?? null
    // A restore's canvas is its card's, read from where the card is.
    case "back":
      return null
    default:
      return canvasOfPlace(canvases, to)
  }
}

/**
 * Whether card `id` is on its canvas now: not in an inventory, and
 * not trashed, though the index still names a trashed card's canvas.
 */
export const isOnCanvas = (canvases: CanvasIndex, id: CardId): boolean => {
  const canvas = canvases.canvasOfCard.get(id)
  return (
    canvas !== undefined &&
    (canvases.cardsOn.get(canvas) ?? []).some(c => c.id === id)
  )
}

/** The canvas a card is in now: its place's (`canvasOfPlace`); null for none. */
export const canvasOfCard = (
  canvases: CanvasIndex,
  cards: readonly CardRecord[],
  id: CardId,
): CanvasId | null => {
  const now = cards.find(c => c.id === id)
  return now === undefined ? null : canvasOfPlace(canvases, now.place)
}

/** One canvas's cards, in order. */
export const cardsOnCanvas = (
  cards: readonly CardRecord[],
  canvas: CanvasId,
): readonly CardOnCanvas[] =>
  cards
    .filter(onCanvas)
    .filter(c => c.place.canvas === canvas)
    .sort(byRank)

/**
 * Where `card` lands on a canvas: just after a drop's `after`,
 * at the end when that card is no longer there or for a canvas's key alone,
 * with the cards given new ranks to make room, written first.
 */
export function rankOnCanvas(
  cards: readonly CardRecord[],
  card: CardId,
  to: CanvasKey | CanvasTarget,
): { readonly to: RankedCanvas; readonly first: readonly PlaceStep[] } {
  const here = cardsOnCanvas(cards, to.canvas).filter(c => c.id !== card)
  const ranked =
    to.kind === "canvas-at"
      ? rankOfDrop(here, to.after)
      : rankAfter(here, here.length - 1)
  return {
    to: { kind: "canvas", canvas: to.canvas, order: ranked.order },
    first: ranked.respaced.map(
      (record): PlaceStep => ({ kind: "write", record }),
    ),
  }
}

/**
 * Where a thread's card lands as the thread opens: on `canvas`'s
 * canvas just after the thread it forks from (`branchAfter`), else at the
 * canvas's end; where it was dropped on a canvas (`rankOnCanvas`); or in an
 * inventory.
 */
export type ThreadPlacement =
  | {
      readonly kind: "after"
      readonly canvas: CanvasId
      /** The thread it forks from; null for a root's first thread. */
      readonly parent: ThreadId | null
    }
  | { readonly kind: "spot"; readonly to: CanvasKey | CanvasTarget }
  | { readonly kind: "inventory"; readonly holder: WriterId }

/** The canvas a thread opens in, when the session does not hold it yet: a new canvas's. */
export interface CanvasOpening {
  /** The workflow state it lands in; null for the first open one. */
  readonly state: WorkflowStateId | null
  /** The board's states; null before the host wrote them, when no canvas opens. */
  readonly workflow: Workflow | null
}

/** What a thread's opening writes, or why its card's make was refused. */
export type ThreadOpen =
  | {
      readonly kind: "open"
      readonly records: readonly ValueWrite<"session">[]
      /**
       * The cards re-ranked to make room, then its card; for a canvas the
       * session lacks, the canvas's card first, at the end of its state on
       * the board (`boardEnd`).
       */
      readonly steps: readonly PlaceStep[]
    }
  | Extract<MakeStep, { kind: "refused" }>

/**
 * A thread opened: the one way a thread begins, before its first
 * entry, as its column opens, a copy is made or a card is spun into it. Its
 * record says how it began (`origin`); its card is made by `by`
 * (`makeCard`, `planMake`) where `placement` says; and a canvas the session
 * does not hold (`opens`) is made with it, its card by the host on `by`'s
 * behalf, `by` its owner: refused `no-place` before the board has states.
 * Its first send writes only its entry.
 */
export function planThreadOpen(input: {
  readonly thread: ThreadId
  readonly origin: ThreadOrigin
  readonly root: RootId
  readonly by: WriterId
  readonly now: number
  readonly placement: ThreadPlacement
  readonly opens: CanvasOpening | null
  readonly cards: readonly CardRecord[]
}): ThreadOpen {
  const { thread, by, now, placement, cards } = input
  const ranked = ((): {
    readonly to: PlaceOf<"thread">
    readonly first: readonly PlaceStep[]
  } => {
    switch (placement.kind) {
      case "inventory":
        return { to: placement, first: [] }
      case "spot": {
        const { to, first } = rankOnCanvas(cards, thread, placement.to)
        return { to: { ...to, width: 1 }, first }
      }
      case "after": {
        const here = cardsOnCanvas(cards, placement.canvas)
        const { order, respaced } = rankAfter(
          here,
          branchAfter(here, placement.parent),
        )
        return {
          to: { kind: "canvas", canvas: placement.canvas, order, width: 1 },
          first: respaced.map(
            (record): PlaceStep => ({ kind: "write", record }),
          ),
        }
      }
    }
  })()
  const made = planMake(
    cards,
    makeCard("thread", thread, ranked.to, NO_CONTENT, by),
    by,
  )
  if (made.kind === "refused") return made
  const records: ValueWrite<"session">[] = [
    setRecord(THREAD, {
      thread,
      root: input.root,
      by,
      createdAt: now,
      origin: input.origin,
    }),
  ]
  const canvas = ranked.to.kind === "canvas" ? ranked.to.canvas : null
  if (input.opens === null || canvas === null)
    return { kind: "open", records, steps: [...ranked.first, made] }
  const opened = planCanvasOpening(canvas, by, input.opens, cards)
  if (opened.kind === "refused") return opened
  return { kind: "open", records, steps: [opened, ...ranked.first, made] }
}

/**
 * A canvas made for `by`, its owner: its card by the host at the end of its
 * state on the board (`boardEnd`), the one way a canvas is made, as a thread
 * opens in it or a card is dropped between canvases in the sidebar. Refused
 * `no-place` before the board has states, `exists` for an id in use.
 */
export function planCanvasOpening(
  canvas: CanvasId,
  by: WriterId,
  opens: CanvasOpening,
  cards: readonly CardRecord[],
): MakeStep {
  const { workflow, state } = opens
  if (workflow === null) return { kind: "refused", code: "no-place", now: null }
  return planMake(
    cards,
    makeCard(
      "canvas",
      canvas,
      boardEnd(workflow, cards, state),
      NO_CONTENT,
      by,
    ),
    "host",
  )
}

/** Where a thread not yet started begins: its root, and its fork, or null for a new root's first. */
export interface ThreadOpening {
  readonly root: RootId
  readonly fork: EntryId | null
  /** What its composer starts with for this reader: a proposal's brief (`proposalDraft`). */
  readonly draft?: string
}

/**
 * Each thread opened and not yet started: no entry of it in
 * `index`, and either its fork in `index` (a branch's or a copy's, its root
 * held here), or its root one the directory does not name yet (`started`:
 * a new canvas's, whose root gets its document with its first entry). A
 * thread whose root this tab does not hold is in neither.
 */
export function unstartedThreads(
  threads: ReadonlyMap<ThreadId, ThreadRecord>,
  index: TreeIndex,
  started: ReadonlySet<RootId>,
  me: WriterId,
): ReadonlyMap<ThreadId, ThreadOpening> {
  const out = new Map<ThreadId, ThreadOpening>()
  for (const [thread, r] of threads) {
    if (index.firstOf.has(thread)) continue
    const fork = forkEntry(r.origin)
    if (
      fork === null ? !started.has(r.root) : index.entries[fork] !== undefined
    ) {
      const draft = proposalDraft({ record: r, index, me })
      out.set(
        thread,
        draft === undefined
          ? { root: r.root, fork }
          : { root: r.root, fork, draft },
      )
    }
  }
  return out
}

/**
 * What an opened branch's composer starts with for `me`: its row's brief,
 * asked of the agent. Only for the one who opened it, and only before its
 * first send; never stored, so it reads the same on each of their devices.
 */
export function proposalDraft(input: {
  readonly record: ThreadRecord
  readonly index: TreeIndex
  readonly me: WriterId
}): string | undefined {
  const { record, index } = input
  const { origin } = record
  if (origin.kind !== "fork" || origin.how !== "branch") return undefined
  if (origin.proposal === undefined || record.by !== input.me) return undefined
  if (index.firstOf.has(record.thread)) return undefined
  const proposal = index.entries[origin.proposal.entry]?.message?.proposal
  const brief = proposal?.branches[origin.proposal.row]?.brief
  return brief === undefined ? undefined : agentAsk(brief)
}

/**
 * Whether a thread card at `place` is live: in an inventory, or on a
 * canvas outside `archived`. A trashed card is asked of the place it left,
 * so a restore, or a link to it, still reaches its thread until the sweep
 * deletes it. The host's late writes take this as their gate (`lateAway`,
 * `reach.ts`).
 */
export function isLivePlace(
  place: CardPlace,
  archived: { readonly has: (canvas: CanvasId) => boolean },
): boolean {
  const left = livePlace(place)
  return (
    left.kind === "inventory" ||
    (left.kind === "canvas" && !archived.has(left.canvas))
  )
}
