// interface/effects — what an intent does, as values (`Effect`), and what
// planning one reads (`IntentState`). Showing a root and an entry are here
// because `planIntent`, the card intents and the reveal all plan them.

import type {
  Address,
  AskIndex,
  CanvasId,
  CardCommand,
  CardId,
  CardRecord,
  ConflictChoice,
  EntryId,
  LaneView,
  MessageAt,
  MoveDirection,
  MoveTarget,
  ProposedChangesAction,
  QueueHoldChange,
  QueueMove,
  ReferenceCardId,
  Reorder,
  Replacing,
  Sha256,
  TextCard,
  TextCardId,
  ThreadId,
  TreeIndex,
  TypedMove,
  WriterId,
} from "@pinetrie/core"
import type {
  ActedAt,
  CardNotice,
  HostRequest,
  MoveHow,
  SlotMove,
  Slots,
} from "@pinetrie/session"
import type { Raised } from "./attention.ts"
import { heldByOthers } from "./canvas-columns.ts"
import type { Canvases } from "./canvases.ts"
import type { Quote } from "./card-intents.ts"
import type { Clip } from "./clip.ts"
import type { FocusKey } from "./focus-claim.ts"
import type { Identity } from "./identity.ts"
import type { InventoryAct } from "./inventory-state.ts"
import {
  type Here,
  type Layout,
  type LayoutAction,
  planOpen,
  type ViewChange,
} from "./layout.ts"
import type { ListWidth } from "./list-width.ts"
import type { PageName } from "./page.ts"
import type { ComposerPlaces } from "./put-target.ts"
import type { SearchAct } from "./search.ts"

