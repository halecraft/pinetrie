// interface/spin-off — a text card made a thread: dropped on a workflow state,
// on the board or the footer's strip, or in the sidebar, or chosen from its ⋯.
// The page mints the new root's, thread's and canvas's ids; the host opens the
// thread in the canvas, sends the card's text as its first message, and moves the
// card to its sender's trash.

import type { CanvasId, WorkflowStateId } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import type { HostRequest } from "@pinetrie/session"
import { type CardId, cardMove, TRASH_PLACE } from "@pinetrie/threads"
import type { Minted } from "./columns.ts"
import {
  canvasOfTab,
  type Effect,
  findCard,
  type IntentState,
  layout,
  list,
} from "./effects.ts"

/** Where a card becomes a thread: a state on the board, or a place in the sidebar. */
type SpinTarget =
  | { readonly kind: "state"; readonly state: WorkflowStateId }
  /** Before canvas `before` in the sidebar, or at its end. */
  | { readonly kind: "sidebar"; readonly before: CanvasId | null }

/**
 * Make `card` a thread at `to`, the first message of the thread, the root
 * and the canvas `minted` names (minted by the page): a `spin-off` request,
 * and for the sidebar, the new canvas placed there and shown once the host
 * answers. The host names its move's history: the canvas it leaves, or, from
 * your inventory, the canvas you will be on, which it carries: the new one,
 * for the sidebar; else the one you are on. Nothing for any card but a text
 * card, or one in someone else's inventory.
 */
export function planSpinOff(
  card: CardId,
  to: SpinTarget,
  minted: Minted,
  state: IntentState,
): readonly Effect[] {
  const now = findCard(state.cards, card)
  if (now === undefined || now.kind !== "text") return []
  const { place } = now
  if (place.kind === "inventory" && place.holder !== state.cards.me) return []
  if (place.kind === "trash") return []
  const request: Extract<HostRequest, { kind: "spin-off" }> = {
    kind: "spin-off",
    move: cardMove(now, TRASH_PLACE),
    root: minted.root,
    thread: minted.thread,
    canvas: minted.canvas,
    state: to.kind === "state" ? to.state : null,
    here: to.kind === "sidebar" ? minted.canvas : canvasOfTab(state),
  }
  return [
    {
      kind: "spin-off",
      request,
      sidebar: to.kind === "sidebar" ? { before: to.before } : null,
    },
  ]
}

/**
 * What follows the host's answer to a spin-off: for the sidebar, the new
 * canvas placed there and shown. Nothing otherwise, or when the thread was
 * not started.
 */
export function afterSpinOff(
  outcome: Outcome,
  canvas: CanvasId,
  sidebar: { readonly before: CanvasId | null } | null,
): readonly Effect[] {
  if (sidebar === null || outcome.kind !== "appended") return []
  return newCanvasEffects(canvas, sidebar.before, true)
}

/**
 * A new canvas made from the sidebar, once the host made it: placed in your
 * sidebar before `before` (at its end for null), and shown when `show`. A
 * spin-off shows the canvas it made; a column dropped between canvases does not,
 * so you stay where you were.
 */
export const newCanvasEffects = (
  canvas: CanvasId,
  before: CanvasId | null,
  show: boolean,
): readonly Effect[] => [
  list({ kind: "place", canvas, before }),
  ...(show ? [layout({ kind: "show", here: { kind: "canvas", canvas } })] : []),
]
