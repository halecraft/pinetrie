// interface/intent — what a reader asks of the page, as a value, and what it
// does. PURE.
//
// A click reaches `App` as an `Intent`. `planIntent` turns it into `Effect`s
// and `perform` (`perform.ts`) carries them out. A column's acts are nested
// under its key, and a message's acts (`MessageAct`) are among them.

import {
  type CardCommand,
  type CardId,
  type CardWidth,
  type EntryId,
  type MarkTarget,
  type MoveDirection,
  moveOf,
  type NoteColumnId,
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
  planPinToTask,
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
import {
  type CardKey,
  type ColumnKey,
  type FreshKey,
  keyText,
  type Minted,
  type NewTabAction,
  type Pending,
  type Prefill,
} from "./columns.ts"
import {
  changeViewOf,
  type Effect,
  type IntentState,
  layout,
  list,
  planOpenAt,
  show,
  showTask,
} from "./effects.ts"
import type { NameStep } from "./identity.ts"
import { type Here, showsWorkspace, type ViewChange } from "./layout.ts"
import { otherWidth } from "./list-width.ts"
import type { MessageAct } from "./message-tools.ts"
import type { PageName } from "./page.ts"
import type { PutTarget } from "./put-target.ts"
import { planSpinOff } from "./spin-off.ts"

/**
 * What a reader asks of one column, whatever its kind. A message's acts are
 * among them. What only one kind of column does (a card's moves, a fresh
 * column's close and first send) is an intent of its own that names a key of
 * that kind (`ColumnKey`), so it cannot be asked of another.
 */
export type ColumnAct =
  | MessageAct
  /** Discard a card here; the undo key brings it back (ADR-0111). */
  | { readonly kind: "discard"; readonly card: CardId }
  /** Take a card in this column into your inventory (ADR-0048). */
  | { readonly kind: "takeIntoInventory"; readonly card: CardId }
  /** Read the column at `density` (ADR-0106). */
  | { readonly kind: "density"; readonly density: Density }
  /** Open or close the thread's details under the header (ADR-0073). */
  | { readonly kind: "details"; readonly open: boolean }
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
  /**
   * Unpin a card: a note in the note column nearest its thread, or, pinned
   * to the task, nearest the task column (ADR-0116).
   */
  | { readonly kind: "unpin"; readonly card: CardId }
  /** Pin a card to the task its column is in: every thread reads it (ADR-0116). */
  | { readonly kind: "pinToTask"; readonly card: CardId }
  /** Your message to the note column nearest its thread (ADR-0116). */
  | { readonly kind: "toNote"; readonly card: CardId }
  /** A new, empty note at the end of note column `column` (ADR-0116). */
  | {
      readonly kind: "newNote"
      readonly card: TextCardId
      readonly column: NoteColumnId
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
      /** The column: where a refusal of what it does is said. */
      readonly column: ColumnKey
      readonly act: ColumnAct
    }
  /** Move a card's column to index `to` on its canvas, for everyone (ADR-0116). */
  | {
      readonly kind: "moveColumn"
      readonly column: CardKey
      readonly to: number
    }
  /** Close a fresh column, discarding `discard` first: its cards. */
  | {
      readonly kind: "closeFresh"
      readonly column: FreshKey
      readonly discard: readonly CardId[]
    }
  /**
   * Close a fresh column, keeping `cards` (its cards with text) in your
   * inventory first; it closes once every one is accepted.
   */
  | {
      readonly kind: "keepFresh"
      readonly column: FreshKey
      readonly cards: readonly CardId[]
    }
  /** A fresh column's first send, as send `sendId`. */
  | {
      readonly kind: "sentFresh"
      readonly column: FreshKey
      readonly sendId: string
    }
  /** Unfold a column of the task you are on, or fold it (ADR-0116). */
  | {
      readonly kind: "fold"
      readonly card: CardId
      readonly unfolded: boolean
    }
  /** Unfold the task column of the task you are on, or fold it. */
  | { readonly kind: "foldTask"; readonly unfolded: boolean }
  /**
   * Make a note column on the canvas of the task you are on, just after the
   * card `after`, or first with null (ADR-0116).
   */
  | { readonly kind: "addNoteColumn"; readonly after: CardId | null }
  /** Draw a card's column one column wide or two, for everyone (ADR-0116). */
  | {
      readonly kind: "cardWidth"
      readonly card: CardId
      readonly width: CardWidth
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
  /** Title a task or a note column, or clear its title with null (ADR-0116). */
  | {
      readonly kind: "rename"
      readonly of: MarkTarget
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
  switch (intent.kind) {
    case "column":
      return planColumn(intent.column, intent.act, state, minted)
    case "moveColumn": {
      const active = state.layout.active
      return active?.kind === "task"
        ? planColumnMove(intent.column.card, intent.to, active.task, state)
        : []
    }
    case "closeFresh": {
      const at = IN_COLUMN(keyText(intent.column))
      return [
        ...intent.discard.flatMap(id => planDiscard(id, at, state)),
        ...closeFresh(intent.column, state),
      ]
    }
    case "keepFresh":
      return planKeep(
        intent.cards,
        keyText(intent.column),
        closeFresh(intent.column, state),
        state,
      )
    case "sentFresh":
      return intent.column.kind === "newTab"
        ? [
            layout({
              kind: "newTabColumn",
              key: intent.column.thread,
              action: { kind: "sent", sendId: intent.sendId },
            }),
          ]
        : onTaskYouAreOn(state, {
            kind: "sent",
            thread: intent.column.thread,
            sendId: intent.sendId,
          })
    case "fold":
    case "foldTask": {
      const active = state.layout.active
      return active?.kind === "task"
        ? [
            changeViewOf(
              state,
              active.task,
              intent.kind === "fold"
                ? { kind: "fold", card: intent.card, unfolded: intent.unfolded }
                : { kind: "foldTask", unfolded: intent.unfolded },
            ),
          ]
        : []
    }
    case "addNoteColumn": {
      const active = state.layout.active
      return active?.kind === "task"
        ? planAddNoteColumn(active.task, intent.after, minted.noteColumn, state)
        : []
    }
    // From the canvas its sender sees it on: the host refuses it moved since.
    case "cardWidth": {
      const task = state.tasks.index.taskOfCard.get(intent.card)
      return task === undefined
        ? []
        : [
            {
              kind: "request",
              intent: {
                kind: "card-width",
                card: intent.card,
                at: { kind: "canvas", task },
                width: intent.width,
              },
            },
          ]
    }
    case "show":
      return show(intent.here)
    case "newTab":
      // Keyed by the thread it minted, as its card will be.
      return [
        { kind: "armFocus", key: minted.thread },
        layout({
          kind: "newTab",
          key: minted.thread,
          root: minted.root,
          task: minted.task,
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
          intent: { kind: "mark", of: intent.of, title: intent.title },
        },
      ]
    case "retitle":
      return [
        { kind: "request", intent: { kind: "retitle", task: intent.task } },
      ]
    case "notNeeded":
      return [{ kind: "notNeeded", lane: intent.lane, raised: intent.raised }]
    case "openAt":
      return planOpenAt(intent.entry, state)
    case "openIn":
      return planOpenIn(intent.entry, intent.task, state)
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
      return afterUndo(intent.outcome, state)
    case "openTrace":
      return planOpenTrace(intent.trace, state)
  }
}

/** A change to your view of the task you are on; off a task, nothing. */
const onTaskYouAreOn = (
  state: IntentState,
  change: ViewChange,
): readonly Effect[] => {
  const active = state.layout.active
  return active?.kind === "task"
    ? [changeViewOf(state, active.task, change)]
    : []
}

/** Closing a fresh column: a new tab's closes the tab, a branch's leaves your view. */
const closeFresh = (column: FreshKey, state: IntentState): readonly Effect[] =>
  column.kind === "newTab"
    ? [layout({ kind: "closeNewTab", key: column.thread })]
    : onTaskYouAreOn(state, { kind: "closeFresh", thread: column.thread })

/**
 * A column's act, said in `column`. A reader's setting is your view of its
 * card, of the branch, or of a new tab's one column; the task column has
 * none.
 */
function planColumn(
  column: ColumnKey,
  act: ColumnAct,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  const key = keyText(column)
  const onTask = (change: ViewChange) => onTaskYouAreOn(state, change)
  /** A reader's setting: of a card, a branch, or a new tab's column. */
  const reading = (
    action: Extract<NewTabAction, { kind: "density" | "details" }>,
  ): readonly Effect[] => {
    switch (column.kind) {
      case "newTab":
        return [layout({ kind: "newTabColumn", key: column.thread, action })]
      case "task":
        return []
      case "card":
      case "fresh": {
        const card = column.kind === "card" ? column.card : column.thread
        return onTask(
          action.kind === "density"
            ? { kind: "density", card, density: action.density }
            : { kind: "details", card, open: action.open },
        )
      }
    }
  }
  switch (act.kind) {
    case "openAt":
      return planOpenAt(act.entry, state)
    case "newTab":
      return planOf(
        { kind: "newTab", asksAgent: act.asksAgent, prefill: act.prefill },
        state,
        minted,
      )
    // A branch is keyed by the thread it minted, as its card will be.
    case "branch":
      return opened(
        minted.thread,
        onTask({
          kind: "openFresh",
          thread: minted.thread,
          at: act.branch.at,
          ...(act.branch.prefill === undefined
            ? {}
            : { prefill: act.branch.prefill }),
        }),
      )
    case "branchInstead":
      return opened(
        minted.thread,
        onTask({
          kind: "openFresh",
          thread: minted.thread,
          at: act.at,
          pending: act.pending,
        }),
      )
    case "discard":
      return planDiscard(act.card, IN_COLUMN(key), state)
    case "takeIntoInventory":
      return planTakeIntoInventory(act.card, state)
    case "takeCopyIntoInventory":
      return planTakeCopyIntoInventory(act.card, act.text, state)
    case "density":
      return reading({ kind: "density", density: act.density })
    case "details":
      return reading({ kind: "details", open: act.open })
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
    case "pinToTask":
      return planPinToTask(act.card, key, state)
    case "toNote":
      return planToNote(act.card, key, state)
    case "newNote":
      return planNewNote(act.card, act.column, state)
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
): readonly Effect[] {
  if (state.index.entries[entry] !== undefined) return planOpenAt(entry, state)
  return [...showTask(task), { kind: "openWhenHeld", entry }]
}

/**
 * A column moved to index `to` of its task's canvas, for everyone: a reorder
 * of its card among the canvas's cards as drawn (ADR-0116), which the host
 * orders and the undo key takes back (ADR-0066). Nothing for a card on no
 * canvas of `task`, or one already at `to`.
 */
export function planColumnMove(
  card: CardId,
  to: number,
  task: TaskId,
  state: Pick<IntentState, "tasks">,
): readonly Effect[] {
  const canvas = state.tasks.index.canvases.get(task) ?? []
  const from = canvas.findIndex(c => c.id === card)
  if (from < 0 || from === to || to < 0 || to >= canvas.length) return []
  const rest = canvas.filter(c => c.id !== card)
  return [
    {
      kind: "reorderCard",
      reorder: {
        card,
        at: { kind: "canvas", task },
        after: rest[to - 1]?.id ?? null,
        before: rest[to]?.id ?? null,
      },
      how: IN_COLUMN(card),
    },
  ]
}

/**
 * A note column made on `task`'s canvas just after `after` (ADR-0116): a
 * move with no `from` to that spot, so the host ranks it there and the undo
 * key takes it back; unfolded, so you see what you made.
 */
function planAddNoteColumn(
  task: TaskId,
  after: CardId | null,
  column: NoteColumnId,
  state: IntentState,
): readonly Effect[] {
  return [
    moveCard(
      { card: column, from: null, to: { kind: "canvas-at", task, after } },
      IN_COLUMN(column),
      false,
    ),
    changeViewOf(state, task, { kind: "fold", card: column, unfolded: true }),
  ]
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
