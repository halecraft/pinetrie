// pinned — the pinned cards a run reads (ADR-0048, S92).
//
// A cards entry is a history message (`history.ts`): `content` is what the
// model reads, `details` what pinetrie reads back. The host plans one
// when a run starts and the thread's pinned cards differ from those the model
// last read on the path (`pinnedInView`, in @pinetrie/core), and pi writes it
// with the run's prompt, in the commit that admits the run. It restates every
// card pinned now, and names each card unpinned since, so the newest entry is
// all that holds.

import {
  type CardId,
  type CardRecord,
  firstLine,
  type PinnedCardRead,
  type PinnedView,
  type TextCardId,
  type ThreadId,
  textSourceOf,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { wordsOf } from "./card-words.ts"
import { CardIdSchema, List, ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"

export const PINNED_TYPE = "pinetrie.pinned"

/**
 * The line every agent thread's `<rules>` holds for pinned cards, a
 * thread's and a task's (ADR-0116). Constant, so the system prompt stays the
 * same between runs and an edited card keeps the cache.
 */
export const PINNED_RULE =
  "The team pins cards to say what it wants: from this thread in `<pinned-cards>` blocks, from the whole task in `<task-pinned-cards>` blocks. The latest of each is what holds."

const PinnedDetailsSchema = Type.Object({
  lane: ThreadIdSchema,
  cards: List(
    Type.Object({
      id: CardIdSchema,
      text: Type.String(),
      by: WriterIdSchema,
    }),
  ),
  retired: List(
    Type.Object({
      id: CardIdSchema,
      line: Type.String(),
    }),
  ),
})

/** The column draws its own marker for a cards entry, not pi's message. */
export const PINNED = historyMessage(PINNED_TYPE, PinnedDetailsSchema, false)

/** The pi `CustomMessage` a cards entry is stored as. */
export type PinnedMessage = HistoryMessage<typeof PINNED_TYPE, PinnedView>

/** A stored message -> the cards it says a run read, or undefined if it is not one. */
export const decodePinned = (message: unknown): PinnedView | undefined =>
  PINNED.decode(message)

/**
 * A card's closing tags, so a card cannot close the block the model is told
 * to trust: `</card>` becomes `<\/card>`, and the block's own the same.
 */
export const neutral = (text: string): string =>
  text.replace(/<\/(card|pinned-cards|task-pinned-cards|canvas)\b/gi, "<\\/$1")

export const attribute = (name: string): string =>
  name.replaceAll("&", "&amp;").replaceAll('"', "&quot;")

/** What the model reads of `view`, each card named by its owner's display name. */
export function pinnedContent(
  view: PinnedView,
  nameOf: (writer: WriterId) => string,
): string {
  const cards =
    view.cards.length === 0
      ? "There are no pinned cards now.\n"
      : view.cards
          .map(
            c =>
              `<card by="${attribute(nameOf(c.by))}">\n${neutral(c.text)}\n</card>\n`,
          )
          .join("\n")
  const retired = view.retired
    .map(r => `No longer applies: "${neutral(r.line)}"\n`)
    .join("")
  return (
    "<pinned-cards>\n" +
    "The pinned cards for this thread, as they are now. They replace any earlier pinned cards.\n\n" +
    cards +
    (retired === "" ? "" : `\n${retired}`) +
    "</pinned-cards>"
  )
}

/** The cards entry for `view`. */
export function encodePinned(
  view: PinnedView,
  nameOf: (writer: WriterId) => string,
  timestamp: number,
): PinnedMessage {
  return PINNED.encode(
    {
      lane: view.lane,
      cards: view.cards.map(c => ({ id: c.id, text: c.text, by: c.by })),
      retired: view.retired.map(r => ({ id: r.id, line: r.line })),
    },
    pinnedContent(view, nameOf),
    timestamp,
  )
}

/** How a pinned card stands against what the model last read. */
export type PinnedStatus =
  /** Read as it is now. */
  | "read"
  /** Read, and edited since. */
  | "changed"
  /** Not among the cards the model read. */
  | "unread"

interface PinnedDiff {
  /** Each card pinned now, by id. */
  readonly status: ReadonlyMap<CardId, PinnedStatus>
  /** Cards the model read that are no longer pinned, with their first line. */
  readonly retired: PinnedView["retired"]
  /** Whether the cards still pinned are in another order than the model read them. */
  readonly reordered: boolean
}

/** How long a retired card's line is, as the model reads it. */
export const RETIRED_LINE = 80

/**
 * The one comparison of the cards pinned now with those the model last read
 * (`pinnedInView`): the host plans a run's cards entry from it, and the
 * column shows each card's status from it. By id, then text, so a card
 * swapped for another with the same text is unread. Pure.
 */
export function pinnedDiff(
  inView: Pick<PinnedView, "cards"> | null,
  now: readonly PinnedCardRead[],
): PinnedDiff {
  const read = new Map((inView?.cards ?? []).map(c => [c.id, c] as const))
  const pinned = new Set(now.map(c => c.id))
  const status = new Map<CardId, PinnedStatus>(
    now.map(c => {
      const seen = read.get(c.id)
      return [
        c.id,
        seen === undefined
          ? "unread"
          : seen.text === c.text
            ? "read"
            : "changed",
      ]
    }),
  )
  const retired = (inView?.cards ?? [])
    .filter(c => !pinned.has(c.id))
    .map(c => ({ id: c.id, line: firstLine(c.text, RETIRED_LINE) }))
  const before = (inView?.cards ?? [])
    .filter(c => pinned.has(c.id))
    .map(c => c.id)
  const after = now.filter(c => read.has(c.id)).map(c => c.id)
  return {
    status,
    retired,
    reordered: before.some((id, i) => after[i] !== id),
  }
}

/**
 * The cards a run on `lane` reads, or null when the model already reads
 * them as they are: every card read, none retired, and the same order. A
 * branch's first run needs no rule of its own: its path holds its parent's
 * cards and its thread none, so they are all retired. Pure.
 */
export function planPinnedRead(input: {
  readonly inView: PinnedView | null
  readonly now: readonly PinnedCardRead[]
  readonly lane: ThreadId
}): PinnedView | null {
  const diff = pinnedDiff(input.inView, input.now)
  const unchanged =
    [...diff.status.values()].every(s => s === "read") &&
    diff.retired.length === 0 &&
    !diff.reordered
  return unchanged
    ? null
    : { lane: input.lane, cards: input.now, retired: diff.retired }
}

/**
 * A thread's pinned cards as a run reads them, in order: each with its words
 * (`wordsOf`) and owner. A card with no text yet is left out: the model would read an
 * empty card. The host reads a run's cards with it, and the column each
 * card's status, so the two agree on which cards count. Pure.
 */
export const pinnedReads = (
  pinned: readonly CardRecord[],
  docText: (card: TextCardId) => string,
): PinnedCardRead[] =>
  pinned.flatMap(c => {
    // A reference is never pinned (`KINDS`): no quote is read here.
    const text = wordsOf(textSourceOf(c), { doc: docText, blob: () => "" })
    return text.trim() === "" ? [] : [{ id: c.id, text, by: c.owner }]
  })
