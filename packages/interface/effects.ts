// interface/effects — what an intent does, as values (`Effect`), and what
// planning one reads (`IntentState`): the vocabulary `planIntent`
// (`intent.ts`), the card intents (`card-intents.ts`) and the reveal
// (`reveal.ts`) plan in, and `perform` carries out through a client's ports.
// Showing a root and an entry are here because all three plan them. Pure.

import type {
  Address,
  AskIndex,
  CardCommand,
  CardId,
  CardRecord,
  EntryId,
  LaneRecord,
  LaneView,
  MoveDirection,
  OfferAction,
  PlaceKey,
  QueuedKey,
  QueueHoldChange,
  QueueMove,
  ReferenceCardId,
  Reorder,
  Sha256,
  TargetOf,
  TaskId,
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
import type { Identity } from "./identity.ts"
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
import type { Tasks } from "./tasks.ts"

export type Effect =
  | { readonly kind: "layout"; readonly action: LayoutAction }
  /** Show the sidebar at `width`, and keep that choice for this tab. */
  | { readonly kind: "listWidth"; readonly width: ListWidth }
  /** Show a page over the stage, or, with null, the stage (ADR-0098). */
  | { readonly kind: "page"; readonly to: PageName | null }
  /** Open, type in, clear or close the search of the root you are on (ADR-0101). */
  | { readonly kind: "search"; readonly act: SearchAct }
  /** Mark what `lane` raised "not needed", in your attention document. */
  | {
      readonly kind: "notNeeded"
      readonly lane: ThreadId
      readonly raised: Raised
    }
  /** Ask the host for something that moves no card (`HostRequest`). */
  | { readonly kind: "request"; readonly intent: HostRequest }
  /** Change the sidebar, in your own document (`openThreads`, ADR-0122). */
  | { readonly kind: "list"; readonly act: ListAct }
  /**
   * Make a card a thread (ADR-0111); `afterSpinOff` decides from its
   * answer what follows: for the sidebar, the new task placed and shown.
   */
  | {
      readonly kind: "spinOff"
      readonly request: Extract<HostRequest, { kind: "spin-off" }>
      readonly sidebar: { readonly before: TaskId | null } | null
    }
  /**
   * Move a task on the board; `afterTaskMove` decides from its answer
   * whether `moved` runs.
   */
  | {
      readonly kind: "moveTask"
      readonly move: Extract<HostRequest, { kind: "move-task" }>
      readonly moved: readonly Effect[]
    }
  | {
      readonly kind: "createCard"
      readonly card: TextCard
      readonly text: string
      readonly how: MoveHow
    }
  /**
   * Take a reference from the past (ADR-0126): its quote kept as a blob,
   * then the reference made where `to` is.
   */
  | {
      readonly kind: "takeReference"
      readonly card: ReferenceCardId
      readonly address: Address
      readonly markdown: string
      readonly to: TargetOf<"reference">
      readonly how: MoveHow
    }
  /**
   * A reference to a comment queued on its thread (ADR-0126): its quote,
   * the comment's text as it is now under a link to `entry`
   * (`commentMarkdown`), kept as a blob, then the reference made there.
   */
  | {
      readonly kind: "queueComment"
      readonly card: ReferenceCardId
      readonly comment: TextCardId
      readonly entry: Address
      readonly to: QueuedKey
      readonly how: MoveHow
    }
  /** A reference made with a quote already kept: a put of one in your hand. */
  | {
      readonly kind: "makeReference"
      readonly card: ReferenceCardId
      readonly address: Address
      readonly quote: Sha256
      readonly to: TargetOf<"reference">
      readonly how: MoveHow
    }
  /** A reference edited as text: its quote written into the new card first. */
  | {
      readonly kind: "editAsText"
      readonly reference: ReferenceCardId
      readonly from: PlaceKey
      readonly card: TextCardId
      readonly text: string
      readonly here: TaskId | null
    }
  /** Markdown on the system clipboard. */
  | { readonly kind: "copyText"; readonly text: string }
  /** Text at the caret of the text box that has focus. */
  | { readonly kind: "insertText"; readonly text: string }
  /** A move (ADR-0059): a take into the inventory, a put, an unqueue, a discard. */
  | {
      readonly kind: "moveCard"
      readonly move: TypedMove
      readonly how: MoveHow
      /** Who queued the card, for an unqueue: a refusal names them. */
      readonly queuedBy: WriterId | null
      /** Whether the card animates to where it lands (`ports.fly`). */
      readonly fly: boolean
      /** The task you are on, for a discard: its history, from your inventory (ADR-0116). */
      readonly here: TaskId | null
    }
  /**
   * A card queued, and its queue's hold changed with it (ADR-0113). A move
   * with no `from` makes the card there, carrying `command`.
   */
  | {
      readonly kind: "queueCard"
      readonly move: QueueMove
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
      /** As `moveCard`'s. */
      readonly here: TaskId | null
    }
  /**
   * Undo or redo your newest move in `task`, or outside any task for none,
   * on the host (ADR-0066, ADR-0126).
   */
  | {
      readonly kind: "undoMoves"
      readonly task: TaskId | null
      readonly direction: MoveDirection
    }
  /** Undo or redo this tab's newest swap in your inventory. */
  | { readonly kind: "undoSwap"; readonly direction: MoveDirection }
  /** Keep a refusal made before anything was sent. */
  | { readonly kind: "refuse"; readonly refusal: CardNotice }
  /** Open the inventory; `brief`: only for the flight of a take into it, if it was closed. */
  | { readonly kind: "showInventory"; readonly brief: boolean }
  | { readonly kind: "select"; readonly slot: number }
  /** Open the selected slot's card in your inventory: a thread's read-only preview (ADR-0124). */
  | { readonly kind: "openSelected" }
  /** An offer action, which the session tracks (`acting`). */
  | {
      readonly kind: "offer"
      readonly lane: ThreadId
      readonly action: OfferAction
      readonly to: string | null
    }
  /** Once this tab holds entry `entry`, show it (`openAt`). */
  | { readonly kind: "openWhenHeld"; readonly entry: EntryId }
  /** Scroll to entry `entry` once it is drawn (`useReveal`). */
  | { readonly kind: "reveal"; readonly entry: EntryId }
  /** Outline entry `entry` briefly, once drawn: where leaving a search landed. */
  | { readonly kind: "landed"; readonly entry: EntryId }
  /** Scroll a queued card into view in its column's dock (ADR-0113). */
  | { readonly kind: "revealCard"; readonly card: CardId }
  /** Open ask `ask`'s fold, so what is revealed in it is drawn (ADR-0106). */
  | { readonly kind: "openFold"; readonly ask: EntryId }
  /** The column keyed `key` takes focus when it mounts (`claimFocus`). */
  | { readonly kind: "armFocus"; readonly key: string }
  | { readonly kind: "storeIdentity"; readonly identity: Identity }
  | { readonly kind: "forgetIdentity" }
  | { readonly kind: "reload" }

/** A change to the sidebar, by task: your document's key (ADR-0122, ADR-0116). */
export type ListAct =
  /** At its end, unless it is in the sidebar already. */
  | { readonly kind: "ensure"; readonly task: TaskId }
  | {
      readonly kind: "place"
      readonly task: TaskId
      readonly before: TaskId | null
    }
  | { readonly kind: "close"; readonly task: TaskId }

export interface IntentState {
  readonly layout: Layout
  readonly index: TreeIndex
  /** Every ask (`indexAsks`): a pick into one's work opens its fold. */
  readonly asks: AskIndex
  readonly cards: CardFacts
  /**
   * Every task (ADR-0116): an entry opens in the task its thread is in, and
   * a task's columns are its canvas's.
   */
  readonly tasks: Tasks
  /** What the sidebar shows now (`shownWidth`). */
  readonly listWidth: ListWidth
  /** The page over the stage, if any (ADR-0098). */
  readonly page: PageName | null
  /** A search applies on the root you are on (`searchOn`, ADR-0101). */
  readonly searching: boolean
}

/** What the card intents decide from (ADR-0048 step 4). */
export interface CardFacts {
  /** Every card as drawn. */
  readonly cards: readonly CardRecord[]
  readonly lanes: readonly LaneView[]
  /** Every lane's record: a queue takes its lane's root (`queueRoot`). */
  readonly laneRecords: ReadonlyMap<ThreadId, LaneRecord>
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

/** Show `here`; a task shown is opened in the sidebar, at its end if it was not there. */
export function show(here: Here): readonly Effect[] {
  const shown = layout({ kind: "show", here })
  return here.kind === "task"
    ? [shown, list({ kind: "ensure", task: here.task })]
    : [shown]
}
export const showTask = (task: TaskId): readonly Effect[] =>
  show({ kind: "task", task })

/**
 * A change to your view of `task` (`ViewChange`), as an effect: a view made
 * by it starts from the task's canvas (`defaultView`).
 */
export const changeViewOf = (
  state: Pick<IntentState, "tasks">,
  task: TaskId,
  change: ViewChange,
): Effect =>
  layout({
    kind: "view",
    task,
    first: state.tasks.index.canvases.get(task)?.[0]?.id ?? null,
    change,
  })

/**
 * Show entry `id` (`planOpen`): in view in the column that shows it, or in
 * its thread's column, unfolded. An entry of an ask's work opens the ask's
 * fold first, whatever the column's density, so it is drawn to be revealed
 * (ADR-0106): forks, branch starts and people's messages are never in one.
 */
export function planOpenAt(id: EntryId, state: IntentState): readonly Effect[] {
  const plan = planOpen(
    state.layout,
    state.index,
    id,
    state.tasks.index,
    state.cards.lanes,
    heldByOthers(state.cards.cards, state.cards.me),
  )
  if (plan === null) return []
  const ask = state.asks.askOf.get(id)
  const fold: readonly Effect[] =
    ask === undefined ? [] : [{ kind: "openFold", ask }]
  switch (plan.kind) {
    case "scroll":
      return [...fold, { kind: "reveal", entry: id }, ...showTask(plan.task)]
    case "unfold":
      return [
        ...fold,
        { kind: "reveal", entry: id },
        ...showTask(plan.task),
        changeViewOf(state, plan.task, {
          kind: "fold",
          card: plan.card,
          unfolded: true,
        }),
      ]
  }
}
