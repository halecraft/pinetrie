// interface/intent — what a reader asks of the page, as a value, and what it
// does. PURE.
//
// A click reaches `App` as an `Intent`. `planIntent` turns it into `Effect`s
// and `perform` (`perform.ts`) carries them out. A column's acts are nested
// under its position, as `LayoutAction` nests `ColumnAction` under a root, and
// a message's acts (`MessageAct`) are among them.

import {
  type CardCommand,
  type CardId,
  type EntryId,
  type LaneName,
  type MoveDirection,
  moveOf,
  noteOf,
  type OfferAction,
  type Position,
  type QueueHoldChange,
  type RootId,
  type TraceRecord,
  type WorkflowEdit,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { AT_INVENTORY, IN_COLUMN } from "@pinetrie/session"
import type { Density } from "./ask-words.ts"
import type { Raised } from "./attention.ts"
import { BOARD_SEARCH } from "./board-view.ts"
import {
  afterUndo,
  cardOf,
  moveCard,
  planDiscard,
  planKeep,
  planNewNote,
  planOpenTrace,
  planPin,
  planPut,
  planTakeCopyIntoInventory,
  planTakeIntoInventory,
  planToNote,
  planUndoMove,
  planUnpin,
  queueMove,
  queueNew,
  reorderOf,
} from "./card-intents.ts"
import type { Pending, Prefill, ReaderAction } from "./columns.ts"
import {
  type Effect,
  type IntentState,
  layout,
  list,
  planOpenAt,
  show,
  showRoot,
} from "./effects.ts"
import type { NameStep } from "./identity.ts"
import { type Here, type LayoutAction, showsWorkspace } from "./layout.ts"
import { otherWidth } from "./list-width.ts"
import type { MessageAct } from "./message-tools.ts"
import type { PageName } from "./page.ts"
import type { PutTarget } from "./put-target.ts"
import { planSpinOff } from "./spin-off.ts"

/** What a reader asks of one column. A message's acts are among them. */
export type ColumnAct =
  | MessageAct
  /** Close the column, discarding `discard` first: a fresh column's cards. */
  | { readonly kind: "close"; readonly discard: readonly CardId[] }
  /** Discard a card here; the undo key brings it back (ADR-0111). */
  | { readonly kind: "discard"; readonly card: CardId }
  /**
   * Close a fresh column, keeping `cards` (its cards with text) in your
   * inventory first; it closes once every one is accepted.
   */
  | { readonly kind: "keep"; readonly cards: readonly CardId[] }
  /** Take a card in this column into your inventory (ADR-0048). */
  | { readonly kind: "takeIntoInventory"; readonly card: CardId }
  /** Move the column to index `to`. */
  | { readonly kind: "move"; readonly to: number }
  /** Read the column at `density` (ADR-0106). */
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
  /**
   * Queue a card on the column's lane, from where it was (ADR-0048), and
   * change that queue's hold with it (ADR-0113).
   */
  | {
      readonly kind: "queue"
      readonly card: CardId
      readonly lane: LaneName
      readonly at: Position
      readonly hold: QueueHoldChange
    }
  /** Pin a card below the line at the top of its thread's column (ADR-0048). */
  | { readonly kind: "pin"; readonly card: CardId }
  /** Unpin a card: a note at the thread's end. */
  | { readonly kind: "unpin"; readonly card: CardId }
  /** Your message to the notes at its thread's end (ADR-0113). */
  | { readonly kind: "toNote"; readonly card: CardId }
  /** A new, empty note in `cell` of this column's notes board (ADR-0113). */
  | { readonly kind: "newNote"; readonly card: CardId; readonly cell: number }
  /** A card into this column's composer, as your message (`planPut`). */
  | { readonly kind: "toMessage"; readonly card: CardId }
  /** A card made a new thread in `state` on the board (ADR-0111). */
  | {
      readonly kind: "spinOff"
      readonly card: CardId
      readonly state: WorkflowStateId
    }
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
  /** Set a card's command, or clear it with null (ADR-0108). */
  | {
      readonly kind: "setCommand"
      readonly card: CardId
      readonly command: CardCommand | null
    }
  /**
   * A card made in `lane`'s queue, with no text, never drawn anywhere first
   * (ADR-0113). A command button's (catching up, continuing on accepted
   * work, splitting the offer: ADR-0104, ADR-0061, ADR-0080) carries its
   * `command` and keeps the hold, so the host carries the command out when
   * the lane is free; "+ add to queue"'s has none and holds an idle queue
   * (`hold-if-idle`), so it waits while you type. Your message is left as
   * it is.
   */
  | {
      readonly kind: "queueNew"
      readonly card: CardId
      /** The column's root, for a lane whose record has not arrived. */
      readonly root: RootId
      readonly lane: LaneName
      readonly at: Position
      readonly command: CardCommand | null
      readonly hold: Extract<QueueHoldChange, "keep" | "hold-if-idle">
    }
  /** Act on the lane's offer in your repo; an acceptance names its destination (ADR-0104). */
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
  /** Show a root, opening it in the sidebar, or a new tab, or nothing. */
  | { readonly kind: "show"; readonly here: Here }
  | {
      readonly kind: "newTab"
      readonly asksAgent: boolean
      readonly prefill?: Prefill
      /** The workflow state its root lands in: the board column it came from (ADR-0122). */
      readonly state?: WorkflowStateId
    }
  /** Close a root of the sidebar, or a new tab, for you: nothing shared is written. */
  | { readonly kind: "close"; readonly here: Here }
  /** Move a root of the sidebar before `before`, or to its end (ADR-0122). */
  | {
      readonly kind: "moveInList"
      readonly root: EntryId
      readonly before: EntryId | null
    }
  /**
   * Move a root on the board (ADR-0122). Into the closed state it is archived,
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
  /** Change the board's workflow states (ADR-0122). */
  | { readonly kind: "editWorkflow"; readonly edit: WorkflowEdit }
  /** Close the board. */
  | { readonly kind: "board"; readonly open: false }
  /**
   * Open the board. `focus`: a person opened it (▦, a state in the strip),
   * so its search takes focus once (`armFocus`). The board opening by
   * itself, with nothing to show (`pruneLayout`), sends no intent.
   */
  | { readonly kind: "board"; readonly open: true; readonly focus: boolean }
  /** Fold the sidebar to icons, or unfold it (ADR-0088). */
  | { readonly kind: "foldList" }
  /** Show a page over the workspace, or, with null, the workspace (ADR-0098). */
  | { readonly kind: "page"; readonly to: PageName | null }
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
  /** Discard a card in your inventory; the undo key brings it back (ADR-0111). */
  | { readonly kind: "discard"; readonly card: CardId }
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

/** A column action on one root's columns, as `LayoutAction` carries it. */
type RootColumnAction = Extract<LayoutAction, { kind: "columns" }>["action"]

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
  return leavingPage(state.page, planOf(intent, state, fresh, newRoot))
}