export type Effect =
  | {
      readonly kind: "layout"
      readonly action: LayoutAction
      /**
       * Whether a column moves into its fold or out of it as the action
       * lands (`ports.foldColumn`): only for a fold the reader asked for,
       * never one a navigation makes.
       */
      readonly moves: boolean
    }
  /** Show the sidebar at `width`, and keep that choice for this tab. */
  | { readonly kind: "list-width"; readonly width: ListWidth }
  /** Show a page over the stage, or, with null, the stage. */
  | { readonly kind: "page"; readonly to: PageName | null }
  /** Open, type in, clear or close the search of the root you are on. */
  | { readonly kind: "search"; readonly act: SearchAct }
  /** Mark what `lane` raised "not needed", in your attention document. */
  | {
      readonly kind: "not-needed"
      readonly lane: ThreadId
      readonly raised: Raised
    }
  /** Ask the host for something that moves no card (`HostRequest`). */
  | { readonly kind: "request"; readonly intent: HostRequest }
  /** Change the sidebar, in your own document (`openThreads`). */
  | { readonly kind: "list"; readonly act: ListAct }
  /**
   * Make a card a thread; `afterSpinOff` decides from its
   * answer what follows: for the sidebar, the new canvas placed and shown.
   */
  | {
      readonly kind: "spin-off"
      readonly request: Extract<HostRequest, { kind: "spin-off" }>
      readonly sidebar: { readonly before: CanvasId | null } | null
    }
  /**
   * Move a canvas on the board; `afterCanvasMove` decides from its answer
   * whether `moved` runs.
   */
  | {
      readonly kind: "move-canvas"
      readonly move: Extract<HostRequest, { kind: "move-canvas" }>
      readonly moved: readonly Effect[]
    }
  /**
   * A message sent as a column's composer would send it: a branch's first
   * from its card when you typed one, else its text.
   */
  | {
      readonly kind: "send"
      readonly text: string
      readonly at: MessageAt
      readonly card: TextCardId | null
    }
  | {
      readonly kind: "create-card"
      readonly card: TextCard
      readonly text: string
      readonly how: MoveHow
    }
  /**
   * A paste: a text card's text written first, a reference's
   * quote kept first when it is markdown or a comment's, then one request
   * that trashes the card it replaces and makes the card, or
   * moves a cut card out of your trash, where `to` sends it.
   */
  | {
      readonly kind: "paste"
      readonly paste: PastedCard
      readonly to: MoveTarget
      readonly replacing: Replacing | null
      readonly how: MoveHow
      /** The canvas you are on: a trash's history from your inventory. */
      readonly here: CanvasId | null
    }
  /** What the clipboard cell shows: the copy this tab just made. */
  | { readonly kind: "clipboard-cell"; readonly clip: Clip }
  /** Text at the caret of the text box that has focus. */
  | { readonly kind: "insert-text"; readonly text: string }
  /** A move: a take into the inventory, a put, an unqueue, a trash. */
  | {
      readonly kind: "move-card"
      readonly move: TypedMove
      readonly how: MoveHow
      /** Who queued the card, for an unqueue: a refusal names them. */
      readonly queuedBy: WriterId | null
      /** Whether the card animates to where it lands (`ports.fly`). */
      readonly fly: boolean
      /** The canvas you are on, for a trash: its history, from your inventory. */
      readonly here: CanvasId | null
    }
  /**
   * A card queued, and its queue's hold changed with it. A move
   * with no `from` makes the card there, carrying `command`.
   */
  | {
      readonly kind: "queue-card"
      readonly move: QueueMove
      readonly hold: QueueHoldChange
      readonly command: CardCommand | null
      readonly how: MoveHow
    }
  /** A reorder, drawn at once, as a move is. */
  | {
      readonly kind: "reorder-card"
      readonly reorder: Reorder
      readonly how: MoveHow
    }
  /** Swap two slots of your inventory, as one step of this tab's swaps. */
  | { readonly kind: "swap-slots"; readonly a: number; readonly b: number }
  /**
   * Moves sent as one, which the host accepts or refuses whole:
   * an unstarted branch's cards kept in your inventory as it closes, a card
   * put in your composer and the message it displaces, or a slot's
   * replacement. `afterKeep` decides from its answer whether
   * `close` runs.
   */
  | {
      readonly kind: "move-cards"
      /** At least one. */
      readonly moves: readonly [SlotMove, ...SlotMove[]]
      readonly actedAt: ActedAt
      readonly close: readonly Effect[]
      /** As `move-card`'s. */
      readonly here: CanvasId | null
    }
  /**
   * Undo or redo your newest move in `canvas`, or outside any canvas for none,
   * on the host.
   */
  | {
      readonly kind: "undo-moves"
      readonly canvas: CanvasId | null
      readonly direction: MoveDirection
    }
  /** Undo or redo this tab's newest swap in your inventory. */
  | { readonly kind: "undo-swap"; readonly direction: MoveDirection }
  /** Keep a refusal made before anything was sent. */
  | { readonly kind: "refuse"; readonly refusal: CardNotice }
  /** An act on your inventory panel: shown, its selection, its bench (`inventoryReducer`). */
  | { readonly kind: "inventory"; readonly act: InventoryAct }
  /** An action on proposed changes, which the session tracks (`acting`). */
  | {
      readonly kind: "proposed"
      readonly lane: ThreadId
      readonly action: ProposedChangesAction
      readonly to: string | null
    }
  /** A choice of a conflict's version, which the session tracks (`acting`). */
  | {
      readonly kind: "resolve"
      readonly lane: ThreadId
      readonly path: string
      readonly choose: ConflictChoice
    }
  /** Once this tab holds entry `entry`, show it (`open-at`). */
  | { readonly kind: "open-when-held"; readonly entry: EntryId }
  /** Scroll to entry `entry` once it is drawn (`useReveal`). */
  | { readonly kind: "reveal"; readonly entry: EntryId }
  /** Outline entry `entry` briefly, once drawn: where leaving a search landed. */
  | { readonly kind: "landed"; readonly entry: EntryId }
  /** Scroll a queued card into view in its column's dock. */
  | { readonly kind: "reveal-card"; readonly card: CardId }
  /** Open ask `ask`'s fold, so what is revealed in it is drawn. */
  | { readonly kind: "open-fold"; readonly ask: EntryId }
  /** What `key` names takes focus when it mounts (`claimFocus`). */
  | { readonly kind: "arm-focus"; readonly key: FocusKey }
  | { readonly kind: "store-identity"; readonly identity: Identity }
  | { readonly kind: "forget-identity" }
  | { readonly kind: "reload" }

/** A change to the sidebar, by canvas: your document's key. */
export type ListAct =
  /** At its end, unless it is in the sidebar already. */
  | { readonly kind: "ensure"; readonly canvas: CanvasId }
  | {
      readonly kind: "place"
      readonly canvas: CanvasId
      readonly before: CanvasId | null
    }
  | { readonly kind: "close"; readonly canvas: CanvasId }

export interface IntentState {
  readonly layout: Layout
  readonly index: TreeIndex
  /** Every ask (`indexAsks`): a pick into one's work opens its fold. */
  readonly asks: AskIndex
  readonly cards: CardFacts
  /**
   * Every canvas: an entry opens in the canvas its thread is in, and
   * a canvas's columns are its canvas's.
   */
  readonly canvases: Canvases
  /** What the sidebar shows now (`shownWidth`). */
  readonly listWidth: ListWidth
  /** The page over the stage, if any. */
  readonly page: PageName | null
  /** A search applies on the root you are on (`searchOn`). */
  readonly searching: boolean
  /** What a copy and a paste read. */
  readonly clips: ClipLookups
}

/** What a paste makes, as the page plans it (`Paste`, with what it writes first). */
export type PastedCard =
  | {
      readonly kind: "text"
      readonly card: TextCardId
      readonly origin: Address | null
      /** Written into the card before the host makes it. */
      readonly text: string
    }
  | {
      readonly kind: "reference"
      readonly card: ReferenceCardId
      readonly address: Address
      readonly quote: Quote
    }
  | { readonly kind: "uncut"; readonly card: CardId }

