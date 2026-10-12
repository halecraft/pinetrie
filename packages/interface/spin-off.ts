// interface/spin-off — a text card made a thread: dropped on a workflow state,
// on the board or the footer's strip, or in the sidebar, or chosen from its ⋯.
// The page mints the new root's, thread's and task's ids; the host opens the
// thread in the task, sends the card's text as its first message, and moves the
// card to its sender's trash.

import {
  type CardId,
  DISCARDED,
  moveOf,
  type TaskId,
  type WorkflowStateId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import type { HostRequest } from "@pinetrie/session"
import { cardOf, taskOfTab } from "./card-intents.ts"
import type { Minted } from "./columns.ts"
import { type Effect, type IntentState, layout, list } from "./effects.ts"

/** Where a card becomes a thread: a state on the board, or a place in the sidebar. */
export type SpinTarget =
  | { readonly kind: "state"; readonly state: WorkflowStateId }
  /** Before task `before` in the sidebar, or at its end. */
  | { readonly kind: "sidebar"; readonly before: TaskId | null }

/**
 * Make `card` a thread at `to`, the first message of the thread, the root
 * and the task `minted` names (minted by the page): a `spin-off` request,
 * and for the sidebar, the new task placed there and shown once the host
 * answers. The host names its move's history: the task it leaves, or, from
 * your inventory, the task you will be on, which it carries: the new one,
 * for the sidebar; else the one you are on. Nothing for any card but a text
 * card, or one in someone else's inventory.
 */
export function planSpinOff(
  card: CardId,
  to: SpinTarget,
  minted: Minted,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  if (now === undefined || now.kind !== "text") return []
  const { place } = now
  if (place.kind === "inventory" && place.holder !== state.cards.me) return []
  if (place.kind === "trash") return []
  const request: Extract<HostRequest, { kind: "spin-off" }> = {
    kind: "spin-off",
    move: moveOf(now, DISCARDED),
    root: minted.root,
    thread: minted.thread,
    task: minted.task,
    state: to.kind === "state" ? to.state : null,
    here: to.kind === "sidebar" ? minted.task : taskOfTab(state),
  }
  return [
    {
      kind: "spinOff",
      request,
      sidebar: to.kind === "sidebar" ? { before: to.before } : null,
    },
  ]
}

/**
 * What follows the host's answer to a spin-off: for the sidebar, the new
 * task placed there and shown. Nothing otherwise, or when the thread was
 * not started.
 */
export function afterSpinOff(
  outcome: Outcome,
  task: TaskId,
  sidebar: { readonly before: TaskId | null } | null,
): readonly Effect[] {
  if (sidebar === null || outcome.kind !== "appended") return []
  return newTaskEffects(task, sidebar.before, true)
}

/**
 * A new task made from the sidebar, once the host made it: placed in your
 * sidebar before `before` (at its end for null), and shown when `show`. A
 * spin-off shows the task it made; a column dropped between tasks does not,
 * so you stay where you were.
 */
export const newTaskEffects = (
  task: TaskId,
  before: TaskId | null,
  show: boolean,
): readonly Effect[] => [
  list({ kind: "place", task, before }),
  ...(show ? [layout({ kind: "show", here: { kind: "task", task } })] : []),
]
