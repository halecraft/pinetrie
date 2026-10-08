// interface/perform — carry out the effects `planIntent` decided (`intent.ts`).
// The shell: one port call per effect, and nothing decided here.

import type { CardId, EntryId } from "@pinetrie/core"
import type { AttentionStore, SessionClient } from "@pinetrie/session"
import { afterKeep } from "./card-intents.ts"
import type { Effect } from "./effects.ts"
import type { Identity } from "./identity.ts"
import { afterRootMove, type Intent } from "./intent.ts"
import type { LayoutAction } from "./layout.ts"
import type { ListWidth } from "./list-width.ts"
import type { PageName } from "./page.ts"
import { afterSpinOff } from "./spin-off.ts"

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
    | "queueCard"
    | "moveCards"
    | "reorderCard"
    | "undoMoves"
    | "swapSlots"
    | "undoSwap"
    | "refuse"
    | "openThreads"
  >
  /** Your attention document: what "not needed" marks (ADR-0077). */
  readonly attention: Pick<AttentionStore, "dismiss" | "dismissOffer">
  /** The inventory panel: opened (briefly, for the flight of a take into it), and its selection. */
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
  /** Scroll to a queued card in its dock once it is drawn (`useReveal`). */
  readonly revealCard: (card: CardId) => void
  /** Open an ask's fold (`FoldMemory`). */
  readonly openFold: (ask: string) => void
  /** The column keyed `key` takes focus when it mounts. */
  readonly arm: (key: string) => void
  readonly identity: {
    readonly save: (identity: Identity) => void
    readonly clear: () => void
  }
  readonly reload: () => void
  /** Show the sidebar at a width, and keep the choice for this tab (ADR-0088). */
  readonly listWidth: (width: ListWidth) => void
  /** Show a page over the workspace, or, with null, the workspace (ADR-0098). */
  readonly page: (to: PageName | null) => void
}

export function perform(effects: readonly Effect[], ports: AppPorts): void {
  for (const effect of effects) performOne(effect, ports)
}

function performOne(effect: Effect, ports: AppPorts): void {
  switch (effect.kind) {
    case "layout":
      ports.dispatch(effect.action)
      return
    case "listWidth":
      ports.listWidth(effect.width)
      return
    case "page":
      ports.page(effect.to)
      return
    case "request":
      void ports.session.request(effect.intent)
      return
    case "offer":
      void ports.session.offer(effect.lane, effect.action, effect.to)
      return
    case "list": {
      const { openThreads } = ports.session
      const { act } = effect
      if (act.kind === "ensure") openThreads.ensure(act.root)
      else if (act.kind === "place") openThreads.open(act.root, act.before)
      else openThreads.close(act.root)
      return
    }
    case "spinOff":
      void ports.session
        .request(effect.request)
        .then(outcome =>
          perform(afterSpinOff(outcome, effect.thread, effect.sidebar), ports),
        )
      return
    case "moveRoot":
      void ports.session
        .request(effect.move)
        .then(outcome => perform(afterRootMove(outcome, effect.moved), ports))
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
    case "queueCard":
      // A card made in the queue comes from nowhere on the page.
      if (effect.move.from !== null) ports.fly(effect.move.card)
      void ports.session.queueCard(
        effect.move,
        effect.hold,
        effect.how,
        effect.command,
      )
      return
    case "reorderCard":
      void ports.session.reorderCard(effect.reorder, effect.how)
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
    case "revealCard":
      ports.revealCard(effect.card)
      return
    case "reveal":
      ports.reveal(effect.entry)
      return
    case "openWhenHeld":
      ports.openWhenHeld(effect.entry)
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
