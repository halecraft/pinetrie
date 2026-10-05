// client/intent — what a reader asks of the page, as a value, and what it
// does. PURE.
//
// A click reaches `App` as an `Intent`. `planIntent` turns it into `Effect`s
// and `perform` (`perform.ts`) carries them out. A column's acts are nested
// under its position, as `LayoutAction` nests `ColumnAction` under a root, and
// a message's acts (`MessageAct`) are among them.

import {
  type AskIndex,
  type CardCommand,
  type CardId,
  type CardRecord,
  draftingOf,
  type EntryId,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type Move,
  type MoveDirection,
  moveOf,
  type OfferAction,
  type Position,
  type Reorder,
  type RootId,
  type TraceRecord,
  type TreeIndex,
  type WorkflowEdit,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  type ActedAt,
  type CardRefusal,
  type HostRequest,
  IN_COLUMN,
  type MoveHow,
  type SlotMove,
  type Slots,
} from "@pinetrie/session"
import type { Density } from "./ask-words.ts"
import type { Raised } from "./attention.ts"
import {
  afterUndo,
  cardOf,
  moveCard,
  planKeep,
  planOpenTrace,
  planPin,
  planPut,
  planRemove,
  planTakeCopyIntoInventory,
  planTakeIntoInventory,
  planUndoMove,
  planUnpin,
  queueMove,
  reorderOf,
} from "./card-intents.ts"
import type { Pending, Prefill, ReaderAction } from "./columns.ts"
import type { Identity, NameStep } from "./identity.ts"
import {
  type Here,
  type Layout,
  type LayoutAction,
  planOpen,
} from "./layout.ts"
import type { MessageAct } from "./message-tools.ts"
import type { ComposerPlaces, PutTarget } from "./put-target.ts"

/** What a reader asks of one column. A message's acts are among them. */
export type ColumnAct =
  | MessageAct
  /** Close the column, discarding `discard` first: a fresh column's cards. */
  | { readonly kind: "close"; readonly discard: readonly CardId[] }
  /**
   * Close a fresh column, keeping `cards` (its cards with text) in your
   * inventory first; it closes once every one is accepted.
   */
  | { readonly kind: "keep"; readonly cards: readonly CardId[] }
  /** Take a card in this column into your inventory (ADR-0048). */
  | { readonly kind: "takeIntoInventory"; readonly card: CardId }
  /** Move the column to index `to`. */
  | { readonly kind: "move"; readonly to: number }
  /** Read the column at `density` (ADR-0056). */
  | { readonly kind: "density"; readonly density: Density }
  /** Open or close the thread's details under the header (ADR-0073). */
  | { readonly kind: "details"; readonly open: boolean }
  /** A fresh column's first send, as send `sendId`. */
  | { readonly kind: "sent"; readonly key: string; readonly sendId: string }
  /** Keep `lane` as the id this column's next send creates a lane under (ADR-0057). */
  | { readonly kind: "reserve"; readonly key: string; readonly lane: LaneName }
  /** After a conflict: a fresh column at `at`, which sends `pending` there. */
  | {
      readonly kind: "branchInstead"
      readonly at: EntryId
      readonly pending: Pending
    }
  /** Queue a card on the column's lane, from where it was (ADR-0048). */
  | {
      readonly kind: "queue"
      readonly card: CardId
      readonly lane: LaneName
      readonly at: Position
    }
  /** Pin a card below the line at the top of its thread's column (ADR-0048). */
  | { readonly kind: "pin"; readonly card: CardId }
  /** Unpin a card: below the line at the thread's end again. */
  | { readonly kind: "unpin"; readonly card: CardId }
  /** Take a queued card back below the line; `by` queued it. */
  | {
      readonly kind: "unqueue"
      readonly card: CardId
      readonly lane: LaneName
      readonly by: WriterId
    }
  /**
   * Move a queued or pinned card one place up (-1) or down (1) among
   * `among`, its list as drawn, by id (ADR-0048 step 7).
   */
  | {
      readonly kind: "reorder"
      readonly card: CardId
      readonly among: readonly CardId[]
      readonly step: -1 | 1
    }
  /** Hold the thread's queue, or release it (ADR-0048 step 7). */
  | {
      readonly kind: "holdQueue"
      readonly lane: LaneName
      readonly held: boolean
    }
  /** Take every message card queued on the thread back below the line. */
  | { readonly kind: "unqueueAll"; readonly lane: LaneName }
  /** Set a card's command, or clear it with null (ADR-0055). */
  | {
      readonly kind: "setCommand"
      readonly card: CardId
      readonly command: CardCommand | null
    }
  /**
   * A command button: catching up, continuing on the line, or splitting the
   * offer (ADR-0060, ADR-0061, ADR-0080): a new card, `create`, made at the
   * thread's end with `command` and no text, and queued on `lane` at once,
   * so the host carries the command out when the lane is free. Your card in
   * the composer is left as it is.
   */
  | {
      readonly kind: "queueCommand"
      readonly create: CardRecord
      readonly command: CardCommand
      readonly lane: LaneName
      readonly at: Position
    }
  /** Act on the lane's offer in your repo; an integration names its destination (ADR-0060). */
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly action: OfferAction
      readonly to: string | null
    }

