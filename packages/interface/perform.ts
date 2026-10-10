// interface/perform — carry out the effects `planIntent` decided (`intent.ts`).
// The shell: one port call per effect, and nothing decided here.

import type { CardId, EntryId } from "@pinetrie/core"
import type { AttentionStore, SessionClient } from "@pinetrie/session"
import { afterKeep } from "./card-intents.ts"
import type { Effect } from "./effects.ts"
import type { Identity } from "./identity.ts"
import { afterTaskMove, type Intent } from "./intent.ts"
import type { LayoutAction } from "./layout.ts"
import type { ListWidth } from "./list-width.ts"
import type { PageName } from "./page.ts"
import type { TextUpload } from "./paste.ts"
import { afterSpinOff } from "./spin-off.ts"

export interface AppPorts {
  readonly dispatch: (action: LayoutAction) => void
  readonly session: Pick<
    SessionClient,
    | "request"
    | "offer"
    | "createCard"
    | "makeReference"
    | "editAsText"
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
    /** Open the selected slot's card. */
    readonly openSelected: () => void
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
  /** Show a page over the stage, or, with null, the stage (ADR-0098). */
  readonly page: (to: PageName | null) => void
  /** Keep markdown as a blob: a reference's quote (`uploadText`). */
  readonly uploadText: (markdown: string) => Promise<TextUpload>
  /** Put markdown on the system clipboard. */
  readonly clipboard: (text: string) => void
  /** Put text at the caret of the text box that has focus, as typed. */
  readonly insertText: (text: string) => void
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
      if (act.kind === "ensure") openThreads.ensure(act.task)
      else if (act.kind === "place") openThreads.open(act.task, act.before)
      else openThreads.close(act.task)
      return
    }
    case "spinOff":
      void ports.session
        .request(effect.request)
        .then(outcome =>
          perform(
            afterSpinOff(outcome, effect.request.task, effect.sidebar),
            ports,
          ),
        )
      return
    case "moveTask":
      void ports.session
        .request(effect.move)
        .then(outcome => perform(afterTaskMove(outcome, effect.moved), ports))
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
    case "takeReference":
      void ports.uploadText(effect.markdown).then(upload => {
        if (upload.ok)
          void ports.session.makeReference(
            {
              card: effect.card,
              to: effect.to,
              address: effect.address,
              quote: upload.ref.sha256,
            },
            effect.how,
          )
        // The quote could not be kept: nothing is taken, said where it was.
        else
          ports.session.refuse({
            card: effect.card,
            actedAt: effect.how.actedAt,
            code: "no-place",
            by: null,
            fromQueue: false,
          })
      })
      return
    case "makeReference":
      void ports.session.makeReference(
        {
          card: effect.card,
          to: effect.to,
          address: effect.address,
          quote: effect.quote,
        },
        effect.how,
      )
      return
    case "editAsText":
      void ports.session.editAsText(effect)
      return
    case "copyText":
      ports.clipboard(effect.text)
      return
    case "insertText":
      ports.insertText(effect.text)
      return
    case "moveCard":
      if (effect.fly) ports.fly(effect.move.card)
      void ports.session.moveCard(
        effect.move,
        effect.how,
        effect.queuedBy,
        effect.here,
      )
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
        .moveCards(effect.moves, effect.actedAt, effect.here)
        .then(answer => perform(afterKeep(answer, effect.close), ports))
      return
    case "undoMoves":
      void ports.session
        .undoMoves(effect.task, effect.direction)
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
    case "openSelected":
      ports.inventory.openSelected()
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
