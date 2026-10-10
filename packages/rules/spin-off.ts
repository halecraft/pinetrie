// spin-off — a text card that becomes a thread (ADR-0111, ADR-0113,
// ADR-0126): dropped on a workflow state, or in the sidebar, it opens a new
// conversation root's first thread in a new task (`planThreadOpen`), whose
// record says it was spun from the card, sends the card's text as its first
// message, and moves the card to its sender's trash. The undo key lifts the
// root back into the card while the root holds that first message alone
// (S139). Pure.

import {
  type CardHistoryRecord,
  type CardId,
  type CardRecord,
  type Intent,
  type LaneRecord,
  type Mention,
  type MoveRefusal,
  parseMentions,
  parseTextCardId,
  type RootId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import { type MoveStep, planMove } from "./moves.ts"
import {
  planThreadOpen,
  rootOfPlace,
  type TaskIndex,
  type TaskOpening,
  type ThreadOpen,
} from "./task.ts"

/** A spin-off as its sender asks for it. */
export type SpinOff = Omit<Extract<Intent, { kind: "spin-off" }>, "kind">

/** What a spin-off writes: the thread's opening, its first message, then the card's move. */
export interface SpinOffPlan {
  readonly kind: "spin"
  /** The new conversation root. */
  readonly root: RootId
  /** The thread its first message starts (ADR-0117). */
  readonly thread: ThreadId
  /** Its record, its task's, and its card on its task's canvas (`planThreadOpen`). */
  readonly open: Extract<ThreadOpen, { kind: "open" }>
  /** Its first message: the card's text, by the sender. */
  readonly text: string
  /** The people it names; never the agent: a conversation root has no lane. */
  readonly mentions: readonly Mention[]
  /** The card's move to its sender's trash. */
  readonly step: Extract<MoveStep, { kind: "write" }>
}

export type SpinOffRefusal =
  | { readonly kind: "refused"; readonly code: MoveRefusal }
  /** A card with nothing in it starts no thread. */
  | { readonly kind: "blank" }
  /** The root id its tab minted is in use. */
  | { readonly kind: "root-in-use" }

/**
 * A spin-off, planned: refused when the move is not a text card's to the
 * trash, when the root's or the thread's id is in use, when the card holds
 * no text, or as `planMove` refuses the card's move (someone moved it
 * first, it is not yours). Otherwise the thread's opening in its new task,
 * its first message, and the card's move.
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
  /** Every thread recorded. */
  readonly threads: ReadonlySet<ThreadId>
  /** Where its new task lands on the board. */
  readonly opens: TaskOpening
  readonly now: number
}): SpinOffPlan | SpinOffRefusal {
  const { move, root, thread } = input.request
  const card = parseTextCardId(move.card)
  if (move.to.kind !== "trash" || move.from === null || card === undefined)
    return { kind: "refused", code: "moved" }
  if (input.roots.has(root)) return { kind: "root-in-use" }
  if (input.threads.has(thread)) return { kind: "refused", code: "exists" }
  const text = input.text.trim()
  if (text === "") return { kind: "blank" }
  const step = planMove(input.cards, move, input.sender, {
    tasks: input.tasks,
    here: input.request.here,
  })
  if (step.kind === "refused") return { kind: "refused", code: step.code }
  if (step.kind !== "write") return { kind: "refused", code: "moved" }
  const open = planThreadOpen({
    thread,
    origin: { kind: "spun", card },
    root,
    by: input.sender,
    now: input.now,
    placement: { kind: "after", task: input.request.task, parent: null },
    opens: { ...input.opens, state: input.request.state },
    cards: input.cards,
  })
  if (open.kind === "refused") return { kind: "refused", code: open.code }
  return {
    kind: "spin",
    root,
    thread,
    open,
    text,
    mentions: parseMentions(text).filter(m => m.kind !== "agent"),
    step,
  }
}

/**
 * What a lift needs to know of a thread spun from a card an undo moves
 * (its record's `origin`, ADR-0126).
 */
export interface SpunThread {
  readonly thread: ThreadId
  readonly root: RootId
  /** Whether the directory names its root: a thread lifted already is not. */
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
 * Whether an undo that moves cards spun into threads (`spun`, those whose
 * record names a card the step moves, S139) may lift those threads back:
 * each must hold its first message alone, with no lane and no card in it
 * but those the undo moves (`lifting`), and its card must still be where
 * the spin-off put it, alone on its task's canvas with nothing pinned to
 * the task (ADR-0124): an undo restores exactly what was there, or does
 * nothing. A thread the directory no longer names has nothing to lift.
 * Refused `replied`, naming who wrote second, when any holds more. Pure.
 */
export function planLiftRoot(input: {
  readonly lifting: readonly CardId[]
  readonly spun: readonly SpunThread[]
  readonly cards: readonly CardRecord[]
  readonly lanes: readonly LaneRecord[]
  /** Each recorded thread's root (`TaskIndex`): a card at a thread names no root. */
  readonly rootOfThread: ReadonlyMap<ThreadId, RootId>
  /** Each card's history: a thread's card that moved since it was made has more than one event. */
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
}): LiftPlan {
  const deleting: { root: RootId; thread: ThreadId }[] = []
  for (const spun of input.spun) {
    if (!spun.known) continue
    const second = spun.writers[1]
    if (second !== undefined) return { kind: "replied", by: second }
    const others = input.cards.some(
      c =>
        c.id !== spun.thread &&
        !input.lifting.includes(c.id) &&
        rootOfPlace(c.place, input.rootOfThread) === spun.root,
    )
    const lane = input.lanes.some(l => l.root === spun.root)
    if (others || lane || !aloneInItsTask(input, spun.thread))
      return { kind: "replied", by: null }
    deleting.push({ root: spun.root, thread: spun.thread })
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