/**
 * `effects`, after leaving the page shown over the workspace when they show
 * something there (`showsWorkspace`): a root, a new tab or the board would
 * otherwise open under the page, unseen.
 */
function leavingPage(
  page: PageName | null,
  effects: readonly Effect[],
): readonly Effect[] {
  const shows = effects.some(
    e => e.kind === "layout" && showsWorkspace(e.action),
  )
  return page !== null && shows
    ? [{ kind: "page", to: null }, ...effects]
    : effects
}

/** `planIntent`'s effects, before leaving a page. */
function planOf(
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
      // Into the closed state: it leaves the sidebar once the host accepts.
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
      return [
        ...(intent.open && intent.focus
          ? [{ kind: "armFocus", key: BOARD_SEARCH } as const]
          : []),
        layout({ kind: "board", open: intent.open }),
      ]
    case "foldList":
      return [{ kind: "listWidth", width: otherWidth(state.listWidth) }]
    case "page":
      return [{ kind: "page", to: intent.to }]
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
      return planPut(intent.card, intent.target, state, newRoot)
    case "discard":
      return planDiscard(
        intent.card,
        { actedAt: AT_INVENTORY, slot: null },
        state,
      )
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
      return planOf(
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
      const discard = act.discard.flatMap(id =>
        planDiscard(id, IN_COLUMN(key), state),
      )
      return [...discard, ...closing()]
    }
    case "discard":
      return planDiscard(act.card, IN_COLUMN(key), state)
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
      return move === null
        ? []
        : [
            {
              kind: "queueCard",
              move,
              hold: act.hold,
              command: null,
              how: IN_COLUMN(key),
            },
          ]
    }
    case "unqueue": {
      // If the host popped the card first, the refusal says it was sent.
      const now = cardOf(state.cards, act.card)
      if (now?.place.kind !== "queued") return []
      const move = moveOf(now, noteOf(now.place))
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
    case "toNote":
      return planToNote(act.card, key, state)
    case "newNote":
      return planNewNote(act.card, act.cell, key, state)
    case "toMessage":
      return planPut(act.card, { kind: "composer", key }, state, newRoot)
    case "spinOff":
      return planSpinOff(
        act.card,
        { kind: "state", state: act.state },
        newRoot,
        state,
      )
    case "setCommand":
      return [
        {
          kind: "request",
          intent: { kind: "set-command", card: act.card, command: act.command },
        },
      ]
    case "queueNew":
      return [
        {
          kind: "queueCard",
          move: queueNew(act.card, act.root, act, state.cards),
          hold: act.hold,
          command: act.command,
          how: IN_COLUMN(key),
        },
      ]
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

/** `root` leaves the sidebar, and if you are on it, its neighbour is shown. */
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
 * After a move on the board is answered (ADR-0122): `moved` runs only once
 * the host accepts. A root you move into the closed state leaves the sidebar,
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