/** What a copy reads beyond the cards: texts, quotes, and the clipboard cell. */
export interface ClipLookups {
  /** A text card's text as this tab has it. */
  readonly textOf: (card: TextCardId) => string
  /** A reference's quote if this tab has fetched it. */
  readonly quoteOf: (quote: Sha256) => string | null
  /** The last copy this tab made. */
  readonly cell: Clip | null
}

/** What the card intents decide from. */
export interface CardFacts {
  /** Every card as drawn. */
  readonly cards: readonly CardRecord[]
  readonly lanes: readonly LaneView[]
  readonly me: WriterId
  /** Your cards that hold text (`holdsText`): an empty message gives way to a put. */
  readonly filled: ReadonlySet<CardId>
  /** Your inventory's slots as drawn (`settleSlots`). */
  readonly slots: Slots
  /** The selected slot. */
  readonly selected: number
  /** Each column's composer, by key. */
  readonly composers: ComposerPlaces
}

export const findCard = (
  facts: Pick<CardFacts, "cards">,
  card: CardId,
): CardRecord | undefined => facts.cards.find(c => c.id === card)

/**
 * The canvas an undo of moves acts in, and a trash's history: the canvas you
 * are on. None on nothing.
 */
export function canvasOfTab(state: IntentState): CanvasId | null {
  const active = state.layout.active
  return active?.kind === "canvas" ? active.canvas : null
}

/** An effect on the layout, and one on the sidebar: the constructors the planners share. */
export const layout = (action: LayoutAction): Effect => ({
  kind: "layout",
  action,
  moves: false,
})
export const list = (act: ListAct): Effect => ({ kind: "list", act })

/** `canvas` leaves the sidebar, and if you are on it, its neighbour is shown. */
export const closeCanvasEffects = (canvas: CanvasId): readonly Effect[] => [
  list({ kind: "close", canvas }),
  layout({ kind: "close-canvas", canvas }),
]

/** Show `here`; a canvas shown is opened in the sidebar, at its end if it was not there. */
export function show(here: Here): readonly Effect[] {
  const shown = layout({ kind: "show", here })
  return here.kind === "canvas"
    ? [shown, list({ kind: "ensure", canvas: here.canvas })]
    : [shown]
}
export const showCanvas = (canvas: CanvasId): readonly Effect[] =>
  show({ kind: "canvas", canvas })

/** A change to your view of `canvas`: a view made by it starts from the canvas (`defaultView`). */
const viewAction = (
  state: Pick<IntentState, "canvases">,
  canvas: CanvasId,
  change: ViewChange,
): LayoutAction => ({
  kind: "view",
  canvas,
  first: state.canvases.index.cardsOn.get(canvas)?.[0]?.id ?? null,
  change,
})

/** A change to your view of `canvas` (`ViewChange`), as an effect. */
export const viewChangeEffect = (
  state: Pick<IntentState, "canvases">,
  canvas: CanvasId,
  change: ViewChange,
): Effect => layout(viewAction(state, canvas, change))

/**
 * A fold or unfold of a column of `canvas` that the reader asked for: as
 * `viewChangeEffect`, and the column moves as it folds.
 */
export const foldViewEffect = (
  state: Pick<IntentState, "canvases">,
  canvas: CanvasId,
  change: Extract<ViewChange, { kind: "fold" | "fold-canvas" }>,
): Effect => ({
  kind: "layout",
  action: viewAction(state, canvas, change),
  moves: true,
})

/**
 * Show entry `id` (`planOpen`): in view in the column that shows it, or in
 * its thread's column, unfolded. An entry of an ask's work opens the ask's
 * fold first, whatever the column's density, so it is drawn to be revealed:
 * forks, branch starts and people's messages are never in one.
 */
export function planOpenEntry(
  id: EntryId,
  state: IntentState,
): readonly Effect[] {
  const plan = planOpen(
    state.layout,
    state.index,
    id,
    state.canvases.index,
    state.cards.lanes,
    heldByOthers(state.cards.cards, state.cards.me),
  )
  if (plan === null) return []
  const ask = state.asks.askOf.get(id)
  const fold: readonly Effect[] =
    ask === undefined ? [] : [{ kind: "open-fold", ask }]
  switch (plan.kind) {
    case "scroll":
      return [
        ...fold,
        { kind: "reveal", entry: id },
        ...showCanvas(plan.canvas),
      ]
    case "unfold":
      return [
        ...fold,
        { kind: "reveal", entry: id },
        ...showCanvas(plan.canvas),
        viewChangeEffect(state, plan.canvas, {
          kind: "fold",
          card: plan.card,
          unfolded: true,
        }),
      ]
  }
}
