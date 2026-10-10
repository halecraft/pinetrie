// spin-off — a text card that becomes a thread (ADR-0111, ADR-0113): dropped
// on a workflow state, or in the sidebar, it starts a conversation root
// whose first message is its text, and the card goes to a hidden place,
// gone and spun into that root. The undo key lifts the root back into the
// card while the root holds that first message alone (S139). Pure.

import {
  type CardHistoryRecord,
  type CardId,
  type CardRecord,
  type LaneRecord,
  type Mention,
  type Move,
  type MoveRefusal,
  type PlaceKey,
  parseMentions,
  type RootId,
  type TaskId,
  type ThreadId,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import { type MoveStep, planMove } from "./moves.ts"
import { rootOfPlace, type TaskIndex } from "./task.ts"

/**
 * A spin-off as its sender asks it: the card's move to gone, spun into
 * `move.to`'s thread, and the workflow state the thread lands in (null for
 * the first open one).
 */
export interface SpinOff {
  readonly move: Move<Extract<PlaceKey, { readonly kind: "trash" }>>
  /** The new task the thread is put in (ADR-0116). */
  readonly task: TaskId
  readonly state: WorkflowStateId | null
  /** The task its sender will be on: the move's history from an inventory. */
  readonly here: TaskId | null
}

/** What a spin-off writes: the new root's first message, then the card's move. */
export interface SpinOffPlan {
  readonly kind: "spin"
  /** The new conversation root. */
  readonly root: RootId
  /** The thread its first message starts (ADR-0117). */
  readonly thread: ThreadId
  /** Its first message: the card's text, by the sender. */
  readonly text: string
  /** The people it names; never the agent: a conversation root has no lane. */
  readonly mentions: readonly Mention[]
  /** The card's move to gone, spun into `root`. */
  readonly step: Extract<MoveStep, { kind: "write" }>
}

export type SpinOffRefusal =
  | { readonly kind: "refused"; readonly code: MoveRefusal }
  /** A card with nothing in it starts no thread. */
  | { readonly kind: "blank" }
  /** The root id its tab minted is in use. */
  | { readonly kind: "root-in-use" }

/**
 * A spin-off, planned: refused when the move is not one to gone spun into
 * a root, when that root's id is in use, when the card holds no text, or
 * as `planMove` refuses the card's move (someone moved it first, it is not
 * yours). Otherwise the thread's first message, and the card's move.
 */
export function planSpinOff(input: {
  readonly cards: readonly CardRecord[]
  readonly request: SpinOff
  readonly sender: WriterId
  readonly tasks: TaskIndex
  /** The card's text, as the host holds it. */
  readonly text: string
  /** Every root the directory names. */
  readonly roots: ReadonlySet<RootId>
}): SpinOffPlan | SpinOffRefusal {
  const { move } = input.request
  const to = move.to
  if (to.kind !== "trash" || to.why.kind !== "spun" || move.from === null)
    return { kind: "refused", code: "moved" }
  const { into, thread } = to.why
  if (input.roots.has(into)) return { kind: "root-in-use" }
  const text = input.text.trim()
  if (text === "") return { kind: "blank" }
  const step = planMove(input.cards, move, input.sender, {
    tasks: input.tasks,
    here: input.request.here,
  })
  if (step.kind === "refused") return { kind: "refused", code: step.code }
  if (step.kind !== "write") return { kind: "refused", code: "moved" }
  return {
    kind: "spin",
    root: into,
    thread,
    text,
    mentions: parseMentions(text).filter(m => m.kind !== "agent"),
    step,
  }
}

/** What a lift needs to know of a thread a card was spun into. */
export interface SpunThread {
  readonly thread: RootId
  /** Whether the directory names it: a thread lifted already is not. */
  readonly known: boolean
  /** Who wrote each entry in its tree, oldest first; null for one no person wrote. */
  readonly writers: readonly (WriterId | null)[]
}

export type LiftPlan =
  /**
   * Undo, then delete these roots, each holding its first message alone,
   * with the thread a card was spun into there: read before the undo, which
   * moves the card back.
   */
  | {
      readonly kind: "lift"
      readonly delete: readonly {
        readonly root: RootId
        readonly thread: ThreadId
      }[]
    }
  /** Someone wrote in the thread, or the agent works there: no undo. */
  | { readonly kind: "replied"; readonly by: WriterId | null }

/**
 * Whether an undo that moves `lifting` (the cards the step names, S139) may
 * lift back the threads those spun off: each must hold its first message
 * alone, with no lane and no card in it but those the undo moves, and its
 * card must still be where the spin-off put it, alone on its task's canvas
 * with nothing pinned to the task (ADR-0124): an undo restores exactly what
 * was there, or does nothing. A thread the directory no longer names has
 * nothing to lift. Refused `replied`, naming who wrote second, when any
 * holds more. Pure.
 */
export function planLiftRoot(input: {
  readonly lifting: readonly CardId[]
  readonly cards: readonly CardRecord[]
  readonly threads: ReadonlyMap<RootId, SpunThread>
  readonly lanes: readonly LaneRecord[]
  /** Each recorded thread's root (`TaskIndex`): a card at a thread names no root. */
  readonly rootOfThread: ReadonlyMap<ThreadId, RootId>
  /** Each card's history: a thread's card that moved since it was made has more than one event. */
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
}): LiftPlan {
  const spun = input.cards.filter(
    c =>
      input.lifting.includes(c.id) &&
      c.place.kind === "trash" &&
      c.place.why.kind === "spun",
  )
  const deleting: { root: RootId; thread: ThreadId }[] = []
  for (const card of spun) {
    if (card.place.kind !== "trash" || card.place.why.kind !== "spun") continue
    const thread = input.threads.get(card.place.why.into)
    if (thread === undefined || !thread.known) continue
    const second = thread.writers[1]
    if (second !== undefined) return { kind: "replied", by: second }
    const others = input.cards.some(
      c =>
        !input.lifting.includes(c.id) &&
        rootOfPlace(c.place, input.rootOfThread) === thread.thread,
    )
    const lane = input.lanes.some(l => l.root === thread.thread)
    if (others || lane || !aloneInItsTask(input, card.place.why.thread))
      return { kind: "replied", by: null }
    deleting.push({ root: thread.thread, thread: card.place.why.thread })
  }
  return { kind: "lift", delete: deleting }
}

/**
 * Whether a spun thread's card is where the spin-off put it: on a task's
 * canvas, never moved since (its history holds its making alone), with no
 * other card on that canvas and none pinned to the task.
 */
function aloneInItsTask(
  input: Pick<Parameters<typeof planLiftRoot>[0], "cards" | "histories">,
  thread: ThreadId,
): boolean {
  const card = input.cards.find(c => c.id === thread)
  if (card?.place.kind !== "canvas") return false
  if ((input.histories.get(thread)?.events.length ?? 0) > 1) return false
  const { task } = card.place
  return !input.cards.some(
    c =>
      c.id !== thread &&
      (c.place.kind === "canvas" || c.place.kind === "task-pinned") &&
      c.place.task === task,
  )
}
