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
  OfferAction,
  Position,
  TreeIndex,
  WriterId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import type { Density } from "./ask-words.ts"
import type { Pending, Prefill } from "./columns.ts"
import type { Identity, NameStep } from "./identity.ts"
import {
  type ActiveTab,
  type Layout,
  type LayoutAction,
  planOpen,
} from "./layout.ts"
import type { MessageAct } from "./message-tools.ts"

/** What a reader asks of one column. A message's acts are among them. */
export type ColumnAct =
  | MessageAct
  /** Close the column, discarding `discard` first: a fresh column's card. */
  | { readonly kind: "close"; readonly discard: CardId | null }
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
   * The bring-up-to-date button, or continue-on-line's (ADR-0060): your card
   * at the column's end, `card`, or `create` when you have none there, gets
   * `command`, and the column keyed `key` takes focus (ADR-0055).
   */
  | {
      readonly kind: "bringUpToDate"
      readonly key: string
      readonly card: CardId | null
      readonly create: CardRecord
      readonly command: CardCommand
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

export type Effect =
  | { readonly kind: "layout"; readonly action: LayoutAction }
  | { readonly kind: "archive"; readonly root: EntryId }
  | { readonly kind: "restore"; readonly root: EntryId }
  | {
      readonly kind: "mark"
      readonly root: EntryId
      readonly title: string | null
    }
  | { readonly kind: "discardCard"; readonly card: CardId }
  | { readonly kind: "createCard"; readonly card: CardRecord }
  | {
      readonly kind: "queueCard"
      readonly card: CardId
      readonly lane: LaneName
      readonly at: Position
    }
  | {
      readonly kind: "unqueueCard"
      readonly card: CardId
      readonly lane: LaneName
      readonly by: WriterId
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
      return planColumn(intent.position, intent.act, state, fresh)
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
  }
}

/**
 * Show entry `id` (`planOpen`): in view in the column that shows it, in a new
 * column beside the one sharing most of its path, or, in an archived root,
 * in the Archive tab's preview. An entry of an ask's work opens the ask's
 * fold first, whatever the column's density, so it is drawn to be revealed
 * (ADR-0056): forks, branch starts and people's messages are never in one.
 */
function planOpenAt(
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
      const discard: readonly Effect[] =
        act.discard === null ? [] : [{ kind: "discardCard", card: act.discard }]
      if (active?.kind === "new")
        return [...discard, layout({ kind: "closeNewTab", key: active.key })]
      return [...discard, ...onRoot({ kind: "close", index: position })]
    }
    case "move":
      return onRoot({ kind: "move", from: position, to: act.to })
    case "density":
      return onRoot({ kind: "density", index: position, density: act.density })
    case "sent":
      return onColumn({ kind: "sent", key: act.key, sendId: act.sendId })
    case "reserve":
      return onColumn({ kind: "reserve", key: act.key, lane: act.lane })
    case "queue":
      return [{ kind: "queueCard", card: act.card, lane: act.lane, at: act.at }]
    case "unqueue":
      return [
        { kind: "unqueueCard", card: act.card, lane: act.lane, by: act.by },
      ]
    case "setCommand":
      return [{ kind: "setCommand", card: act.card, command: act.command }]
    case "bringUpToDate": {
      const { command } = act
      return [
        act.card === null
          ? { kind: "createCard", card: { ...act.create, command } }
          : { kind: "setCommand", card: act.card, command },
        { kind: "armFocus", key: act.key },
      ]
    }
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
