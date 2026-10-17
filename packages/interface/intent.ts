// interface/intent — what a reader asks of the page, as a value, and what it
// does.
//
// A click reaches `App` as an `Intent`. `planIntent` turns it into `Effect`s
// and `perform` (`perform.ts`) carries them out. A column's acts are nested
// under its key, and a message's acts (`MessageAct`) are among them.

import {
  agentAsk,
  type CanvasId,
  type CardCommand,
  type CardId,
  type CardWidth,
  type EntryId,
  hasPlaceKind,
  type ListKey,
  type MarkTarget,
  type MoveDirection,
  moveOf,
  nonEmpty,
  noteOf,
  type Position,
  type ProposedChangesAction,
  type QueueHoldChange,
  type RootId,
  type TextCardId,
  type ThreadId,
  type ThreadStart,
  type TraceRecord,
  threadAt,
  type WorkflowEdit,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { isQueuedMessage, yourCard } from "@pinetrie/rules"
import {
  type ActedAt,
  AT_BOARD,
  AT_INVENTORY,
  IN_COLUMN,
} from "@pinetrie/session"
import type { Density } from "./ask-words.ts"
import type { Raised } from "./attention.ts"
import {
  afterUndo,
  canvasSpot,
  cardOf,
  clipFacts,
  moveCard,
  type PutHow,
  type PutSource,
  planComment,
  planDiscard,
  planEditAsText,
  planNewCard,
  planOpenTrace,
  planPin,
  planPinToCanvas,
  planPut,
  planQueueReference,
  planRestore,
  planToNote,
  planUndoMove,
  planUnpin,
  queueMove,
  queueNew,
  reorderOf,
  slotOf,
  textCardOf,
} from "./card-intents.ts"
import { type Clip, threadClip } from "./clip.ts"
import {
  type CardKey,
  type ColumnKey,
  keyText,
  type Minted,
  type Pending,
  type Prefill,
  type ReaderAction,
} from "./columns.ts"
import {
  changeViewOf,
  closeCanvasEffects,
  type Effect,
  foldViewOf,
  type IntentState,
  layout,
  list,
  planOpenAt,
  show,
  showCanvas,
} from "./effects.ts"
import type { NameStep } from "./identity.ts"
import {
  type Here,
  type LayoutAction,
  showsStage,
  type ViewChange,
} from "./layout.ts"
import { otherWidth } from "./list-width.ts"
import { AGENT_PREFILL, type MessageAct } from "./message-tools.ts"
import type { PageName } from "./page.ts"
import type { ProposalPress } from "./proposal-view.ts"
import type { CanvasPut, PutTarget } from "./put-target.ts"
import { type SearchAsk, searchActOn } from "./search.ts"
import { planSpinOff } from "./spin-off.ts"
import type { NewColumn } from "./start-button.ts"
import { openOf, type ThreadLink } from "./thread-link.ts"

/**
 * What a reader asks of one column, whatever its kind. A message's acts are
 * among them. What only one kind of column does (a card's moves, an
 * unstarted thread's first send) is an intent of its own that names a key
 * of that kind (`ColumnKey`), so it cannot be asked of another.
 */
export type ColumnAct =
  | MessageAct
  /** Discard a card here; the undo key brings it back. */
  | { readonly kind: "discard"; readonly card: CardId }
  /** Take a card in this column into your inventory. */
  | { readonly kind: "takeIntoInventory"; readonly card: CardId }
  /** Read the column at `density`. */
  | { readonly kind: "density"; readonly density: Density }
  /** Open or close the thread's details under the header. */
  | { readonly kind: "details"; readonly open: boolean }
  /** After a conflict: a thread opened at `at`, whose column sends `pending` there. */
  | {
      readonly kind: "branchInstead"
      readonly at: EntryId
      readonly pending: Pending
    }
  /**
   * Queue a card on the column's lane, from where it was, and
   * change that queue's hold with it.
   */
  | {
      readonly kind: "queue"
      readonly card: CardId
      readonly lane: ThreadId
      readonly at: Position
      readonly hold: QueueHoldChange
    }
  /** Pin a card below the line at the top of its thread's column. */
  | { readonly kind: "pin"; readonly card: CardId }
  /**
   * Unpin a card: a note in the note column nearest its thread, or, pinned
   * to the canvas, nearest the canvas column.
   */
  | { readonly kind: "unpin"; readonly card: CardId }
  /** Pin a card to the canvas its column is in: every thread reads it. */
  | { readonly kind: "pinToCanvas"; readonly card: CardId }
  /** Your message to the note column nearest its thread. */
  | { readonly kind: "toNote"; readonly card: CardId }
  /** Card `card`'s box takes focus once drawn: a new card handed to its list. */
  | { readonly kind: "focusCard"; readonly card: CardId }
  /**
   * A reference to the comment `card` on `entry`, queued on `thread`: the
   * agent reads it; the comment stays.
   */
  | {
      readonly kind: "queueReference"
      readonly card: CardId
      readonly entry: EntryId
      readonly thread: ThreadId
    }
  /** A new card holding `text`, at the end of the list `to`. */
  | {
      readonly kind: "newCard"
      readonly card: TextCardId
      readonly to: ListKey
      readonly text: string
    }
  /** A card into this column's composer, as your message (`planPut`). */
  | { readonly kind: "toMessage"; readonly card: CardId }
  /** A card made a new thread in `state` on the board. */
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
   * `among`, its list as drawn, by id.
   */
  | {
      readonly kind: "reorder"
      readonly card: CardId
      readonly among: readonly CardId[]
      readonly step: -1 | 1
    }
  /** Hold the thread's queue, or release it. */
  | {
      readonly kind: "holdQueue"
      readonly lane: ThreadId
      readonly held: boolean
    }
  /** Take every message card queued on the thread back below the line. */
  | { readonly kind: "unqueueAll"; readonly lane: ThreadId }
  /** Set a card's command, or clear it with null. */
  | {
      readonly kind: "setCommand"
      readonly card: CardId
      readonly command: CardCommand | null
    }
  /**
   * A card made in `lane`'s queue, with no text, never drawn anywhere first.
   * A command button's (catching up, continuing on accepted
   * work, splitting the proposed changes) carries its
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
  /** A press on the card of the agent's proposal at `proposal`. */
  | {
      readonly kind: "proposal"
      readonly proposal: EntryId
      readonly press: ProposalPress
    }
  /** Act on the lane's proposed changes in your repo; an acceptance names its destination. */
  | {
      readonly kind: "proposed"
      readonly lane: ThreadId
      readonly action: ProposedChangesAction
      readonly to: string | null
    }

export type Intent =
  | {
      readonly kind: "column"
      /** The column: where a refusal of what it does is said. */
      readonly column: ColumnKey
      readonly act: ColumnAct
    }
  /** Move a card's column to index `to` on its canvas, for everyone. */
  | {
      readonly kind: "moveColumn"
      readonly column: CardKey
      readonly to: number
    }
  /** A thread you opened sent its first message: what it started with is spent. */
  | { readonly kind: "sentFirst"; readonly card: ThreadId }
  /** Unfold a column of the canvas you are on, or fold it. */
  | {
      readonly kind: "fold"
      readonly card: CardId
      readonly unfolded: boolean
    }
  /** Unfold the canvas column of the canvas you are on, or fold it. */
  | { readonly kind: "foldCanvas"; readonly unfolded: boolean }
  /** Make a column, as `make` says, at a spot on a canvas. */
  | {
      readonly kind: "addColumn"
      readonly make: NewColumn
      readonly at: CanvasPut
    }
  /**
   * Copy the thread `source` at its end as you see it: its new
   * card just after the source on the source's canvas, or into your
   * inventory.
   */
  | {
      readonly kind: "copyThread"
      readonly source: ThreadId
      readonly to: "here" | "inventory"
    }
  /** Draw a card's column one column wide or two, for everyone. */
  | {
      readonly kind: "cardWidth"
      readonly card: CardId
      readonly width: CardWidth
    }
  /** Show a canvas, opening it in the sidebar, or nothing. */
  | { readonly kind: "show"; readonly here: Here }
  /**
   * Open a new canvas, its new root's first thread not yet started on it,
   * shown and in the sidebar. The thread's box starts with `prefill`, else
   * `@agent ` (`AGENT_PREFILL`).
   */
  | {
      readonly kind: "newCanvas"
      readonly prefill?: Prefill
      /** The workflow state its canvas lands in: the board column it came from. */
      readonly state?: WorkflowStateId
    }
  /** Close a canvas of the sidebar for you: nothing shared is written. */
  | { readonly kind: "close"; readonly here: Here }
  /** Move a canvas of the sidebar before `before`, or to its end. */
  | {
      readonly kind: "moveInList"
      readonly canvas: CanvasId
      readonly before: CanvasId | null
    }
  /**
   * Move a canvas on the board. Into the archive it is archived,
   * and closed for you once the host accepts; out of it, restored.
   */
  | {
      readonly kind: "moveCanvas"
      readonly canvas: CanvasId
      readonly from: WorkflowStateId
      readonly to: WorkflowStateId
      readonly before: CanvasId | null
      /** `to` is the archive. */
      readonly closes: boolean
    }
  | { readonly kind: "editWorkflow"; readonly edit: WorkflowEdit }
  /** Close the board. */
  | { readonly kind: "board"; readonly open: false }
  /**
   * Open the board. `focus`: a person opened it (▦, a state in the strip),
   * so its search takes focus once (`armFocus`). The board opening by
   * itself, with nothing to show (`pruneLayout`), sends no intent.
   */
  | { readonly kind: "board"; readonly open: true; readonly focus: boolean }
  /** Fold the sidebar to icons, or unfold it. */
  | { readonly kind: "foldList" }
  /** Show a page over the stage, or, with null, the stage. */
  | { readonly kind: "page"; readonly to: PageName | null }
  /** Open, type in, clear or close the search of the canvas you are on. */
  | { readonly kind: "search"; readonly act: SearchAsk }
  /** Title a canvas or a note column, or clear its title with null. */
  | {
      readonly kind: "rename"
      readonly of: MarkTarget
      readonly title: string | null
    }
  /** Ask a model for the canvas's title. */
  | { readonly kind: "retitle"; readonly canvas: CanvasId }
  /** What `lane` raised for you is not needed: it clears on every device. */
  | {
      readonly kind: "notNeeded"
      readonly lane: ThreadId
      readonly raised: Raised
    }
  /** Show entry `entry`, wherever it is (`planOpen`). */
  | { readonly kind: "openAt"; readonly entry: EntryId }
  /**
   * Follow a link to entry `entry` of its thread: in
   * its canvas, whose root this tab may not hold; in your
   * inventory, its preview; held by someone else, nothing. What the inbox,
   * a mention, a fork row and a rail's stub open.
   */
  | {
      readonly kind: "openLink"
      readonly link: ThreadLink
      readonly entry: EntryId
    }
  | { readonly kind: "signOut" }
  /** Take `card` into your inventory, into a free slot: by key, wherever it is. */
  | { readonly kind: "takeIntoInventory"; readonly card: CardId }
  /**
   * Land `source` at `target` (`planPut`): a put by key or button, a drop,
   * a slot's swap; `how` copies instead, as an Alt-drag does.
   */
  | {
      readonly kind: "put"
      readonly source: PutSource
      readonly target: PutTarget
      readonly how: PutHow
    }
  /**
   * Discard a card, said where `at` is: the undo key brings it back.
   * A cut is a copy, then this.
   */
  | { readonly kind: "discard"; readonly card: CardId; readonly at: ActedAt }
  /** Bring a trashed card back to where it was, for anyone who may. */
  | { readonly kind: "restore"; readonly card: CardId; readonly at: ActedAt }
  /** The page copied `clip` to the clipboard: the clipboard cell shows it. */
  | { readonly kind: "copied"; readonly clip: Clip }
  /** A paste of `clip` at `target`: a copy landed there. */
  | { readonly kind: "paste"; readonly clip: Clip; readonly target: PutTarget }
  /** The clipboard cell's copy into a free slot of your inventory. */
  | { readonly kind: "keep" }
  /**
   * Edit a reference as text: a paste of the quote `text` as the
   * text card `card`, replacing the reference in its place.
   */
  | {
      readonly kind: "editAsText"
      readonly reference: CardId
      readonly card: TextCardId
      readonly text: string
    }
  | { readonly kind: "selectSlot"; readonly slot: number }
  /**
   * Undo or redo your newest move in the canvas you are on, or, with the
   * inventory panel focused, your newest swap.
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
  return leavingSearch(
    state.searching,
    leavingPage(state.page, planOf(intent, state, minted)),
  )
}

/**
 * `effects`, after closing the search when they show something it covers:
 * a message revealed, a column opened or unfolded, or another
 * canvas, a new canvas or the board. A message revealed is outlined last, so
 * leaving shows where it landed.
 */
function leavingSearch(
  searching: boolean,
  effects: readonly Effect[],
): readonly Effect[] {
  if (!searching) return effects
  const shown = effects.findLast(e => e.kind === "reveal")
  const shows =
    shown !== undefined ||
    effects.some(e => e.kind === "layout" && opensOrShows(e.action))
  if (!shows) return effects
  return [
    { kind: "search", act: { kind: "close" } },
    ...effects,
    ...(shown === undefined
      ? []
      : [{ kind: "landed", entry: shown.entry } as const]),
  ]
}

/** A layout action that draws something new where the search was. */
const opensOrShows = (action: LayoutAction): boolean =>
  showsStage(action) ||
  (action.kind === "view" &&
    (action.change.kind === "opened" ||
      (action.change.kind === "fold" && action.change.unfolded)))

/**
 * `effects`, after leaving the page shown over the stage when they show
 * something there (`showsStage`): a root, a new canvas or the board would
 * otherwise open under the page, unseen.
 */
function leavingPage(
  page: PageName | null,
  effects: readonly Effect[],
): readonly Effect[] {
  const shows = effects.some(e => e.kind === "layout" && showsStage(e.action))
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
      return active?.kind === "canvas"
        ? planColumnMove(intent.column.card, intent.to, active.canvas, state)
        : []
    }
    case "sentFirst":
      return onCanvasYouAreOn(state, { kind: "sent", card: intent.card })
    case "fold":
    case "foldCanvas": {
      const active = state.layout.active
      return active?.kind === "canvas"
        ? [
            foldViewOf(
              state,
              active.canvas,
              intent.kind === "fold"
                ? { kind: "fold", card: intent.card, unfolded: intent.unfolded }
                : { kind: "foldCanvas", unfolded: intent.unfolded },
            ),
          ]
        : []
    }
    case "addColumn":
      return planAddColumn(intent.make, intent.at, state, minted)
    case "copyThread":
      return planCopyThread(intent.source, intent.to, state, minted)
    // From the canvas its sender sees it on: the host refuses it moved since.
    case "cardWidth": {
      const canvas = state.canvases.index.canvasOfCard.get(intent.card)
      return canvas === undefined
        ? []
        : [
            {
              kind: "request",
              intent: {
                kind: "card-width",
                card: intent.card,
                at: { kind: "canvas", canvas },
                width: intent.width,
              },
            },
          ]
    }
    case "show":
      return show(intent.here)
    case "newCanvas":
      return [
        ...openThreadColumn(
          minted.canvas,
          minted.thread,
          minted.root,
          { kind: "new-canvas", state: intent.state ?? null },
          { prefill: intent.prefill ?? AGENT_PREFILL },
          state,
        ),
        ...show({ kind: "canvas", canvas: minted.canvas }),
      ]
    case "close":
      return intent.here.kind === "canvas"
        ? closeCanvas(intent.here.canvas)
        : []
    case "moveInList":
      return [
        list({ kind: "place", canvas: intent.canvas, before: intent.before }),
      ]
    case "moveCanvas":
      // Into the archive: it leaves the sidebar once the host accepts.
      return [
        {
          kind: "moveCanvas",
          move: {
            kind: "move-canvas",
            canvas: intent.canvas,
            from: intent.from,
            to: intent.to,
            before: intent.before,
          },
          moved: intent.closes ? closeCanvas(intent.canvas) : [],
        },
      ]
    case "editWorkflow":
      return [
        { kind: "request", intent: { kind: "workflow", edit: intent.edit } },
      ]
    case "board":
      return [
        ...(intent.open && intent.focus
          ? [{ kind: "armFocus", key: { kind: "board" } } as const]
          : []),
        layout({ kind: "board", open: intent.open }),
      ]
    case "foldList":
      return [{ kind: "listWidth", width: otherWidth(state.listWidth) }]
    case "page":
      return [{ kind: "page", to: intent.to }]
    case "search": {
      const act = searchActOn(intent.act, state.layout.active)
      return act === null ? [] : [{ kind: "search", act }]
    }
    case "rename":
      return [
        {
          kind: "request",
          intent: { kind: "mark", of: intent.of, title: intent.title },
        },
      ]
    case "retitle":
      return [
        { kind: "request", intent: { kind: "retitle", canvas: intent.canvas } },
      ]
    case "notNeeded":
      return [{ kind: "notNeeded", lane: intent.lane, raised: intent.raised }]
    case "openAt":
      return planOpenAt(intent.entry, state)
    case "openLink":
      return planOpenLink(intent.link, intent.entry, state)
    case "signOut":
      return [{ kind: "forgetIdentity" }, { kind: "reload" }]
    case "takeIntoInventory":
      return planTake(intent.card, state, minted)
    case "put":
      return planPut(intent.source, intent.target, intent.how, state, minted)
    case "editAsText":
      return planEditAsText(intent, state)
    case "discard":
      return planDiscard(intent.card, { actedAt: intent.at, slot: null }, state)
    case "restore":
      return planRestore(intent.card, { actedAt: intent.at, slot: null }, state)
    case "copied":
      return [{ kind: "clipboardCell", clip: intent.clip }]
    case "paste":
      return planPut(
        { kind: "clip", clip: intent.clip },
        intent.target,
        "copy",
        state,
        minted,
      )
    case "keep":
      return state.clips.cell === null
        ? []
        : planPut(
            { kind: "clip", clip: state.clips.cell },
            { kind: "inventory", slot: null },
            "copy",
            state,
            minted,
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

/** A change to your view of the canvas you are on; off a canvas, nothing. */
const onCanvasYouAreOn = (
  state: IntentState,
  change: ViewChange,
): readonly Effect[] => {
  const active = state.layout.active
  return active?.kind === "canvas"
    ? [changeViewOf(state, active.canvas, change)]
    : []
}

/**
 * A column's act, said in `column`. A reader's setting is your view of its
 * card; the canvas column has none.
 */
function planColumn(
  column: ColumnKey,
  act: ColumnAct,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  const key = keyText(column)
  const onCanvas = (change: ViewChange) => onCanvasYouAreOn(state, change)
  /** A reader's setting, of a card's column. */
  const reading = (action: ReaderAction): readonly Effect[] => {
    if (column.kind !== "card") return []
    const { card } = column
    return onCanvas(
      action.kind === "density"
        ? { kind: "density", card, density: action.density }
        : { kind: "details", card, open: action.open },
    )
  }
  switch (act.kind) {
    case "proposal":
      return planProposal(act.proposal, act.press, state, minted)
    case "openAt":
      return planOpenAt(act.entry, state)
    case "newCanvas":
      return planOf({ kind: "newCanvas", prefill: act.prefill }, state, minted)
    // A branch is keyed by the thread it minted, as its card is.
    case "branch":
      return planOpenBranch(
        minted.thread,
        act.branch.at,
        act.branch.prefill === undefined ? {} : { prefill: act.branch.prefill },
        state,
      )
    case "branchInstead":
      return planOpenBranch(
        minted.thread,
        act.at,
        { pending: act.pending },
        state,
      )
    case "discard":
      return planDiscard(act.card, IN_COLUMN(key), state)
    case "takeIntoInventory":
      return planTake(act.card, state, minted)
    case "density":
      return reading({ kind: "density", density: act.density })
    case "details":
      return reading({ kind: "details", open: act.open })
    case "queue": {
      const now = textCardOf(state.cards, act.card)
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
      if (
        now === undefined ||
        !hasPlaceKind(now, "queued") ||
        !isQueuedMessage(now)
      )
        return []
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
    case "pinToCanvas":
      return planPinToCanvas(act.card, key, state)
    case "toNote":
      return planToNote(act.card, key, state)
    case "newCard":
      return planNewCard(act, key, state)
    case "focusCard":
      return [{ kind: "armFocus", key: { kind: "card", card: act.card } }]
    case "comment":
      return planComment(act, state)
    case "queueReference":
      return planQueueReference(act, minted.reference, IN_COLUMN(key), state)
    case "toMessage":
      return planPut(
        { kind: "card", card: act.card },
        { kind: "composer", key },
        "move",
        state,
        minted,
      )
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
        // A card with no command is one to type in.
        ...(act.command === null
          ? [
              {
                kind: "armFocus",
                key: { kind: "card", card: act.card },
              } as const,
            ]
          : []),
      ]
    case "proposed":
      return [
        { kind: "proposed", lane: act.lane, action: act.action, to: act.to },
      ]
  }
}

/**
 * Follow `link` to `entry` (`openOf`): in its canvas (`planOpenIn`); a thread
 * in your inventory, its preview there, read only; one someone else holds,
 * or with no card, nothing.
 */
export function planOpenLink(
  link: ThreadLink,
  entry: EntryId,
  state: IntentState,
): readonly Effect[] {
  const open = openOf(link, entry)
  switch (open.kind) {
    case "canvas":
      return planOpenIn(open.entry, open.canvas, state)
    case "preview": {
      const slot = slotOf(state.cards.slots, open.thread)
      return slot === null
        ? []
        : [
            { kind: "showInventory", brief: false },
            { kind: "select", slot },
            { kind: "openSelected" },
          ]
    }
    case "restore":
      return planRestore(
        open.thread,
        { actedAt: AT_INVENTORY, slot: null },
        state,
      )
    case "nothing":
      return []
  }
}

/**
 * Show `entry`, in canvas `canvas`. One this tab holds opens as
 * `planOpenAt`. Else the canvas is shown, which holds its roots, archived or
 * not, and the entry is shown once it has arrived.
 */
function planOpenIn(
  entry: EntryId,
  canvas: CanvasId,
  state: IntentState,
): readonly Effect[] {
  if (state.index.entries[entry] !== undefined) return planOpenAt(entry, state)
  return [...showCanvas(canvas), { kind: "openWhenHeld", entry }]
}

/**
 * A column moved to index `to` of its canvas, for everyone: a reorder
 * of its card among the canvas's cards as drawn, which the host
 * orders and the undo key takes back. Nothing for a card on no
 * canvas of `canvas`, or one already at `to`.
 */
function planColumnMove(
  card: CardId,
  to: number,
  canvas: CanvasId,
  state: Pick<IntentState, "canvases">,
): readonly Effect[] {
  const cards = state.canvases.index.cardsOn.get(canvas) ?? []
  const from = cards.findIndex(c => c.id === card)
  if (from < 0 || from === to || to < 0 || to >= cards.length) return []
  const rest = cards.filter(c => c.id !== card)
  return [
    {
      kind: "reorderCard",
      reorder: {
        card,
        at: { kind: "canvas", canvas },
        after: rest[to - 1]?.id ?? null,
        before: rest[to]?.id ?? null,
      },
      how: IN_COLUMN(card),
    },
  ]
}

/**
 * A column made at `at`, both kinds ranked there by the host as a drop
 * there is. A note column: a move with no `from`, so the undo key takes it
 * back; unfolded, so you see what you made. A thread: a new root's, opened
 * with its column, taking focus.
 */
function planAddColumn(
  make: NewColumn,
  at: CanvasPut,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  const { canvas, after } = at
  switch (make.kind) {
    case "note-column": {
      const column = minted.noteColumn
      return [
        moveCard(
          { card: column, from: null, to: canvasSpot(at) },
          IN_COLUMN(column),
          false,
        ),
        changeViewOf(state, canvas, {
          kind: "fold",
          card: column,
          unfolded: true,
        }),
      ]
    }
    case "thread":
      return openThreadColumn(
        canvas,
        minted.thread,
        minted.root,
        { kind: "new-root", after },
        make.asksAgent ? { asksAgent: true } : {},
        state,
      )
  }
}

/** Take `card` into a free slot of your inventory: a landing with no slot aimed at. */
const planTake = (
  card: CardId,
  state: IntentState,
  minted: Minted,
): readonly Effect[] =>
  planPut(
    { kind: "card", card },
    { kind: "inventory", slot: null },
    "move",
    state,
    minted,
  )

/**
 * A copy of `source` at its end as this tab holds it, as a
 * paste of it lands: just after the source on its canvas, or
 * into a free slot of your inventory. Nothing for a thread with no card or
 * no end here, or copied here from no canvas.
 */
function planCopyThread(
  source: ThreadId,
  to: "here" | "inventory",
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  const of = threadClip(source, clipFacts(state))
  if (of === null) return []
  const canvas = state.canvases.index.canvasOfCard.get(source)
  const target: PutTarget | null =
    to === "inventory"
      ? { kind: "inventory", slot: null }
      : canvas === undefined
        ? null
        : { kind: "canvas", canvas, after: source }
  return target === null
    ? []
    : planPut(
        { kind: "clip", clip: { kind: "card", of, cut: false } },
        target,
        "copy",
        state,
        minted,
      )
}

/**
 * A branch at `at` opened on the canvas you are on: its thread
 * `thread` written now, its card just after the thread `at` is in, and its
 * column unfolded with what it starts with, taking focus. Nothing off a
 * canvas, or for an entry in no root this tab holds.
 */
function planOpenBranch(
  thread: ThreadId,
  at: EntryId,
  starts: ColumnStarts,
  state: IntentState,
): readonly Effect[] {
  const active = state.layout.active
  const parent = threadAt(state.index, at)
  const root =
    parent === null ? undefined : state.canvases.index.rootOfThread.get(parent)
  if (active?.kind !== "canvas" || root === undefined) return []
  return openThreadColumn(
    active.canvas,
    thread,
    root,
    { kind: "branch", at },
    starts,
    state,
  )
}

/** What a thread's column starts with, until its first send. */
/**
 * A press on a proposal, from the thread that proposed it. Start and Open are
 * one request, its threads minted here in the rows' order; Open also unfolds
 * each column for this page, a row edited in the card starting with that
 * edit. Send sends each opened thread's composer text as its composer would:
 * your card's, else your prefill, else its row's brief.
 */
function planProposal(
  proposal: EntryId,
  press: ProposalPress,
  state: IntentState,
  minted: Minted,
): readonly Effect[] {
  const lane = threadAt(state.index, proposal)
  const canvas =
    lane === null ? undefined : state.canvases.index.canvasOfThread.get(lane)
  const root =
    lane === null ? undefined : state.canvases.index.rootOfThread.get(lane)
  if (canvas === undefined || root === undefined) return []
  if (press.kind === "send") {
    const view = state.layout.canvases.get(canvas)
    const content = state.index.entries[proposal]?.message?.proposal
    return press.threads.flatMap(({ thread, row }): readonly Effect[] => {
      const card = yourCard(
        state.cards.me,
        { kind: "thread", thread },
        state.cards.cards,
        state.index,
      )
      const brief = content?.branches[row]?.brief
      const text = (
        card !== undefined
          ? state.clips.textOf(card.id)
          : (view?.cards.get(thread)?.prefill?.text ??
            (brief === undefined ? "" : agentAsk(brief)))
      ).trim()
      if (text === "") return []
      return [
        {
          kind: "send",
          text,
          at: { kind: "branch", thread, at: press.fork, canvas },
          card: card?.id ?? null,
        },
        changeViewOf(state, canvas, { kind: "sent", card: thread }),
      ]
    })
  }
  const threads = minted.branches(press.rows.length)
  const rows = nonEmpty(
    press.rows.flatMap((r, i) => {
      const thread = threads[i]
      return thread === undefined ? [] : [{ ...r, thread }]
    }),
  )
  if (rows === null) return []
  const base = { kind: "branch-out", root, canvas, proposal } as const
  const opened = ({ thread, row }: (typeof rows)[number]) => ({ thread, row })
  const started = (r: (typeof rows)[number]) => ({
    ...opened(r),
    brief: r.brief,
  })
  const [head, ...tail] = rows
  if (press.kind === "start")
    return [
      {
        kind: "request",
        intent: {
          ...base,
          how: "start",
          branches: [started(head), ...tail.map(started)],
        },
      },
    ]
  return [
    { kind: "armFocus", key: { kind: "column", key: head.thread } },
    {
      kind: "request",
      intent: {
        ...base,
        how: "open",
        branches: [opened(head), ...tail.map(opened)],
      },
    },
    ...rows.map(r =>
      changeViewOf(state, canvas, {
        kind: "opened",
        card: r.thread,
        ...(r.edited
          ? { prefill: { text: agentAsk(r.brief), blank: false } }
          : {}),
      }),
    ),
  ]
}

type ColumnStarts = Omit<
  Extract<ViewChange, { kind: "opened" }>,
  "kind" | "card"
>

/**
 * The thread `thread` of `root` opened on `canvas`'s canvas as `start` says,
 * written now, and its column, keyed by the thread as its card is, unfolded
 * with what it starts with and taking focus once.
 */
function openThreadColumn(
  canvas: CanvasId,
  thread: ThreadId,
  root: RootId,
  start: ThreadStart,
  starts: ColumnStarts,
  state: IntentState,
): readonly Effect[] {
  return [
    { kind: "armFocus", key: { kind: "column", key: thread } },
    {
      kind: "request",
      intent: { kind: "open-thread", thread, root, canvas, start },
    },
    changeViewOf(state, canvas, { kind: "opened", card: thread, ...starts }),
  ]
}

const closeCanvas = closeCanvasEffects

/**
 * After a move on the board is answered: `moved` runs only once
 * the host accepts. A canvas you move into the archive leaves the sidebar,
 * the one you are on too; only a canvas someone else archives stays while you
 * are on it (`resolveLayout`). A refusal of its card's move is
 * said on the board, naming who moved it first; any other changes nothing.
 */
export function afterCanvasMove(
  outcome: Outcome,
  moved: readonly Effect[],
): readonly Effect[] {
  switch (outcome.kind) {
    case "moved":
      return moved
    case "unmoved":
      return [
        {
          kind: "refuse",
          refusal: {
            card: null,
            actedAt: AT_BOARD,
            code: outcome.code,
            by: outcome.by,
            fromQueue: false,
          },
        },
      ]
    default:
      return []
  }
}

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
