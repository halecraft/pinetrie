// client/move-undo — what undoing or redoing a move does (ADR-0052,
// ADR-0059). Pure.
//
// Undo never acts out of sight: each plan names where it shows before it
// acts, the place the card is going to. A handoff is undone by the reverse
// handoff, which the host refuses if the card has moved since; a swap in
// your inventory by swapping back, only while the two slots hold what it
// wrote. A plan that can already see it would be refused says why at once.

import {
  type ArchiveRecord,
  type CardRecord,
  type EntryId,
  keyOf,
  type LaneView,
  type Move,
  type PlaceKey,
  sameKey,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { archivedAt, placeEnd } from "@pineta/marginalia"
import type {
  HistoryEntry,
  HistoryStep,
  MoveHistory,
  Refusal,
} from "./card-moves.ts"
import { firstEmpty, type Slots } from "./inventory.ts"
import { type ClosedColumn, type Layout, tabOfColumn } from "./layout.ts"

type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A refusal before it is placed where it is said. */
export type RefusalWhy = OmitEach<Refusal, "actedAt">

/** Where an undo shows before it acts. */
export type Shown =
  | { readonly kind: "inventory" }
  /** A thread's end: shown as `openAt` shows an entry. */
  | { readonly kind: "entry"; readonly entry: EntryId }
  /** A fresh column still open. */
  | { readonly kind: "column"; readonly key: string }
  /** A fresh column closed since: reopened. */
  | { readonly kind: "reopen"; readonly closed: ClosedColumn }

export type UndoPlan =
  | { readonly kind: "none" }
  /** Nothing can be done: `entry` is dropped, and why is said at `show`. */
  | {
      readonly kind: "refused"
      readonly entry: HistoryEntry
      readonly show: Shown
      readonly why: RefusalWhy
    }
  | {
      readonly kind: "handoff"
      readonly show: Shown
      readonly move: Move
      /** The slot a move into your inventory asks for. */
      readonly slot: number | null
      readonly step: HistoryStep
    }
  | {
      readonly kind: "swap"
      readonly a: number
      readonly b: number
      readonly step: HistoryStep
    }
  /** Its place is in an archived root: ask before restoring it, then `plan`. */
  | { readonly kind: "ask"; readonly root: EntryId; readonly plan: UndoPlan }

export interface UndoState {
  /** The cards as drawn. */
  readonly cards: readonly CardRecord[]
  /** Your inventory's slots as drawn (`settleSlots`). */
  readonly slots: Slots
  readonly layout: Layout
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
  readonly me: WriterId
}

export type Direction = "undo" | "redo"

/** The newest entry `direction` acts on, and what it does. */
export function planUndo(
  direction: Direction,
  history: MoveHistory,
  state: UndoState,
): UndoPlan {
  const entry = (direction === "undo" ? history.undo : history.redo).at(-1)
  if (entry === undefined) return { kind: "none" }
  return entry.kind === "swap"
    ? planSwap(direction, entry, state.slots)
    : planHandoff(direction, entry, state)
}

function planSwap(
  direction: Direction,
  entry: Extract<HistoryEntry, { kind: "swap" }>,
  slots: Slots,
): UndoPlan {
  const holds = (slot: number, card: string | null) =>
    (slots[String(slot)] ?? null) === card
  const [atA, atB] = entry.cards
  const unchanged =
    direction === "undo"
      ? holds(entry.a, atA) && holds(entry.b, atB)
      : holds(entry.a, atB) && holds(entry.b, atA)
  if (!unchanged)
    return {
      kind: "refused",
      entry,
      show: { kind: "inventory" },
      why: { card: null, code: "slots-changed" },
    }
  return {
    kind: "swap",
    a: entry.a,
    b: entry.b,
    step: { kind: direction, entry },
  }
}

function planHandoff(
  direction: Direction,
  entry: Extract<HistoryEntry, { kind: "handoff" }>,
  state: UndoState,
): UndoPlan {
  const { move } = entry
  // A removal is never recorded; one here has nothing to reverse.
  if (move.to === null) return { kind: "none" }
  const created = move.from === null
  // A creation reverses to a removal, which has no redo.
  if (created && direction === "redo") return { kind: "none" }
  const planned: Move =
    direction === "undo"
      ? { card: move.card, from: move.to, to: move.from }
      : move
  const from = planned.from
  if (from === null) return { kind: "none" }
  const now = state.cards.find(c => c.id === move.card)
  const show = showOf(planned.to ?? from, entry.column, state)
  if (show === null)
    return {
      kind: "refused",
      entry,
      show: { kind: "inventory" },
      why: { card: move.card, code: "gone", by: null, fromQueue: false },
    }
  const refused = (why: RefusalWhy): UndoPlan => ({
    kind: "refused",
    entry,
    show: show.shown,
    why,
  })
  if (now === undefined)
    return refused({
      card: move.card,
      code: "gone",
      by: null,
      fromQueue: false,
    })
  if (!sameKey(keyOf(now.place), from))
    return refused({
      card: move.card,
      code: "moved",
      by: now.placer,
      fromQueue: false,
    })
  let slot: number | null = null
  if (planned.to?.kind === "inventory") {
    slot = firstEmpty(state.slots, entry.slot ?? undefined)
    if (slot === null)
      return refused({
        card: move.card,
        code: "full",
        by: null,
        fromQueue: false,
      })
  }
  const plan: UndoPlan = {
    kind: "handoff",
    show: show.shown,
    move: planned,
    slot,
    step:
      direction === "undo" && created
        ? { kind: "forget", entry }
        : { kind: direction, entry },
  }
  return show.archived === null
    ? plan
    : { kind: "ask", root: show.archived, plan }
}

/**
 * Where `key` is shown, and the archived root it is in, if any; null when it
 * cannot be shown: a thread end that is gone, or a fresh column closed with
 * nothing kept to reopen it.
 */
function showOf(
  key: PlaceKey,
  closed: ClosedColumn | null,
  state: UndoState,
): { readonly shown: Shown; readonly archived: EntryId | null } | null {
  switch (key.kind) {
    case "inventory":
      return { shown: { kind: "inventory" }, archived: null }
    case "fresh": {
      if (tabOfColumn(state.layout, key.column) !== undefined)
        return { shown: { kind: "column", key: key.column }, archived: null }
      if (closed === null || closed.column.key !== key.column) return null
      const { tab } = closed
      return {
        shown: { kind: "reopen", closed },
        archived:
          tab.kind === "root" &&
          state.archive.get(tab.root)?.state === "archived"
            ? tab.root
            : null,
      }
    }
    case "drafting":
    case "queued": {
      const end =
        placeEnd(key, state.me, state.lanes, state.index) ??
        (key.at.kind === "entry" ? key.at.id : null)
      if (end === null) return null
      const record = archivedAt(state.index, state.archive, end)
      return {
        shown: { kind: "entry", entry: end },
        archived: record === null ? null : record.root,
      }
    }
  }
}
