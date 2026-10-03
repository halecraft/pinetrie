// client/intent — what a reader asks of the page, as a value, and what it
// does. PURE.
//
// A click reaches `App` as an `Intent`. `planIntent` turns it into `Effect`s
// and `perform` (`perform.ts`) carries them out. A column's acts are nested
// under its position, as `LayoutAction` nests `ColumnAction` under a root, and
// a message's acts (`MessageAct`) are among them.

import type {
  ArchiveRecord,
  AskIndex,
  CardCommand,
  CardId,
  CardRecord,
  EntryId,
  LaneName,
  LaneView,
  Move,
  OfferAction,
  Position,
  TreeIndex,
  WriterId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import type { Density } from "./ask-words.ts"
import {
  columnMove,
  planKeep,
  planPut,
  planRemove,
  planTake,
  planTakeCopy,
  planUndoMove,
} from "./card-intents.ts"
import {
  type HistoryEntry,
  type HistoryStep,
  type MoveHistory,
  type MoveHow,
  NOT_RECORDED,
  type Refusal,
} from "./card-moves.ts"
import type { Pending, Prefill } from "./columns.ts"
import type { Identity, NameStep } from "./identity.ts"
import type { Slots } from "./inventory.ts"
import {
  type ActiveTab,
  type Layout,
  type LayoutAction,
  planOpen,
} from "./layout.ts"
import type { MessageAct } from "./message-tools.ts"
import type { Direction } from "./move-undo.ts"
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
  | { readonly kind: "take"; readonly card: CardId }
  /** Move the column to index `to`. */
  | { readonly kind: "move"; readonly to: number }
  /** Read the column at `density` (ADR-0056). */
  | { readonly kind: "density"; readonly density: Density }
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
  /** Take a queued card back below the line; `by` queued it. */
  | {
      readonly kind: "unqueue"
      readonly card: CardId
      readonly lane: LaneName
      readonly by: WriterId
    }
  /** Set a card's command, or clear it with null (ADR-0055). */
  | {
      readonly kind: "setCommand"
      readonly card: CardId
      readonly command: CardCommand | null
    }
  /**
   * The catch-up button, or continue-on-line's (ADR-0060, ADR-0061): a new
   * card, `create`, made at the thread's end with `command` and no text,
   * and queued on `lane` at once, so the host carries the command out when
   * the lane is free. Your card in the composer is left as it is.
   */
  | {
      readonly kind: "bringUpToDate"
      readonly create: CardRecord
      readonly command: CardCommand
      readonly lane: LaneName
      readonly at: Position
    }
  /** Act on the lane's offer in your repo; a take names its destination (ADR-0060). */
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
  | { readonly kind: "show"; readonly tab: ActiveTab }
  | {
      readonly kind: "newTab"
      readonly asksAgent: boolean
      readonly prefill?: Prefill
    }
  /** Close a tab for you: nothing is written. */
  | { readonly kind: "closeTab"; readonly tab: ActiveTab }
  | { readonly kind: "archive"; readonly root: EntryId }
  | { readonly kind: "restore"; readonly root: EntryId }
  | {
      readonly kind: "rename"
      readonly root: EntryId
      readonly title: string | null
    }
  /** Show entry `entry`, wherever it is (`planOpen`). */
  | { readonly kind: "openAt"; readonly entry: EntryId }
  | { readonly kind: "signOut" }
  /** Take `card` into your inventory: by key, wherever it is. */
  | { readonly kind: "take"; readonly card: CardId }
  /** Put `card` at `target`: a column's end, or a slot (a swap, or a take there). */
  | { readonly kind: "put"; readonly card: CardId; readonly target: PutTarget }
  /** Remove a card from your inventory: final, as a discard is. */
  | { readonly kind: "remove"; readonly card: CardId }
  /** Select an inventory slot. */
  | { readonly kind: "selectSlot"; readonly slot: number }
  /**
   * Undo or redo your newest move, showing its place first. `restored`: a
   * root just restored for it, read as restored whatever the copy says yet.
   */
  | {
      readonly kind: "undoMove"
      readonly direction: Direction
      readonly restored: EntryId | null
    }
  /** The archived-root dialog's "restore and undo". */
  | {
      readonly kind: "restoreAndUndo"
      readonly root: EntryId
      readonly direction: Direction
    }

export type Effect =
  | { readonly kind: "layout"; readonly action: LayoutAction }
  | { readonly kind: "archive"; readonly root: EntryId }
  | { readonly kind: "restore"; readonly root: EntryId }
  | {
      readonly kind: "mark"
      readonly root: EntryId
      readonly title: string | null
    }
  | {
      readonly kind: "discardCard"
      readonly card: CardId
      readonly how: MoveHow
    }
  | {
      readonly kind: "createCard"
      readonly card: CardRecord
      readonly text: string
      readonly how: MoveHow
    }
  | {
      readonly kind: "queueCard"
      readonly card: CardId
      readonly lane: LaneName
      readonly at: Position
      readonly how: MoveHow
    }
  | {
      readonly kind: "unqueueCard"
      readonly card: CardId
      readonly lane: LaneName
      readonly by: WriterId
      readonly how: MoveHow
    }
  /** A handoff: a take, a put, an undo's reverse (ADR-0059). */
  | { readonly kind: "moveCard"; readonly move: Move; readonly how: MoveHow }
  /** Swap two slots of your inventory. */
  | {
      readonly kind: "swapSlots"
      readonly a: number
      readonly b: number
      readonly step: HistoryStep
    }
  /**
   * Moves into your inventory, all sent at once; once each is answered,
   * `afterKeep` decides whether `close` runs.
   */
  | {
      readonly kind: "keep"
      readonly moves: readonly { readonly move: Move; readonly how: MoveHow }[]
      readonly close: readonly Effect[]
    }
  /** Drop a history entry undo could not act on, saying why. */
  | {
      readonly kind: "dropEntry"
      readonly entry: HistoryEntry
      readonly refusal: Refusal
    }
  /** Keep a refusal made before anything was sent. */
  | { readonly kind: "refuse"; readonly refusal: Refusal }
  /** Open the inventory; `brief`: only for a take's flight, if it was closed. */
  | { readonly kind: "showInventory"; readonly brief: boolean }
  | { readonly kind: "select"; readonly slot: number }
  /** Ask whether to restore `root` to undo or redo there (the dialog). */
  | {
      readonly kind: "askRestore"
      readonly root: EntryId
      readonly direction: Direction
    }
  /** Restore `root`; once restored, ask for `next`, planned afresh. */
  | {
      readonly kind: "restoreThen"
      readonly root: EntryId
      readonly next: Intent
    }
  | {
      readonly kind: "setCommand"
      readonly card: CardId
      readonly command: CardCommand | null
    }
  | {
      readonly kind: "offer"
      readonly lane: LaneName
      readonly action: OfferAction
      readonly to: string | null
    }
  /** Scroll to entry `entry` once it is drawn (`useReveal`). */
  | { readonly kind: "reveal"; readonly entry: EntryId }
  /** Open ask `ask`'s fold, so what is revealed in it is drawn (ADR-0056). */
  | { readonly kind: "openFold"; readonly ask: EntryId }
  /** Select `root` in the Archive tab, which previews it. */
  | { readonly kind: "pickArchived"; readonly root: EntryId }
  /** The column keyed `key` takes focus when it mounts (`claimFocus`). */
  | { readonly kind: "armFocus"; readonly key: string }
  | { readonly kind: "setName"; readonly name: string }
  | { readonly kind: "storeIdentity"; readonly identity: Identity }
  | { readonly kind: "forgetIdentity" }
  | { readonly kind: "reload" }

/** A column action on one root's columns, as `LayoutAction` carries it. */
type RootColumnAction = Extract<LayoutAction, { kind: "columns" }>["action"]

export interface IntentState {
  readonly layout: Layout
  readonly index: TreeIndex
  readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
  /** Every ask (`indexAsks`): a pick into one's work opens its fold. */
  readonly asks: AskIndex
  readonly cards: CardFacts
}

/** What the card intents decide from (ADR-0048 step 4). */
export interface CardFacts {
  /** Every card as drawn. */
  readonly cards: readonly CardRecord[]
  readonly lanes: readonly LaneView[]
  readonly me: WriterId
  /** Your inventory's slots as drawn (`settleSlots`). */
  readonly slots: Slots
  /** The selected slot. */
  readonly selected: number
  readonly history: MoveHistory
  /** Each column's composer place, by key. */
  readonly composers: ComposerPlaces
}

const layout = (action: LayoutAction): Effect => ({ kind: "layout", action })
const showRoot = (root: EntryId): Effect =>
  layout({ kind: "show", tab: { kind: "root", root } })

/**
 * The effects of `intent`. `fresh` is a new column key from the shell, as
 * `columnsReducer` takes keys in its actions: a column opened with it takes
 * focus, except one `openAt` opens, which only shows an entry.
 */
export function planIntent(
  intent: Intent,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  switch (intent.kind) {
    case "column":
      return planColumn(intent.position, intent.key, intent.act, state, fresh)
    case "show":
      return [layout({ kind: "show", tab: intent.tab })]
    case "newTab":
      return [
        { kind: "armFocus", key: fresh },
        layout({
          kind: "newTab",
          key: fresh,
          asksAgent: intent.asksAgent,
          ...(intent.prefill === undefined ? {} : { prefill: intent.prefill }),
        }),
      ]
    case "closeTab":
      switch (intent.tab.kind) {
        case "root":
          return [layout({ kind: "closeRoot", root: intent.tab.root })]
        case "new":
          return [layout({ kind: "closeNewTab", key: intent.tab.key })]
        case "archive":
          return []
      }
      return []
    case "archive":
      return [{ kind: "archive", root: intent.root }]
    case "restore":
      return [{ kind: "restore", root: intent.root }]
    case "rename":
      return [{ kind: "mark", root: intent.root, title: intent.title }]
    case "openAt":
      return planOpenAt(intent.entry, state, fresh)
    case "signOut":
      return [{ kind: "forgetIdentity" }, { kind: "reload" }]
    case "take":
      return planTake(intent.card, state)
    case "put":
      return planPut(intent.card, intent.target, state)
    case "remove":
      return planRemove(intent.card, state)
    case "selectSlot":
      return [{ kind: "select", slot: intent.slot }]
    case "undoMove":
      return planUndoMove(intent.direction, intent.restored, state, fresh)
    case "restoreAndUndo":
      return [
        {
          kind: "restoreThen",
          root: intent.root,
          next: {
            kind: "undoMove",
            direction: intent.direction,
            restored: intent.root,
          },
        },
      ]
  }
}

/**
 * Show entry `id` (`planOpen`): in view in the column that shows it, in a new
 * column beside the one sharing most of its path, or, in an archived root,
 * in the Archive tab's preview. An entry of an ask's work opens the ask's
 * fold first, whatever the column's density, so it is drawn to be revealed
 * (ADR-0056): forks, branch starts and people's messages are never in one.
 */
export function planOpenAt(
  id: EntryId,
  state: IntentState,
  fresh: string,
): readonly Effect[] {
  const plan = planOpen(state.layout, state.index, state.archive, id)
  if (plan === null) return []
  const ask = state.asks.askOf.get(id)
  const fold: readonly Effect[] =
    ask === undefined ? [] : [{ kind: "openFold", ask }]
  switch (plan.kind) {
    case "scroll":
      return [...fold, { kind: "reveal", entry: id }, showRoot(plan.root)]
    case "open":
      return [
        ...fold,
        { kind: "reveal", entry: id },
        showRoot(plan.root),
        layout({
          kind: "columns",
          root: plan.root,
          action: { kind: "open", key: fresh, after: plan.after, anchor: id },
        }),
      ]
    case "preview":
      return [
        { kind: "pickArchived", root: plan.root },
        layout({ kind: "show", tab: { kind: "archive" } }),
      ]
  }
}

/**
 * A column's act. One that changes the columns is the column action of the
 * root whose tab you are on; a new tab's one column can only send, reserve
 * its lane, and close, which closes the tab.
 */
function planColumn(
  position: number,
  key: string,
  act: ColumnAct,
  state: IntentState,
  fresh: string,
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
      const discard: readonly Effect[] = act.discard.map(card => ({
        kind: "discardCard",
        card,
        how: NOT_RECORDED(key),
      }))
      return [...discard, ...closing()]
    }
    case "keep":
      return planKeep(act.cards, key, closing(), state)
    case "take":
      return planTake(act.card, state)
    case "takeCopy":
      return planTakeCopy(act.card, act.text, state)
    case "move":
      return onRoot({ kind: "move", from: position, to: act.to })
    case "density":
      return onRoot({ kind: "density", index: position, density: act.density })
    case "sent":
      return onColumn({ kind: "sent", key: act.key, sendId: act.sendId })
    case "reserve":
      return onColumn({ kind: "reserve", key: act.key, lane: act.lane })
    case "queue": {
      const now = state.cards.cards.find(c => c.id === act.card)
      const to = {
        kind: "queued",
        at: act.at,
        lane: act.lane,
        seen: "",
      } as const
      return [
        {
          kind: "queueCard",
          card: act.card,
          lane: act.lane,
          at: act.at,
          how: columnMove(key, now === undefined ? null : { card: now, to }),
        },
      ]
    }
    case "unqueue": {
      const now = state.cards.cards.find(c => c.id === act.card)
      return [
        {
          kind: "unqueueCard",
          card: act.card,
          lane: act.lane,
          by: act.by,
          how: columnMove(
            key,
            now?.place.kind === "queued"
              ? {
                  card: now,
                  to: { kind: "drafting", at: now.place.at, lane: act.lane },
                }
              : null,
          ),
        },
      ]
    }
    case "setCommand":
      return [{ kind: "setCommand", card: act.card, command: act.command }]
    case "bringUpToDate":
      // Made, then queued: the host sets the command before the queue's
      // move, so the drain that move starts takes it with its command.
      return [
        {
          kind: "createCard",
          card: { ...act.create, command: act.command },
          text: "",
          how: NOT_RECORDED(key),
        },
        {
          kind: "queueCard",
          card: act.create.id,
          lane: act.lane,
          at: act.at,
          how: NOT_RECORDED(key),
        },
      ]
    case "offer":
      return [{ kind: "offer", lane: act.lane, action: act.action, to: act.to }]
  }
}

/** A column opened with `key` takes focus; nothing opened, nothing armed. */
const opened = (key: string, effects: readonly Effect[]): readonly Effect[] =>
  effects.length === 0 ? [] : [{ kind: "armFocus", key }, ...effects]

/**
 * The entry `intent` asks to see, from the page or from a column (a closed
 * branch's button), or null.
 */
export const entryShown = (intent: Intent): EntryId | null =>
  intent.kind === "openAt"
    ? intent.entry
    : intent.kind === "column" && intent.act.kind === "openAt"
      ? intent.act.entry
      : null

/** After a restore is answered: the root is shown only if it was restored. */
export const afterRestore = (
  outcome: Outcome,
  root: EntryId,
): readonly Effect[] => (outcome.kind === "restored" ? [showRoot(root)] : [])

/** `reconcileName`'s step, as effects. */
export function nameEffects(step: NameStep | null): readonly Effect[] {
  if (step === null) return []
  switch (step.kind) {
    case "send":
      return [{ kind: "setName", name: step.name }]
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
