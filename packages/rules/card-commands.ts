// card-commands — a card command planned whole, from facts its shell gathers
// once: the records written before its one change, the change's steps, the
// lanes it drains, the sender's history of moves it is a step of, and the
// records written after it. The shell reads, loads that history's stack, and
// carries the plan out; it decides nothing.

import {
  type BlobRef,
  type CanvasId,
  type EntryId,
  historyScope,
  type ImageRef,
  type LaneRecord,
  type MoveHistoryScope,
  PERSON_HISTORY,
  type RootId,
  type Sha256,
  type ThreadId,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import {
  type BranchedFact,
  type BranchOut,
  type CardCommand,
  type CardId,
  type CardRecord,
  cardMove,
  type Intent,
  isTextCardId,
  MAX_TITLE,
  type Mention,
  type Move,
  type MoveDirection,
  messageWriter,
  parseTitle,
  type QueueHoldChange,
  type QueueMove,
  type Send,
  type SentCard,
  type TextCardId,
  type ThreadRecord,
  TRASH_PLACE,
  type TreeIndex,
  threadOfSend,
} from "@pinetrie/threads"
import type { BoardMove, Workflow } from "./board.ts"
import {
  type CanvasIndex,
  canvasOfPlace,
  canvasOfTarget,
} from "./canvas-index.ts"
import type { CardHistoryRecord } from "./card-history.ts"
import { CARD_TITLE } from "./card-title.ts"
import { type MintContainer, mintWith } from "./containers.ts"
import { type CopyPlan, type CopyThread, planCopy } from "./copy.ts"
import {
  planReorder,
  planSetCommand,
  planTick,
  planWidth,
  type ReorderStep,
} from "./in-place.ts"
import {
  cardsOfParts,
  crossesArchive,
  movesHistory,
  type UndoResult,
  undoAnswer,
} from "./move-history.ts"
import {
  lanesToDrain,
  type MovesStep,
  planMoveCommand,
  planMoveRequest,
  planMoveTargets,
  planPaste,
  prefixedSteps,
} from "./moves.ts"
import {
  type GatheredStart,
  type OpenPlan,
  type OpenThread,
  planOpenThread,
} from "./open.ts"
import { afterSteps, type MoveStep, type PlaceStep } from "./place-steps.ts"
import { type BranchOutRefusal, planBranchOut } from "./proposal.ts"
import {
  type NewImage,
  planPutImages,
  planVersion,
  type VersionBlobs,
} from "./put-images.ts"
import { planQueueCard, type QueueHold } from "./queue-hold.ts"
import { setRecord, unwritten } from "./records.ts"
import { emptiedCanvases, planCanvasesTrashed } from "./root.ts"
import {
  type LiftPlan,
  planLiftRoot,
  planSpinOff,
  type SpinOff,
} from "./spin-off.ts"

declare const plannedBrand: unique symbol
/**
 * A list a card plan writes: only this module stamps one, so the shell can
 * neither build a plan's steps or records nor edit them. A new list (a
 * spread, a `map`) is unbranded.
 */
type Planned<T> = readonly T[] & { readonly [plannedBrand]: true }

const planned = <T>(list: readonly T[]): Planned<T> => list as Planned<T>

const NONE: Planned<never> = planned([])

/** A refused move or reorder: the code, and the card as it is now (null when gone). */
export type CardRefusal = Extract<MoveStep | ReorderStep, { kind: "refused" }>

/** A card command's one change, and what it writes around it. */
interface CardSteps {
  readonly kind: "steps"
  /** Records written before the change, so a reader that finds a card finds its thread's root. */
  readonly before: Planned<ValueWrite<"session">>
  readonly steps: Planned<PlaceStep>
  /** The lanes the change leaves to drain, those not running. */
  readonly drain: readonly ThreadId[]
  /** The sender's history of moves the change is one step of; null for none. */
  readonly history: MoveHistoryScope | null
  /** Records written once the change has landed. */
  readonly after: Planned<ValueWrite<"session">>
  /** Whether the change records threads, so the shell names them after it. */
  readonly names: boolean
}

/**
 * A card command planned: its change and what it writes around it, a move
 * refused with where the card is now, nothing to write, or refused for a
 * reason (`W`) the shell words.
 */
export type CardPlan<W = never> =
  | CardSteps
  | CardRefusal
  | { readonly kind: "nothing" }
  | { readonly kind: "declined"; readonly why: W }

/** What every card command reads of the places, gathered once per command. */
export interface CardFacts {
  readonly cards: readonly CardRecord[]
  readonly canvases: CanvasIndex
  readonly sender: WriterId
  readonly now: number
  /** The lanes running as the facts were read. */
  readonly running: ReadonlySet<ThreadId>
  /** Mints the id of a column a command makes for a card. */
  readonly newContainer: MintContainer
}

/** A blob as the store holds it: its reference and its fitted copy, if any. */
export interface StoredBlob {
  readonly ref: BlobRef | undefined
  readonly fitted: ImageRef | undefined
}

/** Why a blob makes no image: the store holds none, or holds text or an opaque file. */
export type ImageRefusal =
  | { readonly kind: "missing"; readonly sha256: Sha256 }
  | { readonly kind: "not-an-image" }

const isRunning =
  (facts: Pick<CardFacts, "running">) =>
  (lane: ThreadId): boolean =>
    facts.running.has(lane)

/** The history of a command on `canvas`: none on no canvas, never your history outside any. */
const canvasHistory = (
  canvas: CanvasId | null | undefined,
): MoveHistoryScope | null =>
  canvas === null || canvas === undefined ? null : historyScope(canvas)

const carried = (
  step: MovesStep | MoveStep | ReorderStep,
  history: MoveHistoryScope | null,
  around: {
    readonly drain?: readonly ThreadId[]
    readonly before?: readonly ValueWrite<"session">[]
    readonly after?: readonly ValueWrite<"session">[]
    readonly names?: boolean
  } = {},
): CardSteps | CardRefusal =>
  step.kind === "refused"
    ? step
    : {
        kind: "steps",
        before: planned(around.before ?? []),
        steps: planned(step.kind === "steps" ? step.steps : [step]),
        drain: around.drain ?? [],
        history,
        after: planned(around.after ?? []),
        names: around.names ?? false,
      }

/**
 * Handoffs, whole or refused (`planMoveRequest`). A new canvas closed before
 * its first send leaves its canvas empty: its card goes to the trash in the
 * same step, and the step enters its closer's history outside any canvas,
 * since the canvas leaves their view. Otherwise the history `movesHistory`
 * names.
 */
export function planCardMove(
  facts: CardFacts & {
    readonly moves: readonly Move[]
    /** The canvas the sender is on, for a card that leaves no canvas. */
    readonly here: CanvasId | null
    readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
    /** Every root the directory names: a thread whose root it lacks is unsent. */
    readonly started: ReadonlySet<RootId>
    readonly workflow: Workflow | null
    readonly entryThreads: ReadonlyMap<EntryId, ThreadId>
  },
): CardPlan {
  const { cards, moves, sender } = facts
  const request = planMoveRequest(
    cards,
    moves,
    sender,
    isRunning(facts),
    facts.newContainer,
    facts.entryThreads,
    facts.workflow,
  )
  if (request.step.kind === "refused") return request.step
  const emptied = emptiedCanvases({
    before: cards,
    after: afterSteps(cards, request.step.steps),
    threads: facts.threads,
    started: facts.started,
  })
  if (emptied.length === 0)
    return carried(
      request.step,
      movesHistory(
        moves,
        cards,
        { canvases: facts.canvases, here: facts.here },
        "move",
      ),
      { drain: request.drain },
    )
  return carried(
    {
      kind: "steps",
      steps: [
        ...request.step.steps,
        ...planCanvasesTrashed(cards, emptied, sender),
      ],
    },
    PERSON_HISTORY,
    { drain: request.drain },
  )
}

/**
 * A paste (`planPaste`), its target resolved first as any move's
 * (`planMoveTargets`); with the card it replaces, that card's trash is the
 * step's first move, so it names the history. A card left queued on an idle
 * thread is drained.
 */
export function planCardPaste(
  facts: CardFacts & {
    readonly pasted: Extract<Intent, { kind: "paste" }>
    readonly entryThreads: ReadonlyMap<EntryId, ThreadId>
  },
): CardPlan {
  const { cards, pasted, sender } = facts
  const main: Move = {
    card: pasted.paste.card,
    from: pasted.paste.kind === "uncut" ? TRASH_PLACE : null,
    to: pasted.to,
  }
  const moves: readonly Move[] = [
    ...(pasted.replacing === null
      ? []
      : [{ ...pasted.replacing, to: TRASH_PLACE }]),
    main,
  ]
  const history = movesHistory(
    moves,
    cards,
    { canvases: facts.canvases, here: pasted.here },
    "paste",
  )
  const resolved = planMoveTargets({
    cards,
    moves: [main],
    sender,
    newContainer: facts.newContainer,
    entryThreads: facts.entryThreads,
  })
  if (resolved.kind === "refused") return resolved
  const [move] = resolved.moves
  if (move === undefined) return { kind: "nothing" }
  const step = prefixedSteps(
    resolved.first,
    planPaste(resolved.cards, pasted.paste, move, pasted.replacing, sender),
  )
  if (step.kind === "refused") return step
  return carried(step, history, {
    drain: lanesToDrain(cards, step.steps, isRunning(facts)),
  })
}

/** A version's blobs: the fitted copy drawn and the original kept; or why there are none. */
function versionBlobs(
  sha256: Sha256,
  stored: StoredBlob | undefined,
): { readonly blobs: VersionBlobs } | { readonly why: ImageRefusal } {
  const ref = stored?.ref
  if (ref === undefined) return { why: { kind: "missing", sha256 } }
  if (ref.width === null) return { why: { kind: "not-an-image" } }
  return { blobs: { ...(stored?.fitted ?? ref), original: sha256 } }
}

/**
 * New images in a media column (`planPutImages`), as one step of the
 * sender's history in the canvas they land in, each titled by its file's
 * name once the images have landed. Refused for a blob the store does not
 * hold, or one it sorted as text or opaque.
 */
export function planImagesPut(
  facts: CardFacts & {
    readonly put: Extract<Intent, { kind: "put-images" }>
    /** Each image's blob, by its original's hash. */
    readonly blobs: ReadonlyMap<Sha256, StoredBlob>
  },
): CardPlan<ImageRefusal> {
  const { put, sender, now } = facts
  const images: NewImage[] = []
  for (const image of put.images) {
    const version = versionBlobs(image.sha256, facts.blobs.get(image.sha256))
    if ("why" in version) return { kind: "declined", why: version.why }
    images.push({ card: image.card, image: version.blobs })
  }
  const step = planPutImages({
    cards: facts.cards,
    images,
    to: put.to,
    sender,
    now,
    newContainer: mintWith(facts.newContainer, put.made),
  })
  const titles = put.images.flatMap(i => {
    const title = parseTitle(i.name.slice(0, MAX_TITLE))
    return title.kind === "set"
      ? [
          setRecord(CARD_TITLE, {
            card: i.card,
            title: title.title,
            by: sender,
            at: now,
          }),
        ]
      : []
  })
  const canvas = canvasOfTarget(facts.canvases, put.to)
  return carried(step, canvasHistory(canvas), { after: titles })
}

/** A new version of an image (`planVersion`), in its canvas's history. */
export function planImageVersion(
  facts: CardFacts & {
    readonly change: Extract<Intent, { kind: "version" }>
    readonly blob: StoredBlob | undefined
  },
): CardPlan<ImageRefusal> {
  const { change } = facts
  const version = versionBlobs(change.sha256, facts.blob)
  if ("why" in version) return { kind: "declined", why: version.why }
  const canvas = facts.canvases.canvasOfCard.get(change.image)
  return carried(
    planVersion({
      cards: facts.cards,
      image: change.image,
      version: version.blobs,
      sender: facts.sender,
      now: facts.now,
    }),
    canvasHistory(canvas),
  )
}

/**
 * A queued or pinned card moved among its neighbours (`planReorder`), in its
 * canvas's history. It changes no lane's turn, so it drains nothing.
 */
export function planCardReorder(
  facts: CardFacts & {
    readonly reorder: Extract<Intent, { kind: "reorder" }>["reorder"]
  },
): CardPlan {
  const step = planReorder(facts.cards, facts.reorder)
  const canvas = canvasOfPlace(facts.canvases, facts.reorder.at)
  return carried(step, canvasHistory(canvas))
}

/**
 * A change to a card in place on `canvas` (a width, a tick), in its canvas's
 * history as a reorder is; null, a state it has already, writes nothing.
 */
const onCanvasStep = (step: MoveStep | null, canvas: CanvasId): CardPlan =>
  step === null ? { kind: "nothing" } : carried(step, canvasHistory(canvas))

/** A card drawn one column wide or two (`planWidth`, `onCanvasStep`). */
export const planCardWidth = (
  facts: CardFacts & {
    readonly change: Extract<Intent, { kind: "card-width" }>
  },
): CardPlan =>
  onCanvasStep(planWidth(facts.cards, facts.change), facts.change.at.canvas)

/** A column's box ticked or cleared (`planTick`, `onCanvasStep`). */
export const planCardTick = (
  facts: CardFacts & {
    readonly change: Extract<Intent, { kind: "card-tick" }>
  },
): CardPlan =>
  onCanvasStep(planTick(facts.cards, facts.change), facts.change.at.canvas)

/** A card's command set or cleared (`planSetCommand`), in no history. */
export function planCardCommandSet(
  facts: CardFacts & {
    readonly card: CardId
    readonly command: CardCommand | null
  },
): CardPlan {
  return carried(planSetCommand(facts.cards, facts.card, facts.command), null)
}

/**
 * A card queued with its queue's hold changed (`planQueueCard`): the hold
 * written first, so the drain the move asks for finds it as planned. The
 * move is a step of the sender's history as a move is; the hold is not, so
 * an undo puts the card back and leaves the queue held or released.
 */
export function planCardQueue(
  facts: CardFacts & {
    readonly move: QueueMove
    readonly hold: QueueHoldChange
    readonly command: CardCommand | null
    readonly holds: ReadonlyMap<ThreadId, QueueHold>
  },
): CardPlan {
  const plan = planQueueCard({
    cards: facts.cards,
    holds: facts.holds,
    move: facts.move,
    hold: facts.hold,
    command: facts.command,
    by: facts.sender,
    now: facts.now,
    running: isRunning(facts),
  })
  // A queueing trashes nothing: its history is the queue's canvas.
  const history = movesHistory(
    [facts.move],
    facts.cards,
    { canvases: facts.canvases, here: null },
    "move",
  )
  return carried(plan.step, history, { drain: plan.drain, before: plan.holds })
}

/**
 * A chat from a card that found its lane busy, queued behind the others in
 * the same step. Nothing when it cannot be: the send names no lane of a
 * thread, the card is no text card, or the move is refused. In no history.
 */
export function planBusyQueue(
  facts: CardFacts & {
    readonly index: TreeIndex
    readonly lanes: Parameters<typeof threadOfSend>[1]
    readonly outgoing: Send & { readonly card: SentCard }
  },
): CardPlan {
  const { outgoing, cards } = facts
  const thread = threadOfSend(facts.index, facts.lanes, {
    at: outgoing.at,
    me: facts.sender,
  })
  const now = cards.find(c => c.id === outgoing.card.id)
  if (
    thread.kind !== "thread" ||
    thread.lane.kind !== "lane" ||
    now?.kind !== "text"
  )
    return { kind: "nothing" }
  const { step, drain } = planMoveCommand(
    cards,
    [
      cardMove(now, {
        kind: "queued",
        thread: thread.lane.name,
        seen: outgoing.card.seen,
      }),
    ],
    facts.sender,
    isRunning(facts),
  )
  return step.kind === "steps"
    ? carried(step, null, { drain })
    : { kind: "nothing" }
}

/**
 * A sent card spent: its record removed, in no history; one the places no
 * longer hold writes nothing, and its text is destroyed apart, since a text
 * may outlive its record.
 */
export function planCardSpend(
  facts: CardFacts & { readonly card: TextCardId },
): { readonly plan: CardSteps; readonly destroyText: boolean } {
  const held = facts.cards.some(c => c.id === facts.card)
  return {
    plan: {
      kind: "steps",
      before: NONE,
      steps: planned(held ? [{ kind: "remove", id: facts.card }] : []),
      drain: [],
      history: null,
      after: NONE,
      names: false,
    },
    destroyText: !held,
  }
}

/**
 * A canvas's card moved on the board (`planBoardMove`'s steps): between
 * states, one step of its sender's history outside any canvas; within one, a
 * reorder, in none.
 */
export function planCanvasPlacement(
  move: Extract<BoardMove, { kind: "move" | "reorder" }>,
): CardPlan {
  return carried(
    { kind: "steps", steps: move.steps },
    move.kind === "move" ? PERSON_HISTORY : null,
  )
}

/**
 * A thread opened as its column opens (`planOpenThread`): its records first,
 * then its card on its canvas, then its name. In no history.
 */
export function planThreadOpening(
  facts: CardFacts & {
    readonly open: OpenThread
    readonly start: GatheredStart
    readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
    readonly roots: ReadonlySet<RootId>
    /** Every canvas the session holds. */
    readonly held: ReadonlySet<CanvasId>
    readonly workflow: Workflow | null
  },
): CardPlan<Extract<OpenPlan, { kind: "refused" }>["why"]> {
  const plan = planOpenThread({
    open: facts.open,
    start: facts.start,
    sender: facts.sender,
    cards: facts.cards,
    threads: facts.threads,
    roots: facts.roots,
    canvases: facts.held,
    workflow: facts.workflow,
    now: facts.now,
  })
  if (plan.kind === "refused") return { kind: "declined", why: plan.why }
  return carried({ kind: "steps", steps: plan.steps }, null, {
    before: plan.records,
    names: true,
  })
}

/**
 * A press on an agent's proposal (`planBranchOut`): every branch opened in
 * one change, its records first and its names after; for Start, each
 * branch's message, sent once they are open; then the press's fact.
 */
export function planProposalPress(
  facts: CardFacts & {
    readonly press: BranchOut
    readonly index: TreeIndex
    readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
    /** Every canvas the session holds. */
    readonly held: ReadonlySet<CanvasId>
  },
):
  | { readonly kind: "declined"; readonly why: BranchOutRefusal }
  | {
      readonly kind: "press"
      readonly opening: CardSteps
      readonly sends: readonly Send[]
      readonly fact: BranchedFact
    } {
  const plan = planBranchOut({
    press: facts.press,
    index: facts.index,
    running: isRunning(facts),
    sender: facts.sender,
    cards: facts.cards,
    threads: facts.threads,
    canvasOfThread: facts.canvases.canvasOfThread,
    canvases: facts.held,
    now: facts.now,
  })
  if ("kind" in plan) return { kind: "declined", why: plan.why }
  return {
    kind: "press",
    opening: {
      kind: "steps",
      before: planned(plan.opening.records),
      steps: planned(plan.opening.steps),
      drain: [],
      history: null,
      after: NONE,
      names: true,
    },
    sends: plan.how === "start" ? plan.sends : [],
    fact: plan.fact,
  }
}

/**
 * A thread copied (`planCopy`): its record first, then its card and the
 * canvas re-ranked for it, then its name; one step of the copier's history
 * where it lands, as a paste is. Refused `unknown` when the source's root
 * holds no tree.
 */
export function planThreadCopy(
  facts: CardFacts & {
    readonly copy: CopyThread
    readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
    /** The source's root's tree; null when it has none. */
    readonly index: TreeIndex | null
  },
): CardPlan<Extract<CopyPlan, { kind: "refused" }>["why"]> {
  if (facts.index === null) return { kind: "declined", why: "unknown" }
  const plan = planCopy({
    copy: facts.copy,
    sender: facts.sender,
    cards: facts.cards,
    threads: facts.threads,
    index: facts.index,
    now: facts.now,
  })
  if (plan.kind === "refused") return { kind: "declined", why: plan.why }
  const history = movesHistory(
    [facts.copy.move],
    facts.cards,
    { canvases: facts.canvases, here: null },
    "paste",
  )
  return carried({ kind: "steps", steps: plan.steps }, history, {
    before: plan.records,
    names: true,
  })
}

/** A spin-off planned whole: its thread's records, first message and change, or why not. */
type CardSpinOff =
  | {
      readonly kind: "spin"
      /** The card the thread starts from: a text card. */
      readonly card: TextCardId
      readonly root: RootId
      readonly thread: ThreadId
      /** The thread's record and its canvas's, written before its first message. */
      readonly records: Planned<ValueWrite<"session">>
      /** Those records deleted again, for a send that took nothing. */
      readonly unwrite: Planned<ValueWrite<"session">>
      readonly text: string
      readonly mentions: readonly Mention[]
      /** Its card on its canvas, outside any history. */
      readonly opening: Planned<PlaceStep>
      /** The card's move to the trash, in `history`. */
      readonly move: Planned<PlaceStep>
      readonly history: MoveHistoryScope | null
    }
  | CardRefusal
  | { readonly kind: "declined"; readonly why: "blank" | "root-in-use" }

/**
 * A text card made a thread (`planSpinOff`). Its records are written, its
 * first message sent, and only then its change: a send that took nothing
 * deletes the records again, so the shell carries it in phases. The card's
 * move is one step of the sender's history as a move is.
 */
export function planCardSpinOff(
  facts: CardFacts & {
    readonly request: SpinOff
    /** The card's text, as the host holds it. */
    readonly text: string
    readonly roots: ReadonlySet<RootId>
    readonly threads: ReadonlySet<ThreadId>
    readonly workflow: Workflow | null
  },
): CardSpinOff {
  const { request, cards } = facts
  const unmoved = (code: CardRefusal["code"]): CardRefusal => ({
    kind: "refused",
    code,
    now: cards.find(c => c.id === request.move.card) ?? null,
  })
  const card = request.move.card
  if (!isTextCardId(card)) return unmoved("no-place")
  const plan = planSpinOff({
    cards,
    request,
    sender: facts.sender,
    canvases: facts.canvases,
    text: facts.text,
    roots: facts.roots,
    threads: facts.threads,
    opens: { state: request.state, workflow: facts.workflow },
    now: facts.now,
  })
  switch (plan.kind) {
    case "refused":
      return unmoved(plan.code)
    case "blank":
    case "root-in-use":
      return { kind: "declined", why: plan.kind }
  }
  return {
    kind: "spin",
    card,
    root: plan.root,
    thread: plan.thread,
    records: planned(plan.open.records),
    unwrite: planned(plan.open.records.map(unwritten)),
    text: plan.text,
    mentions: plan.mentions,
    opening: planned(plan.open.steps),
    move: planned([plan.step]),
    history: movesHistory(
      [request.move],
      cards,
      { canvases: facts.canvases, here: request.here },
      "move",
    ),
  }
}

/** The threads an undo would lift, and what deciding it needs read of them. */
interface UndoReach {
  readonly kind: "reach"
  readonly direction: MoveDirection
  /** The cards the step moves, read from its parts before it is tried. */
  readonly cards: readonly CardId[]
  /** Each thread spun from one of them, and whether the directory names its root. */
  readonly spun: readonly {
    readonly thread: ThreadId
    readonly root: RootId
    readonly known: boolean
  }[]
  readonly placesId: string
}

/**
 * What an undo or a redo of the sender's newest step would move, read from
 * its stack's top (`parts`, empty for none): refused `archived` when it
 * would move a canvas's card across the archive's edge; else, for an undo,
 * the threads spun from its cards, whose trees the shell reads for
 * `planUndo`.
 */
export function planUndoReach(facts: {
  readonly parts: Parameters<typeof cardsOfParts>[0]
  readonly placesId: string
  readonly direction: MoveDirection
  readonly cards: readonly CardRecord[]
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  readonly workflow: Workflow | null
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  readonly roots: ReadonlySet<RootId>
}): CardRefusal | UndoReach {
  const touched = cardsOfParts(facts.parts, facts.placesId)
  if (crossesArchive(touched, facts.histories, facts.workflow))
    return {
      kind: "refused",
      code: "archived",
      now: facts.cards.find(c => c.id === touched[0]) ?? null,
    }
  const spun =
    facts.direction === "undo"
      ? [...facts.threads].flatMap(([thread, { origin, root }]) =>
          origin.kind === "spun" && touched.includes(origin.card)
            ? [{ thread, root, known: facts.roots.has(root) }]
            : [],
        )
      : []
  return {
    kind: "reach",
    direction: facts.direction,
    cards: touched,
    spun,
    placesId: facts.placesId,
  }
}

declare const revertBrand: unique symbol
/**
 * An undo let through: the cards to revert and the threads to delete once
 * it is undone. Only `planUndo` makes one, so no answer is planned for a
 * revert no plan asked for.
 */
interface UndoRevert {
  readonly kind: "revert"
  readonly cards: readonly CardId[]
  readonly lift: Extract<LiftPlan, { kind: "lift" }>["delete"]
  readonly placesId: string
  readonly [revertBrand]: true
}

/** Who wrote each entry of a tree, oldest first; null where no person did. */
const writersOfTree = (index: TreeIndex): readonly (WriterId | null)[] =>
  Object.values(index.entries)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(e => messageWriter(e.message) ?? null)

/**
 * Whether an undo may go ahead (`planLiftRoot`): refused `replied`, naming
 * who wrote second, when a thread it would lift holds more than its first
 * message; else the revert, with the threads to delete once it is undone.
 * A redo lifts nothing.
 */
export function planUndo(facts: {
  readonly reach: UndoReach
  /** The tree of each known spun thread's root (`UndoReach.spun`). */
  readonly trees: ReadonlyMap<RootId, TreeIndex>
  readonly cards: readonly CardRecord[]
  readonly lanes: readonly LaneRecord[]
  readonly rootOfThread: ReadonlyMap<ThreadId, RootId>
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
}): { readonly kind: "replied"; readonly by: WriterId | null } | UndoRevert {
  const { reach } = facts
  const lift = planLiftRoot({
    lifting: reach.cards,
    spun: reach.spun.map(s => {
      const tree = s.known ? facts.trees.get(s.root) : undefined
      return { ...s, writers: tree === undefined ? [] : writersOfTree(tree) }
    }),
    cards: facts.cards,
    lanes: facts.lanes,
    rootOfThread: facts.rootOfThread,
    histories: facts.histories,
  })
  if (lift.kind === "replied") return lift
  return {
    kind: "revert",
    cards: reach.cards,
    lift: lift.delete,
    placesId: reach.placesId,
  } as UndoRevert
}

/**
 * An undo's answer (`undoAnswer`), from what Kyneta did to the revert
 * `planUndo` let through and the cards after it.
 */
export const planUndoAnswer = (
  revert: UndoRevert,
  result: UndoResult,
  cards: readonly CardRecord[],
): ReturnType<typeof undoAnswer> => undoAnswer(result, cards, revert.placesId)
