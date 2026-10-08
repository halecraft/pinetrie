// interface/effects — what an intent does, as values (`Effect`), and what
// planning one reads (`IntentState`): the vocabulary `planIntent`
// (`intent.ts`), the card intents (`card-intents.ts`) and the reveal
// (`reveal.ts`) plan in, and `perform` carries out through a client's ports.
// Showing a root and an entry are here because all three plan them. Pure.

import type {
  AskIndex,
  CardCommand,
  CardId,
  CardRecord,
  EntryId,
  LaneName,
  LaneRecord,
  LaneView,
  Move,
  MoveDirection,
  OfferAction,
  QueueHoldChange,
  Reorder,
  RootId,
  TreeIndex,
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
import type { Identity } from "./identity.ts"
import {
  type Here,
  type Layout,
  type LayoutAction,
  planOpen,
} from "./layout.ts"
import type { ListWidth } from "./list-width.ts"
import type { PageName } from "./page.ts"
import type { ComposerPlaces } from "./put-target.ts"

export type Effect =
  | { readonly kind: "layout"; readonly action: LayoutAction }
  /** Show the sidebar at `width`, and keep that choice for this tab. */
  | { readonly kind: "listWidth"; readonly width: ListWidth }
  /** Show a page over the workspace, or, with null, the workspace (ADR-0098). */
  | { readonly kind: "page"; readonly to: PageName | null }
  /** Mark what `lane` raised "not needed", in your attention document. */
  | {
      readonly kind: "notNeeded"
      readonly lane: LaneName
      readonly raised: Raised
    }
  /** Ask the host for something that moves no card (`HostRequest`). */
  | { readonly kind: "request"; readonly intent: HostRequest }
  /** Change the sidebar, in your own document (`openThreads`, ADR-0122). */
  | { readonly kind: "list"; readonly act: ListAct }
  /**
   * Make a card a thread (ADR-0111); `afterSpinOff` decides from its
   * answer what follows: for the sidebar, the new root placed and shown.
   */
  | {
      readonly kind: "spinOff"
      readonly request: Extract<HostRequest, { kind: "spin-off" }>
      readonly thread: RootId
      readonly sidebar: { readonly before: RootId | null } | null
    }
  /**
   * Move a root on the board; `afterRootMove` decides from its answer
   * whether `moved` runs.
   */
  | {
      readonly kind: "moveRoot"
      readonly move: Extract<HostRequest, { kind: "move-root" }>
      readonly moved: readonly Effect[]
    }
  | {
      readonly kind: "mark"
      readonly root: EntryId
      readonly title: string | null
    }
  | { readonly kind: "retitle"; readonly root: EntryId }
  | {
      readonly kind: "createCard"
      readonly card: CardRecord
      readonly text: string
      readonly how: MoveHow
    }
  /** A move (ADR-0059): a take into the inventory, a put, an unqueue, a discard. */
  | {
      readonly kind: "moveCard"
      readonly move: Move
      readonly how: MoveHow
      /** Who queued the card, for an unqueue: a refusal names them. */
      readonly queuedBy: WriterId | null
      /** Whether the card animates to where it lands (`ports.fly`). */
      readonly fly: boolean
    }
  /**
   * A card queued, and its queue's hold changed with it (ADR-0113). A move
   * with no `from` makes the card there, carrying `command`.
   */
  | {
      readonly kind: "queueCard"
      readonly move: Move
      readonly hold: QueueHoldChange
      readonly command: CardCommand | null
      readonly how: MoveHow
    }
  /** A reorder (ADR-0048 step 7), drawn at once, as a move is. */
  | {
      readonly kind: "reorderCard"
      readonly reorder: Reorder
      readonly how: MoveHow
    }
  /** Swap two slots of your inventory, as one step of this tab's swaps. */
  | { readonly kind: "swapSlots"; readonly a: number; readonly b: number }
  /**
   * Moves sent as one, which the host accepts or refuses whole (ADR-0066):
   * a keep into your inventory, or a card put in your composer and the
   * message it displaces. `afterKeep` decides from its answer whether `close`
   * runs.
   */
  | {
      readonly kind: "keep"
      /** At least one: a keep with no card left closes at once (`planKeep`). */
      readonly moves: readonly [SlotMove, ...SlotMove[]]
      readonly actedAt: ActedAt
      readonly close: readonly Effect[]
    }
  /** Undo or redo your newest move in `root`, on the host (ADR-0066). */
  | {
      readonly kind: "undoMoves"
      readonly root: RootId
      readonly direction: MoveDirection
    }
  /** Undo or redo this tab's newest swap in your inventory. */
  | { readonly kind: "undoSwap"; readonly direction: MoveDirection }
  /** Keep a refusal made before anything was sent. */
  | { readonly kind: "refuse"; readonly refusal: CardNotice }
  /** Open the inventory; `brief`: only for the flight of a take into it, if it was closed. */
  | { readonly kind: "showInventory"; readonly brief: boolean }
  | { readonly kind: "select"; readonly slot: number }
  /** An offer action, which the session tracks (`acting`). */
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly action: OfferAction
      readonly to: string | null
    }
  /** Once this tab holds entry `entry`, show it (`openAt`). */
  | { readonly kind: "openWhenHeld"; readonly entry: EntryId }
  /** Scroll to entry `entry` once it is drawn (`useReveal`). */
  | { readonly kind: "reveal"; readonly entry: EntryId }
  /** Scroll a queued card into view in its column's dock (ADR-0113). */
  | { readonly kind: "revealCard"; readonly card: CardId }
  /** Open ask `ask`'s fold, so what is revealed in it is drawn (ADR-0106). */
  | { readonly kind: "openFold"; readonly ask: EntryId }
  /** The column keyed `key` takes focus when it mounts (`claimFocus`). */
  | { readonly kind: "armFocus"; readonly key: string }
  | { readonly kind: "storeIdentity"; readonly identity: Identity }
  | { readonly kind: "forgetIdentity" }
  | { readonly kind: "reload" }