export type Intent =
  | {
      readonly kind: "column"
      readonly position: number
      /** The column's key: where a refusal of what it does is said. */
      readonly key: string
      readonly act: ColumnAct
    }
  /** Show a root, opening it in your list, or a new tab, or nothing. */
  | { readonly kind: "show"; readonly here: Here }
  | {
      readonly kind: "newTab"
      readonly asksAgent: boolean
      readonly prefill?: Prefill
      /** The workflow state its root lands in: the board column it came from (ADR-0085). */
      readonly state?: WorkflowStateId
    }
  /** Close a root of your list, or a new tab, for you: nothing shared is written. */
  | { readonly kind: "close"; readonly here: Here }
  /** Move a root of your list before `before`, or to its end (ADR-0085). */
  | {
      readonly kind: "moveInList"
      readonly root: EntryId
      readonly before: EntryId | null
    }
  /**
   * Move a root on the board (ADR-0085). Into the closed state it is archived,
   * and closed for you once the host accepts; out of it, restored.
   */
  | {
      readonly kind: "moveRoot"
      readonly root: RootId
      readonly from: WorkflowStateId
      readonly to: WorkflowStateId
      readonly before: RootId | null
      /** `to` is the closed state. */
      readonly closes: boolean
    }
  /** Change the board's workflow states (ADR-0085). */
  | { readonly kind: "editWorkflow"; readonly edit: WorkflowEdit }
  /** Open or close the board. */
  | { readonly kind: "board"; readonly open: boolean }
  | {
      readonly kind: "rename"
      readonly root: EntryId
      readonly title: string | null
    }
  /** Ask a model for the root's title (ADR-0074). */
  | { readonly kind: "retitle"; readonly root: EntryId }
  /** What `lane` raised for you is not needed (ADR-0077): it clears on every device. */
  | {
      readonly kind: "notNeeded"
      readonly lane: LaneName
      readonly raised: Raised
    }
  /** Show entry `entry`, wherever it is (`planOpen`). */
  | { readonly kind: "openAt"; readonly entry: EntryId }
  /**
   * Show entry `entry` of the root whose root entry is `root`, which this
   * tab may not hold (ADR-0063): what the header and the inbox open.
   */
  | { readonly kind: "openIn"; readonly entry: EntryId; readonly root: EntryId }
  | { readonly kind: "signOut" }
  /** Take `card` into your inventory: by key, wherever it is. */
  | { readonly kind: "takeIntoInventory"; readonly card: CardId }
  /** Put `card` at `target`: a column's end, or a slot (a swap, or a take into the inventory there). */
  | { readonly kind: "put"; readonly card: CardId; readonly target: PutTarget }
  /** Remove a card from your inventory: final, as a discard is. */
  | { readonly kind: "remove"; readonly card: CardId }
  /** Select an inventory slot. */
  | { readonly kind: "selectSlot"; readonly slot: number }
  /**
   * Undo or redo your newest move in the root you are on, or, with the
   * inventory panel focused, your newest swap (ADR-0066).
   */
  | {
      readonly kind: "undoMove"
      readonly direction: MoveDirection
      readonly inPanel: boolean
    }
  /** The host's answer to an undo of moves: bring what it moved into view. */
  | { readonly kind: "undoAnswered"; readonly outcome: Outcome }
  /** Follow a trace to where its card is now, or the message it became. */
  | { readonly kind: "openTrace"; readonly trace: TraceRecord }

