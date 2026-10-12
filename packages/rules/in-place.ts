// in-place — a card's actions in place, which change no key and so leave no
// trace and no history: a reorder, its width on a canvas, and its command.

import {
  type CanvasKey,
  type CardCommand,
  type CardId,
  type CardRecord,
  type CardWidth,
  KINDS,
  keyOf,
  placed,
  type Reorder,
  type ReorderAt,
  type ReorderRefusal,
  sameKey,
} from "@pinetrie/core"
import { byOrder, isOrdered, orderOf } from "./card.ts"
import { marginCards } from "./margin.ts"
import type { MoveStep, PlaceStep } from "./moves.ts"
import { notesIn } from "./notes.ts"
import { orderBetween, respace } from "./order.ts"
import { isPinned, queuedOn, taskPinnedOf } from "./queue.ts"
import { canvasOf } from "./task.ts"

// ── reorders ─────────────────────────────────────────────

/**
 * How a reorder works in one kind of place.
 * `siblings` are the cards a card there moves among, in order, itself
 * included; `adjacent`, whether its two neighbours must still be next to
 * each other there; `passesFacts`, whether it may pass a fact.
 */
interface ReorderRule<K extends ReorderAt["kind"]> {
  readonly siblings: (
    cards: readonly CardRecord[],
    at: Extract<ReorderAt, { readonly kind: K }>,
  ) => readonly CardRecord[]
  readonly adjacent: boolean
  readonly passesFacts: boolean
}

/**
 * Every place a reorder moves a card among (`REORDER_PLACES`), each with
 * its rule: a row for each, so a place added to that list does not compile
 * until its rule is written here.
 *
 * - A queue: its lane's queued cards, the two neighbours next to each
 *   other, and no passing a fact, which says what already happened.
 * - Pinned cards: every pinned card in the session, since pinned keys are
 *   the session's (`placeAt`). A thread's pinned cards are found through
 *   the tree, which this does not read, so other threads' may sit between
 *   two pinned neighbours: they need not be adjacent here.
 * - A task's pinned cards: its own, the neighbours next to each
 *   other.
 * - A note column: its notes, the neighbours next to each other.
 * - An entry's margin: its comments, the neighbours next to each
 *   other.
 * - A canvas: its task's cards (`canvasOf`), the neighbours next to each
 *   other.
 */
export const REORDERS: { readonly [K in ReorderAt["kind"]]: ReorderRule<K> } = {
  queued: {
    siblings: (cards, at) => queuedOn(cards, at.thread),
    adjacent: true,
    passesFacts: false,
  },
  pinned: {
    siblings: cards => cards.filter(isPinned).sort(byOrder),
    adjacent: false,
    passesFacts: true,
  },
  "task-pinned": {
    siblings: (cards, at) => taskPinnedOf(cards, at.task),
    adjacent: true,
    passesFacts: true,
  },
  note: {
    siblings: (cards, at) => notesIn(cards, at.column),
    adjacent: true,
    passesFacts: true,
  },
  margin: {
    siblings: (cards, at) => marginCards(cards, at.entry),
    adjacent: true,
    passesFacts: true,
  },
  canvas: {
    siblings: (cards, at) => canvasOf(cards, at.task),
    adjacent: true,
    passesFacts: true,
  },
}

/** The rule for a reorder at `at` (`REORDERS`). */
const reorderRule = (
  at: ReorderAt,
): {
  readonly siblings: (
    cards: readonly CardRecord[],
    at: ReorderAt,
  ) => readonly CardRecord[]
  readonly adjacent: boolean
  readonly passesFacts: boolean
} =>
  // Each row takes its own kind of key, and `at` is that kind's.
  REORDERS[at.kind] as ReorderRule<ReorderAt["kind"]> & {
    readonly siblings: (
      cards: readonly CardRecord[],
      at: ReorderAt,
    ) => readonly CardRecord[]
  }

/** `card` with order `order`, everything else as it is. */
const withOrder = (card: CardRecord, order: string): CardRecord =>
  isOrdered(card.place)
    ? (placed(card, { ...card.place, order }) ?? card)
    : card

/** What the host makes of a reorder: its steps, or why it refused it. */
export type ReorderStep =
  | PlaceStep
  | { readonly kind: "steps"; readonly steps: readonly PlaceStep[] }
  | {
      readonly kind: "refused"
      readonly code: ReorderRefusal
      /** The card as it is, or null when it is gone. */
      readonly now: CardRecord | null
    }

/** Whether a card stays where it is among its neighbours (`KINDS`): a fact. */
const staysPut = (card: CardRecord): boolean => !KINDS[card.kind].reordered

