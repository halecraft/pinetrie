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
  type MoveDirection,
  moveOf,
  noteOf,
  type OfferAction,
  type Position,
  type QueueHoldChange,
  type TaskId,
  type TextCardId,
  type ThreadId,
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
import type { Minted, Pending, Prefill, ReaderAction } from "./columns.ts"
import {
  type Effect,
  entryOfTask,
  type IntentState,
  layout,
  list,
  planOpenAt,
  show,
  showTask,
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
      readonly lane: ThreadId
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
  | {
      readonly kind: "newNote"
      readonly card: TextCardId
      readonly cell: number
    }
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
      readonly lane: ThreadId
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
      readonly lane: ThreadId
      readonly held: boolean
    }
  /** Take every message card queued on the thread back below the line. */
  | { readonly kind: "unqueueAll"; readonly lane: ThreadId }
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
      readonly card: TextCardId
      readonly lane: ThreadId
      readonly at: Position
      readonly command: CardCommand | null
      readonly hold: Extract<QueueHoldChange, "keep" | "hold-if-idle">
    }
  /** Act on the lane's offer in your repo; an acceptance names its destination (ADR-0104). */
  | {
      readonly kind: "offer"
      readonly lane: ThreadId
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
  /** Show a task, opening it in the sidebar, or a new tab, or nothing. */
  | { readonly kind: "show"; readonly here: Here }
  | {
      readonly kind: "newTab"
      readonly asksAgent: boolean
      readonly prefill?: Prefill
      /** The workflow state its task lands in: the board column it came from (ADR-0122). */
      readonly state?: WorkflowStateId
    }
  /** Close a task of the sidebar, or a new tab, for you: nothing shared is written. */
  | { readonly kind: "close"; readonly here: Here }
  /** Move a task of the sidebar before `before`, or to its end (ADR-0122). */
  | {
      readonly kind: "moveInList"
      readonly task: TaskId
      readonly before: TaskId | null
    }
  /**
   * Move a task on the board (ADR-0122). Into the archive it is archived,
   * and closed for you once the host accepts; out of it, restored.
   */
  | {
      readonly kind: "moveTask"
      readonly task: TaskId
      readonly from: WorkflowStateId
      readonly to: WorkflowStateId
      readonly before: TaskId | null
      /** `to` is the archive. */
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
      readonly task: TaskId
      readonly title: string | null
    }
  /** Ask a model for the task's title (ADR-0074). */
  | { readonly kind: "retitle"; readonly task: TaskId }
  /** What `lane` raised for you is not needed (ADR-0077): it clears on every device. */
  | {
      readonly kind: "notNeeded"
      readonly lane: ThreadId
      readonly raised: Raised
    }
  /** Show entry `entry`, wherever it is (`planOpen`). */
  | { readonly kind: "openAt"; readonly entry: EntryId }
  /**
   * Show entry `entry` of task `task`, whose root this tab may not hold
   * (ADR-0063): what the header and the inbox open.
   */
  | { readonly kind: "openIn"; readonly entry: EntryId; readonly task: TaskId }
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
   * Undo or redo your newest move in the task you are on, or, with the
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

/** A column action on one task's columns, as `LayoutAction` carries it. */
type TaskColumnAction = Extract<LayoutAction, { kind: "columns" }>["action"]

/**
 * The effects of `intent`. `minted` holds the ids the shell made for it
 * (`Minted`): a column opened with its key takes focus, except one `openAt`
 * opens, which only shows an entry.
 */
export function planIntent(
  intent: Intent,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  return leavingPage(state.page, planOf(intent, state, minted))
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
  minted: Minted,
): readonly Effect[] {
  const fresh = minted.key
  switch (intent.kind) {
    case "column":
      return planColumn(intent.position, intent.key, intent.act, state, minted)
    case "show":
      return show(intent.here)
    case "newTab":
      return [
        { kind: "armFocus", key: fresh },
        layout({
          kind: "newTab",
          key: fresh,
          root: minted.root,
          task: minted.task,
          thread: minted.thread,
          asksAgent: intent.asksAgent,
          ...(intent.prefill === undefined ? {} : { prefill: intent.prefill }),
          ...(intent.state === undefined ? {} : { state: intent.state }),
        }),
      ]
    case "close":
      switch (intent.here.kind) {
        case "task":
          return closeTask(intent.here.task)
        case "new":
          return [layout({ kind: "closeNewTab", key: intent.here.key })]
        case "nothing":
          return []
      }
      return []
    case "moveInList":
      return [list({ kind: "place", task: intent.task, before: intent.before })]
    case "moveTask":
      // Into the archive: it leaves the sidebar once the host accepts.
      return [
        {
          kind: "moveTask",
          move: {
            kind: "move-task",
            task: intent.task,
            from: intent.from,
            to: intent.to,
            before: intent.before,
          },
          moved: intent.closes ? closeTask(intent.task) : [],
        },
      ]
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
      return [
        {
          kind: "request",
          intent: { kind: "mark", task: intent.task, title: intent.title },
        },
      ]
    case "retitle":
      return [
        { kind: "request", intent: { kind: "retitle", task: intent.task } },
      ]
    case "notNeeded":
      return [{ kind: "notNeeded", lane: intent.lane, raised: intent.raised }]
    case "openAt":
      return planOpenAt(intent.entry, state, fresh)
    case "openIn":
      return planOpenIn(intent.entry, intent.task, state, fresh)
    case "signOut":
      return [{ kind: "forgetIdentity" }, { kind: "reload" }]
    case "takeIntoInventory":
      return planTakeIntoInventory(intent.card, state)
    case "put":
      return planPut(intent.card, intent.target, state, minted)
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
      return afterUndo(intent.outcome, state, minted)
    case "openTrace":
      return planOpenTrace(intent.trace, state, minted)
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
 * task you are on; a new tab's one column can only send, take a reader's
 * setting, and close, which closes the tab.
 */
function planColumn(
  position: number,
  key: string,
  act: ColumnAct,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  const fresh = minted.key
  const active = state.layout.active
  const onRoot = (action: TaskColumnAction): readonly Effect[] =>
    active?.kind === "task"
      ? [
          layout({
            kind: "columns",
            task: active.task,
            entry: entryOfTask(state, active.task),
            action,
          }),
        ]
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
        minted,
      )
    case "branch":
      return opened(
        fresh,
        onRoot({
          kind: "openFresh",
          key: fresh,
          thread: minted.thread,
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
          thread: minted.thread,
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
    case "queue": {
      const now = cardOf(state.cards, act.card)
      return now === undefined
        ? []
        : [
            {
              kind: "queueCard",
              move: queueMove(now, act),
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
      return planPut(act.card, { kind: "composer", key }, state, minted)
    case "spinOff":
      return planSpinOff(
        act.card,
        { kind: "state", state: act.state },
        minted,
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
          move: queueNew(act.card, act),
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
 * Show `entry`, in task `task` (ADR-0063). One this tab holds opens as
 * `planOpenAt`. Else the task is shown, which holds its roots, archived or
 * not, and the entry is shown once it has arrived.
 */
function planOpenIn(
  entry: EntryId,
  task: TaskId,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  if (state.index.entries[entry] !== undefined)
    return planOpenAt(entry, state, fresh)
  return [...showTask(task), { kind: "openWhenHeld", entry }]
}

/** A column opened with `key` takes focus; nothing opened, nothing armed. */
const opened = (key: string, effects: readonly Effect[]): readonly Effect[] =>
  effects.length === 0 ? [] : [{ kind: "armFocus", key }, ...effects]

/** `task` leaves the sidebar, and if you are on it, its neighbour is shown. */
const closeTask = (task: TaskId): readonly Effect[] => [
  list({ kind: "close", task }),
  layout({ kind: "closeTask", task }),
]

/**
 * After a move on the board is answered (ADR-0122): `moved` runs only once
 * the host accepts. A task you move into the archive leaves the sidebar,
 * the one you are on too; only a task someone else archives stays while you
 * are on it (`resolveLayout`). A refusal changes nothing.
 */
export const afterTaskMove = (
  outcome: Outcome,
  moved: readonly Effect[],
): readonly Effect[] => (outcome.kind === "moved-task" ? moved : [])

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