export type Effect =
  | { readonly kind: "layout"; readonly action: LayoutAction }
  /** Mark what `lane` raised "not needed", in your attention document. */
  | {
      readonly kind: "notNeeded"
      readonly lane: LaneName
      readonly raised: Raised
    }
  /** Ask the host for something that moves no card (`HostRequest`). */
  | { readonly kind: "request"; readonly intent: HostRequest }
  /** Change your list, in your own document (`openList`, ADR-0085). */
  | { readonly kind: "list"; readonly act: ListAct }
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
  /** A move (ADR-0059): a take into the inventory, a put, a queue, an unqueue, a discard. */
  | {
      readonly kind: "moveCard"
      readonly move: Move
      readonly how: MoveHow
      /** Who queued the card, for an unqueue: a refusal names them. */
      readonly queuedBy: WriterId | null
      /** Whether the card animates to where it lands (`ports.fly`). */
      readonly fly: boolean
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
   * Moves into your inventory, sent as one move the host accepts or refuses
   * whole (ADR-0066); `afterKeep` decides from its answer whether `close`
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
  | { readonly kind: "refuse"; readonly refusal: CardRefusal }
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
  /** Open ask `ask`'s fold, so what is revealed in it is drawn (ADR-0056). */
  | { readonly kind: "openFold"; readonly ask: EntryId }
  /** The column keyed `key` takes focus when it mounts (`claimFocus`). */
  | { readonly kind: "armFocus"; readonly key: string }
  | { readonly kind: "storeIdentity"; readonly identity: Identity }
  | { readonly kind: "forgetIdentity" }
  | { readonly kind: "reload" }

/** A column action on one root's columns, as `LayoutAction` carries it. */
type RootColumnAction = Extract<LayoutAction, { kind: "columns" }>["action"]

/** A change to your list, by root id: your document's key (ADR-0085). */
export type ListAct =
  /** At its end, unless it is in your list already. */
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
  /** Each root's id, by its root entry: your list's key. */
  readonly rootIds: ReadonlyMap<EntryId, RootId>
}

/** What the card intents decide from (ADR-0048 step 4). */
export interface CardFacts {
  /** Every card as drawn. */
  readonly cards: readonly CardRecord[]
  readonly lanes: readonly LaneView[]
  /** Every lane's record: a queue takes its lane's root (`queueRoot`). */
  readonly laneRecords: ReadonlyMap<LaneName, LaneRecord>
  readonly me: WriterId
  /** Your inventory's slots as drawn (`settleSlots`). */
  readonly slots: Slots
  /** The selected slot. */
  readonly selected: number
  /** Each column's composer place, by key. */
  readonly composers: ComposerPlaces
}

const layout = (action: LayoutAction): Effect => ({ kind: "layout", action })
const list = (act: ListAct): Effect => ({ kind: "list", act })

/** Show `here`; a root shown is opened in your list, at its end if it was not there. */
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
const showRoot = (
  root: EntryId,
  state: Pick<IntentState, "rootIds">,
): readonly Effect[] => show({ kind: "root", root }, state)

/**
 * The effects of `intent`. `fresh` is a new column key from the shell, as
 * `columnsReducer` takes keys in its actions: a column opened with it takes
 * focus, except one `openAt` opens, which only shows an entry. `newRoot` is
 * a new root's id from the shell, which a new tab keeps (ADR-0066).
 */
export function planIntent(
  intent: Intent,
  state: IntentState,
  fresh: string,
  newRoot: RootId,
): readonly Effect[] {
  switch (intent.kind) {
    case "column":
      return planColumn(
        intent.position,
        intent.key,
        intent.act,
        state,
        fresh,
        newRoot,
      )
    case "show":
      return show(intent.here, state)
    case "newTab":
      return [
        { kind: "armFocus", key: fresh },
        layout({
          kind: "newTab",
          key: fresh,
          root: newRoot,
          asksAgent: intent.asksAgent,
          ...(intent.prefill === undefined ? {} : { prefill: intent.prefill }),
          ...(intent.state === undefined ? {} : { state: intent.state }),
        }),
      ]
    case "close":
      switch (intent.here.kind) {
        case "root":
          return closeRoot(intent.here.root, state)
        case "new":
          return [layout({ kind: "closeNewTab", key: intent.here.key })]
        case "nothing":
          return []
      }
      return []
    case "moveInList": {
      const root = state.rootIds.get(intent.root)
      if (root === undefined) return []
      const before =
        intent.before === null
          ? null
          : (state.rootIds.get(intent.before) ?? null)
      return [list({ kind: "place", root, before })]
    }
    case "moveRoot": {
      // Into the closed state: it leaves your list once the host accepts.
      const entry = state.rootEntries.get(intent.root)
      return [
        {
          kind: "moveRoot",
          move: {
            kind: "move-root",
            root: intent.root,
            from: intent.from,
            to: intent.to,
            before: intent.before,
          },
          moved: !intent.closes
            ? []
            : entry === undefined
              ? [list({ kind: "close", root: intent.root })]
              : closeRoot(entry, state),
        },
      ]
    }
    case "editWorkflow":
      return [
        { kind: "request", intent: { kind: "workflow", edit: intent.edit } },
      ]
    case "board":
      return [layout({ kind: "board", open: intent.open })]
    case "rename":
      return [{ kind: "mark", root: intent.root, title: intent.title }]
    case "retitle":
      return [{ kind: "retitle", root: intent.root }]
    case "notNeeded":
      return [{ kind: "notNeeded", lane: intent.lane, raised: intent.raised }]
    case "openAt":
      return planOpenAt(intent.entry, state, fresh)
    case "openIn":
      return planOpenIn(intent.entry, intent.root, state, fresh)
    case "signOut":
      return [{ kind: "forgetIdentity" }, { kind: "reload" }]
    case "takeIntoInventory":
      return planTakeIntoInventory(intent.card, state)
    case "put":
      return planPut(intent.card, intent.target, state)
    case "remove":
      return planRemove(intent.card, state)
    case "selectSlot":
      return [{ kind: "select", slot: intent.slot }]
    case "undoMove":
      return planUndoMove(intent.direction, intent.inPanel, state)
    case "undoAnswered":
      return afterUndo(intent.outcome, state, fresh)
    case "openTrace":
      return planOpenTrace(intent.trace, state, fresh)
  }
}

