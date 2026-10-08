// interface/spin-off — a text card made a thread (ADR-0111): dropped on a
// workflow state, on the board or the footer's strip, or in the sidebar,
// or chosen from its ⋯. The page mints the new root's id; the host starts
// the thread and moves the card to gone, spun into it. Pure.

import {
  type CardId,
  type EntryId,
  moveOf,
  type RootId,
  type WorkflowStateId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import type { HostRequest } from "@pinetrie/session"
import { cardOf, rootOfTab } from "./card-intents.ts"
import { type Effect, type IntentState, layout, list } from "./effects.ts"

/** Where a card becomes a thread: a state on the board, or a place in the sidebar. */
export type SpinTarget =
  | { readonly kind: "state"; readonly state: WorkflowStateId }
  /** Before `before` in the sidebar, by its root entry, or at its end. */
  | { readonly kind: "sidebar"; readonly before: EntryId | null }

/**
 * Make `card` a thread at `to`, the root `thread` (minted by the page): a
 * `spin-off` request, and for the sidebar, the new root placed there and
 * shown once the host answers. Its move goes in the history of the root you
 * will be on: the new one, for the sidebar; else the card's own root, or
 * for a card in no root (your inventory) the root you are on. Nothing for a
 * fact, or a card in someone else's inventory.
 */
export function planSpinOff(
  card: CardId,
  to: SpinTarget,
  thread: RootId,
  state: IntentState,
): readonly Effect[] {
  const now = cardOf(state.cards, card)
  if (now === undefined || now.carries.kind === "fact") return []
  const { place } = now
  if (place.kind === "inventory" && place.holder !== state.cards.me) return []
  if (place.kind === "gone") return []
  const history =
    to.kind === "sidebar"
      ? thread
      : place.kind === "inventory"
        ? rootOfTab(state)
        : place.root
  const move = moveOf(now, {
    kind: "gone",
    root: history,
    why: { kind: "spun", thread },
  })
  const request: Extract<HostRequest, { kind: "spin-off" }> = {
    kind: "spin-off",
    move,
    state: to.kind === "state" ? to.state : null,
  }
  return [
    {
      kind: "spinOff",
      request,
      thread,
      sidebar:
        to.kind === "sidebar"
          ? {
              before:
                to.before === null
                  ? null
                  : (state.rootIds.get(to.before) ?? null),
            }
          : null,
    },
  ]
}

/**
 * What follows the host's answer to a spin-off: for the sidebar, the new
 * root placed there and shown, by its first message, which is its root
 * entry. Nothing otherwise, or when the thread was not started.
 */
export function afterSpinOff(
  outcome: Outcome,
  thread: RootId,
  sidebar: { readonly before: RootId | null } | null,
): readonly Effect[] {
  if (sidebar === null || outcome.kind !== "appended") return []
  return [
    list({ kind: "place", root: thread, before: sidebar.before }),
    layout({ kind: "show", here: { kind: "root", root: outcome.id } }),
  ]
}
