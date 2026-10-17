// interface/perform — carry out the effects `planIntent` decided (`intent.ts`).
// The shell: one port call per effect, and nothing decided here.

import type { CardId, EntryId, Paste, Sha256 } from "@pinetrie/core"
import {
  AT_BOARD,
  type AttentionStore,
  type SessionClient,
} from "@pinetrie/session"
import { afterKeep } from "./card-intents.ts"
import type { Clip } from "./clip.ts"
import type { Effect } from "./effects.ts"
import type { FocusKey } from "./focus-claim.ts"
import { type ColumnMotion, foldMotion } from "./fold-motion.ts"
import type { Identity } from "./identity.ts"
import { afterCanvasMove, type Intent } from "./intent.ts"
import type { LayoutAction } from "./layout.ts"
import type { ListWidth } from "./list-width.ts"
import { commentMarkdown } from "./markdown-of.ts"
import type { PageName } from "./page.ts"
import type { SearchAct } from "./search.ts"
import { afterSpinOff } from "./spin-off.ts"
import type { Upload } from "./upload.ts"

export interface AppPorts {
  readonly dispatch: (action: LayoutAction) => void
  readonly session: Pick<
    SessionClient,
    | "request"
    | "send"
    | "proposed"
    | "resolve"
    | "createCard"
    | "cardText"
    | "paste"
    | "moveCard"
    | "queueCard"
    | "moveCards"
    | "reorderCard"
    | "undoMoves"
    | "swapSlots"
    | "undoSwap"
    | "refuse"
    | "acted"
    | "openThreads"
  >
  /** Your attention document: what "not needed" marks. */
  readonly attention: Pick<AttentionStore, "dismiss" | "dismissReady">
  /** The inventory panel: opened (briefly, for the flight of a take into it), and its selection. */
  readonly inventory: {
    readonly show: (brief: boolean) => void
    readonly select: (slot: number) => void
    /** Open the selected slot's card. */
    readonly openSelected: () => void
  }
  /** Measure a card's box before it moves, so it flies to where it lands. */
  readonly fly: (card: CardId) => void
  /**
   * Move a column into its fold or out of it, calling `commit`, which lands
   * the fold, exactly once: before the motion for an unfold, after it for a
   * fold, at once when nothing moves.
   */
  readonly foldColumn: (motion: ColumnMotion, commit: () => void) => void
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
  /** What `key` names takes focus when it mounts. */
  readonly arm: (key: FocusKey) => void
  readonly identity: {
    readonly save: (identity: Identity) => void
    readonly clear: () => void
  }
  readonly reload: () => void
  /** Show the sidebar at a width, and keep the choice for this tab. */
  readonly listWidth: (width: ListWidth) => void
  /** Show a page over the stage, or, with null, the stage. */
  readonly page: (to: PageName | null) => void
  /** Carry a search act out on the tab's search (`searchReducer`). */
  readonly search: (act: SearchAct) => void
  /** Outline a message briefly once it is drawn (`useReveal`). */
  readonly landed: (entry: EntryId) => void
  /** Keep markdown as a blob: a reference's quote (`uploadBlob`). */
  readonly uploadBlob: (markdown: string) => Promise<Upload>
  /** Show `clip` in the clipboard cell: the copy this tab just made. */
  readonly clipboardCell: (clip: Clip) => void
  /** Put text at the caret of the text box that has focus, as typed. */
  readonly insertText: (text: string) => void
}

export function perform(effects: readonly Effect[], ports: AppPorts): void {
  for (const effect of effects) performOne(effect, ports)
}

/**
 * A paste: a reference's quote kept as a blob first when it is
 * markdown (the past's, or a comment's under a link to its entry, read
 * now), then the paste sent. A quote that could not be kept pastes
 * nothing, said where it was asked for.
 */
function paste(
  effect: Extract<Effect, { kind: "paste" }>,
  ports: AppPorts,
): void {
  const send = (pasted: Paste, text: string) =>
    void ports.session.paste(
      {
        paste: pasted,
        to: effect.to,
        replacing: effect.replacing,
        here: effect.here,
        text,
      },
      effect.how,
    )
  const { paste: card } = effect
  if (card.kind !== "reference") {
    send(
      card.kind === "text"
        ? { kind: "text", card: card.card, origin: card.origin }
        : card,
      card.kind === "text" ? card.text : "",
    )
    return
  }
  const asReference = (quote: Sha256) =>
    send(
      {
        kind: "reference",
        card: card.card,
        address: card.address,
        quote,
      },
      "",
    )
  const { quote } = card
  if (quote.kind === "kept") {
    asReference(quote.sha)
    return
  }
  const markdown =
    quote.kind === "markdown"
      ? quote.text
      : commentMarkdown(
          quote.entry,
          ports.session.cardText(quote.comment).text(),
        )
  void ports.uploadBlob(markdown).then(upload => {
    if (upload.ok) asReference(upload.ref.sha256)
    else
      ports.session.refuse({
        card: card.card,
        actedAt: effect.how.actedAt,
        code: "no-place",
        by: null,
        fromQueue: false,
      })
  })
}

function performOne(effect: Effect, ports: AppPorts): void {
  switch (effect.kind) {
    case "layout": {
      const motion = effect.moves ? foldMotion(effect.action) : null
      if (motion === null) ports.dispatch(effect.action)
      else ports.foldColumn(motion, () => ports.dispatch(effect.action))
      return
    }
    case "listWidth":
      ports.listWidth(effect.width)
      return
    case "page":
      ports.page(effect.to)
      return
    case "search":
      ports.search(effect.act)
      return
    case "request":
      void ports.session.request(effect.intent)
      return
    case "proposed":
      void ports.session.proposed(effect.lane, effect.action, effect.to)
      return
    case "resolve":
      void ports.session.resolve(effect.lane, effect.path, effect.choose)
      return
    case "list": {
      const { openThreads } = ports.session
      const { act } = effect
      if (act.kind === "ensure") openThreads.ensure(act.canvas)
      else if (act.kind === "place") openThreads.open(act.canvas, act.before)
      else openThreads.close(act.canvas)
      return
    }
    case "spinOff":
      void ports.session
        .request(effect.request)
        .then(outcome =>
          perform(
            afterSpinOff(outcome, effect.request.canvas, effect.sidebar),
            ports,
          ),
        )
      return
    case "moveCanvas":
      // A move made on the board: the refusal said there before goes.
      ports.session.acted(AT_BOARD)
      void ports.session
        .request(effect.move)
        .then(outcome => perform(afterCanvasMove(outcome, effect.moved), ports))
      return
    case "notNeeded":
      if (effect.raised.kind === "runEnd")
        ports.attention.dismiss(effect.lane, effect.raised.ask)
      else if (effect.raised.kind === "ready" && effect.raised.source !== null)
        ports.attention.dismissReady(effect.lane, effect.raised.source)
      return
    case "send":
      void ports.session.send(
        effect.text,
        effect.at,
        effect.card === null ? {} : { card: effect.card },
      )
      return
    case "createCard":
      void ports.session.createCard(effect.card, effect.text, effect.how)
      return
    case "paste":
      paste(effect, ports)
      return
    case "clipboardCell":
      ports.clipboardCell(effect.clip)
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
    case "moveCards":
      for (const { move } of effect.moves) ports.fly(move.card)
      void ports.session
        .moveCards(effect.moves, effect.actedAt, effect.here)
        .then(answer => perform(afterKeep(answer, effect.close), ports))
      return
    case "undoMoves":
      void ports.session
        .undoMoves(effect.canvas, effect.direction)
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
    case "landed":
      ports.landed(effect.entry)
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