/** A change to the sidebar, by root id: your document's key (ADR-0122). */
export type ListAct =
  /** At its end, unless it is in the sidebar already. */
  | { readonly kind: "ensure"; readonly root: RootId }
  | {
      readonly kind: "place"
      readonly root: RootId
      readonly before: RootId | null
    }
  | { readonly kind: "close"; readonly root: RootId }

export interface IntentState {
  readonly layout: Layout
  readonly index: TreeIndex
  /** Every ask (`indexAsks`): a pick into one's work opens its fold. */
  readonly asks: AskIndex
  readonly cards: CardFacts
  /**
   * Each root's root entry, by its id, from the directory (ADR-0063): an
   * undo names its tab's root, and a fresh column reopens in its root's tab.
   */
  readonly rootEntries: ReadonlyMap<RootId, EntryId>
  /** Each root's id, by its root entry: the sidebar's key. */
  readonly rootIds: ReadonlyMap<EntryId, RootId>
  /** What the sidebar shows now (`shownWidth`). */
  readonly listWidth: ListWidth
  /** The page over the workspace, if any (ADR-0098). */
  readonly page: PageName | null
}

/** What the card intents decide from (ADR-0048 step 4). */
export interface CardFacts {
  /** Every card as drawn. */
  readonly cards: readonly CardRecord[]
  readonly lanes: readonly LaneView[]
  /** Every lane's record: a queue takes its lane's root (`queueRoot`). */
  readonly laneRecords: ReadonlyMap<LaneName, LaneRecord>
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

/** An effect on the layout, and one on the sidebar: the constructors the planners share. */
export const layout = (action: LayoutAction): Effect => ({
  kind: "layout",
  action,
})
export const list = (act: ListAct): Effect => ({ kind: "list", act })

/** Show `here`; a root shown is opened in the sidebar, at its end if it was not there. */
export function show(
  here: Here,
  state: Pick<IntentState, "rootIds">,
): readonly Effect[] {
  const shown = layout({ kind: "show", here })
  if (here.kind !== "root") return [shown]
  const id = state.rootIds.get(here.root)
  return id === undefined
    ? [shown]
    : [shown, list({ kind: "ensure", root: id })]
}
export const showRoot = (
  root: EntryId,
  state: Pick<IntentState, "rootIds">,
): readonly Effect[] => show({ kind: "root", root }, state)

/**
 * Show entry `id` (`planOpen`): in view in the column that shows it, or in a
 * new column beside the one sharing most of its path. An entry of an ask's work opens the ask's
 * fold first, whatever the column's density, so it is drawn to be revealed
 * (ADR-0106): forks, branch starts and people's messages are never in one.
 */
export function planOpenAt(
  id: EntryId,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  const plan = planOpen(state.layout, state.index, id)
  if (plan === null) return []
  const ask = state.asks.askOf.get(id)
  const fold: readonly Effect[] =
    ask === undefined ? [] : [{ kind: "openFold", ask }]
  switch (plan.kind) {
    case "scroll":
      return [
        ...fold,
        { kind: "reveal", entry: id },
        ...showRoot(plan.root, state),
      ]
    case "open":
      return [
        ...fold,
        { kind: "reveal", entry: id },
        ...showRoot(plan.root, state),
        layout({
          kind: "columns",
          root: plan.root,
          action: { kind: "open", key: fresh, after: plan.after, anchor: id },
        }),
      ]
  }
}