/**
 * A reorder: a queued or pinned card, a note, or a card on a canvas, moved
 * among its neighbours, as its sender saw them, by its place's rule
 * (`REORDERS`). Only its order changes: its placer, its queuer, its text's
 * version, why it was not sent and its width stay, so nobody's trace or history
 * changes with it. Refused:
 * - `gone`: no card;
 * - `fact`: a card of a kind `KINDS` does not reorder (a fact), or one
 *   that would pass one where its rule forbids it;
 * - `moved`: the card is no longer where its sender saw it;
 * - `order-changed`: it names no neighbour, a neighbour is no longer among
 *   its siblings, or, where its rule says so, the two are no longer next to
 *   each other.
 *
 * With no room between the neighbours, the crowded siblings around it are
 * given new keys in the same step (`respace`).
 */
export function planReorder(
  cards: readonly CardRecord[],
  reorder: Reorder,
): ReorderStep {
  const now = cards.find(c => c.id === reorder.card)
  if (now === undefined) return { kind: "refused", code: "gone", now: null }
  if (staysPut(now)) return { kind: "refused", code: "fact", now }
  if (!sameKey(keyOf(now.place), reorder.at))
    return { kind: "refused", code: "moved", now }
  const changed: ReorderStep = {
    kind: "refused",
    code: "order-changed",
    now,
  }
  const rule = reorderRule(reorder.at)
  const siblings = rule.siblings(cards, reorder.at).filter(c => c.id !== now.id)
  const find = (id: CardId | null): number | null | undefined => {
    if (id === null) return null
    const i = siblings.findIndex(c => c.id === id)
    return i < 0 ? undefined : i
  }
  const after = find(reorder.after)
  const before = find(reorder.before)
  if (after === undefined || before === undefined) return changed
  if (after === null && before === null) return changed
  // Where it goes among its siblings: just before `before`, else just after
  // `after`.
  const index = before ?? (after === null ? 0 : after + 1)
  if (after !== null && before !== null && after >= before) return changed
  if (rule.adjacent) {
    if (siblings[index - 1]?.id !== (reorder.after ?? undefined)) return changed
    if (siblings[index]?.id !== (reorder.before ?? undefined)) return changed
  }
  if (!rule.passesFacts) {
    // The cards it passes, from where it was to where it goes.
    const was = siblings.findIndex(c => byOrder(now, c) < 0)
    const from = was < 0 ? siblings.length : was
    const passed =
      index < from ? siblings.slice(index, from) : siblings.slice(from, index)
    if (passed.some(staysPut)) return { kind: "refused", code: "fact", now }
  }
  const bound = (i: number | null): string | null => {
    const c = i === null ? undefined : siblings[i]
    return c === undefined ? null : orderOf(c)
  }
  const order = orderBetween(bound(after), bound(before))
  if (order !== null) return { kind: "write", record: withOrder(now, order) }
  const made = respace(siblings.map(orderOf), index)
  return {
    kind: "steps",
    steps: [
      { kind: "write", record: withOrder(now, made.inserted) },
      ...[...made.changed].flatMap(([i, key]): PlaceStep[] => {
        const sibling = siblings[i]
        return sibling === undefined
          ? []
          : [{ kind: "write", record: withOrder(sibling, key) }]
      }),
    ],
  }
}

/**
 * A card's width on its canvas: one column or two, from where its
 * sender saw it (`at`), a compare-and-set as a reorder is. Only its width
 * changes: its rank and its placer stay, so nobody's trace or history of
 * the card changes with it. Refused `gone` with no card, and `moved` once
 * it is not on the canvas its sender saw. Null when it has that width
 * already: nothing to write.
 */
export function planWidth(
  cards: readonly CardRecord[],
  change: {
    readonly card: CardId
    readonly at: CanvasKey
    readonly width: CardWidth
  },
): MoveStep | null {
  const now = cards.find(c => c.id === change.card)
  if (now === undefined) return { kind: "refused", code: "gone", now: null }
  if (now.place.kind !== "canvas" || !sameKey(keyOf(now.place), change.at))
    return { kind: "refused", code: "moved", now }
  if (now.place.width === change.width) return null
  const record = placed(now, { ...now.place, width: change.width })
  return record === undefined
    ? { kind: "refused", code: "no-place", now }
    : { kind: "write", record }
}

/**
 * Set a text card's command, or clear it: its place and placer kept;
 * refused `no-place` for any other kind, which has none.
 */
export function planSetCommand(
  cards: readonly CardRecord[],
  card: CardId,
  command: CardCommand | null,
): MoveStep {
  const now = cards.find(c => c.id === card)
  if (now === undefined) return { kind: "refused", code: "gone", now: null }
  return now.kind !== "text"
    ? { kind: "refused", code: "no-place", now }
    : {
        kind: "write",
        record: { ...now, content: { ...now.content, command } },
      }
}