/**
 * Show entry `id` (`planOpen`): in view in the column that shows it, or in a
 * new column beside the one sharing most of its path. An entry of an ask's work opens the ask's
 * fold first, whatever the column's density, so it is drawn to be revealed
 * (ADR-0056): forks, branch starts and people's messages are never in one.
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

/**
 * The column action a reader's setting is, for column `key`; null for any
 * other act. `planColumn` applies it.
 */
export function readerAction(act: ColumnAct, key: string): ReaderAction | null {
  switch (act.kind) {
    case "density":
      return { kind: "density", key, density: act.density }
    case "details":
      return { kind: "details", key, open: act.open }
    default:
      return null
  }
}

/**
 * A column's act. One that changes the columns is the column action of the
 * root whose tab you are on; a new tab's one column can only send, reserve
 * its lane, take a reader's setting, and close, which closes the tab.
 */
function planColumn(
  position: number,
  key: string,
  act: ColumnAct,
  state: IntentState,
  fresh: string,
  newRoot: RootId,
): readonly Effect[] {
  const active = state.layout.active
  const onRoot = (action: RootColumnAction): readonly Effect[] =>
    active?.kind === "root"
      ? [layout({ kind: "columns", root: active.root, action })]
      : []
  /** An action on the column itself, which may be a new tab's one column. */
  const onColumn = (
    action: Extract<LayoutAction, { kind: "newTabColumn" }>["action"],
  ): readonly Effect[] =>
    active?.kind === "new"
      ? [layout({ kind: "newTabColumn", key: active.key, action })]
      : onRoot(action)
  /** Closing this column: a new tab's closes the tab. */
  const closing = (): readonly Effect[] =>
    active?.kind === "new"
      ? [layout({ kind: "closeNewTab", key: active.key })]
      : onRoot({ kind: "close", index: position })
  switch (act.kind) {
    case "openAt":
      return planOpenAt(act.entry, state, fresh)
    case "newTab":
      return planIntent(
        { kind: "newTab", asksAgent: act.asksAgent, prefill: act.prefill },
        state,
        fresh,
        newRoot,
      )
    case "branch":
      return opened(
        fresh,
        onRoot({
          kind: "openFresh",
          key: fresh,
          at: act.branch.at,
          after: position,
          ...(act.branch.prefill === undefined
            ? {}
            : { prefill: act.branch.prefill }),
        }),
      )
    case "branchInstead":
      return opened(
        fresh,
        onRoot({
          kind: "openFresh",
          key: fresh,
          at: act.at,
          after: position,
          pending: act.pending,
        }),
      )
    case "close": {
      const discard = act.discard.flatMap(id => {
        const now = cardOf(state.cards, id)
        return now === undefined
          ? []
          : [moveCard(moveOf(now, null), IN_COLUMN(key), false)]
      })
      return [...discard, ...closing()]
    }
    case "keep":
      return planKeep(act.cards, key, closing(), state)
    case "takeIntoInventory":
      return planTakeIntoInventory(act.card, state)
    case "takeCopyIntoInventory":
      return planTakeCopyIntoInventory(act.card, act.text, state)
    case "move":
      return onRoot({ kind: "move", from: position, to: act.to })
    case "density":
    case "details": {
      const action = readerAction(act, key)
      return action === null ? [] : onColumn(action)
    }
    case "sent":
      return onColumn({ kind: "sent", key: act.key, sendId: act.sendId })
    case "reserve":
      return onColumn({ kind: "reserve", key: act.key, lane: act.lane })
    case "queue": {
      const now = cardOf(state.cards, act.card)
      const move = now === undefined ? null : queueMove(now, act, state.cards)
      return move === null ? [] : [moveCard(move, IN_COLUMN(key), false)]
    }
    case "unqueue": {
      // If the host popped the card first, the refusal says it was sent.
      const now = cardOf(state.cards, act.card)
      if (now?.place.kind !== "queued") return []
      const move = moveOf(now, draftingOf(now.place))
      return [moveCard(move, IN_COLUMN(key), false, act.by)]
    }
    case "reorder": {
      const now = cardOf(state.cards, act.card)
      const among = act.among.flatMap(id => {
        const c = cardOf(state.cards, id)
        return c === undefined ? [] : [c]
      })
      const reorder = now === undefined ? null : reorderOf(now, among, act.step)
      return reorder === null
        ? []
        : [{ kind: "reorderCard", reorder, how: IN_COLUMN(key) }]
    }
    case "holdQueue":
      return [
        {
          kind: "request",
          intent: { kind: "queue-hold", lane: act.lane, held: act.held },
        },
      ]
    case "unqueueAll":
      return [
        { kind: "request", intent: { kind: "unqueue-all", lane: act.lane } },
      ]
    case "pin":
      return planPin(act.card, key, state)
    case "unpin":
      return planUnpin(act.card, key, state)
    case "setCommand":
      return [
        {
          kind: "request",
          intent: { kind: "set-command", card: act.card, command: act.command },
        },
      ]
    case "queueCommand": {
      const queued = queueMove(act.create, act, state.cards)
      // Made, then queued: the host sets the command before the queue's
      // move, so the drain that move starts pops it with its command.
      return [
        {
          kind: "createCard",
          card: {
            ...act.create,
            carries: { kind: "message", command: act.command },
          },
          text: "",
          how: IN_COLUMN(key),
        },
        ...(queued === null ? [] : [moveCard(queued, IN_COLUMN(key), false)]),
      ]
    }
    case "offer":
      return [{ kind: "offer", lane: act.lane, action: act.action, to: act.to }]
  }
}

