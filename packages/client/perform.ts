// client/perform — carry out the effects `planIntent` decided (`intent.ts`).
// The shell: one port call per effect, and nothing decided here.

import type { CardId, EntryId } from "@pineta/core"
import type { AttentionStore, SessionClient } from "@pineta/session"
import { afterKeep } from "./card-intents.ts"
import type { Identity } from "./identity.ts"
import { afterRestore, type Effect, type Intent } from "./intent.ts"
import type { LayoutAction } from "./layout.ts"

export interface AppPorts {
  readonly dispatch: (action: LayoutAction) => void
  readonly session: Pick<
    SessionClient,
    | "request"
    | "offer"
    | "mark"
    | "retitle"
    | "createCard"
    | "moveCard"
    | "moveCards"
    | "undoMoves"
    | "swapSlots"
    | "undoSwap"
    | "refuse"
  >
  /** Your attention document: what "not needed" marks (ADR-0077). */
  readonly attention: Pick<AttentionStore, "dismiss" | "dismissOffer">
  /** The inventory panel: opened (briefly, for a take's flight), and its selection. */
  readonly inventory: {
    readonly show: (brief: boolean) => void
    readonly select: (slot: number) => void
  }
  /** Measure a card's box before it moves, so it flies to where it lands. */
  readonly fly: (card: CardId) => void
  /** Plan and carry out an intent afresh, after something it waited for. */
  readonly intent: (intent: Intent) => void
  /** Show an entry once this tab holds it (`openAt`). */
  readonly openWhenHeld: (entry: EntryId) => void
  /** Scroll to an entry once it is drawn (`useReveal`). */
  readonly reveal: (entry: string) => void
  /** Open an ask's fold (`FoldMemory`). */
  readonly openFold: (ask: string) => void
  /** Select a root in the Archive tab. */
  readonly pickArchived: (root: EntryId) => void
  /** The column keyed `key` takes focus when it mounts. */
  readonly arm: (key: string) => void
  readonly identity: {
    readonly save: (identity: Identity) => void
    readonly clear: () => void
  }
  readonly reload: () => void
}

export function perform(effects: readonly Effect[], ports: AppPorts): void {
  for (const effect of effects) performOne(effect, ports)
}

function performOne(effect: Effect, ports: AppPorts): void {
  switch (effect.kind) {
    case "layout":
      ports.dispatch(effect.action)
      return
    case "request":
      void ports.session.request(effect.intent)
      return
    case "offer":
      void ports.session.offer(effect.lane, effect.action, effect.to)
      return
    case "restore":
      void ports.session
        .request({ kind: "archive", action: "restore", root: effect.root })
        .then(outcome => perform(afterRestore(outcome, effect.root), ports))
      return
    case "mark":
      void ports.session.mark(effect.root, effect.title)
      return
    case "retitle":
      void ports.session.retitle(effect.root)
      return
    case "notNeeded":
      if (effect.raised.kind === "verdict")
        ports.attention.dismiss(effect.lane, effect.raised.ask)
      else if (effect.raised.source !== null)
        ports.attention.dismissOffer(effect.lane, effect.raised.source)
      return
    case "createCard":
      void ports.session.createCard(effect.card, effect.text, effect.how)
      return
    case "moveCard":
      if (effect.fly) ports.fly(effect.move.card)
      void ports.session.moveCard(effect.move, effect.how, effect.queuedBy)
      return
    case "swapSlots":
      ports.session.swapSlots(effect.a, effect.b)
      return
    case "keep":
      for (const { move } of effect.moves) ports.fly(move.card)
      void ports.session
        .moveCards(effect.moves, effect.actedAt)
        .then(answer => perform(afterKeep(answer, effect.close), ports))
      return
    case "undoMoves":
      void ports.session
        .undoMoves(effect.root, effect.direction)
        .then(outcome => ports.intent({ kind: "undoAnswered", outcome }))
      return
    case "undoSwap":
      void ports.session.undoSwap(effect.direction)
      return
    case "refuse":
      ports.session.refuse(effect.refusal)
      return
    case "showInventory":
      ports.inventory.show(effect.brief)
      return
    case "select":
      ports.inventory.select(effect.slot)
      return
    case "openFold":
      ports.openFold(effect.ask)
      return
    case "reveal":
      ports.reveal(effect.entry)
      return
    case "openWhenHeld":
      ports.openWhenHeld(effect.entry)
      return
    case "pickArchived":
      ports.pickArchived(effect.root)
      return
    case "armFocus":
      ports.arm(effect.key)
      return
    case "storeIdentity":
      ports.identity.save(effect.identity)
      return
    case "forgetIdentity":
      ports.identity.clear()
      return
    case "reload":
      ports.reload()
      return
  }
}