/**
 * Show `entry`, in the root whose root entry is `root` (ADR-0063). One this
 * tab holds opens as `planOpenAt`. Else the root is shown, which holds it,
 * archived or not, and the entry is shown once it has arrived.
 */
function planOpenIn(
  entry: EntryId,
  root: EntryId,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  if (state.index.entries[entry] !== undefined)
    return planOpenAt(entry, state, fresh)
  return [...showRoot(root, state), { kind: "openWhenHeld", entry }]
}

/** A column opened with `key` takes focus; nothing opened, nothing armed. */
const opened = (key: string, effects: readonly Effect[]): readonly Effect[] =>
  effects.length === 0 ? [] : [{ kind: "armFocus", key }, ...effects]

/** `root` leaves your list, and if you are on it, its neighbour is shown. */
function closeRoot(
  root: EntryId,
  state: Pick<IntentState, "rootIds">,
): readonly Effect[] {
  const id = state.rootIds.get(root)
  return [
    ...(id === undefined ? [] : [list({ kind: "close", root: id })]),
    layout({ kind: "closeRoot", root }),
  ]
}

/**
 * After a move on the board is answered (ADR-0085): `moved` runs only once
 * the host accepts. A root you move into the closed state leaves your list,
 * the one you are on too; only a root someone else archives stays while you
 * are on it (`resolveLayout`). A refusal changes nothing.
 */
export const afterRootMove = (
  outcome: Outcome,
  moved: readonly Effect[],
): readonly Effect[] => (outcome.kind === "moved-root" ? moved : [])

/** `reconcileName`'s step, as effects. */
export function nameEffects(step: NameStep | null): readonly Effect[] {
  if (step === null) return []
  switch (step.kind) {
    case "send":
      return [{ kind: "request", intent: { kind: "name", name: step.name } }]
    case "store":
      return [{ kind: "storeIdentity", identity: step.identity }]
  }
}

/**
 * Whether the column keyed `key` takes focus as it mounts, and what stays
 * armed: the column you just opened does, once. A column restored, or shown
 * again with its tab, leaves focus where it is.
 */
export function claimFocus(
  armed: string | null,
  key: string,
): { readonly focus: boolean; readonly armed: string | null } {
  return armed === key ? { focus: true, armed: null } : { focus: false, armed }
}
