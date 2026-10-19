// canvas-pinned — the cards pinned to a canvas that a run reads.

import { type CanvasId, firstLine, type WriterId } from "@pinetrie/core"
import type { CanvasPinnedView, PinnedCardRead } from "@pinetrie/threads"
import { Type } from "typebox"
import { CanvasIdSchema, CardIdSchema, List, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { attribute, neutral, pinnedDiff, RETIRED_LINE } from "./pinned.ts"

export const CANVAS_PINNED_TYPE = "pinetrie.canvas-pinned"

const CanvasPinnedDetailsSchema = Type.Object({
  canvas: CanvasIdSchema,
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

/** The column draws its own marker for a canvas's cards entry, not pi's message. */
export const CANVAS_PINNED = historyMessage(
  CANVAS_PINNED_TYPE,
  CanvasPinnedDetailsSchema,
  false,
)

/** The pi `CustomMessage` a canvas's cards entry is stored as. */
export type CanvasPinnedMessage = HistoryMessage<
  typeof CANVAS_PINNED_TYPE,
  CanvasPinnedView
>

/** A stored message -> the canvas's cards it says a run read, or undefined. */
export const decodeCanvasPinned = (
  message: unknown,
): CanvasPinnedView | undefined => CANVAS_PINNED.decode(message)

/** What the model reads of `view`, each card named by its owner's display name. */
function canvasPinnedContent(
  view: CanvasPinnedView,
  nameOf: (writer: WriterId) => string,
): string {
  const cards =
    view.cards.length === 0
      ? "There are no cards pinned to the canvas now.\n"
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
    "<canvas-pinned-cards>\n" +
    "The cards pinned to the whole canvas, as they are now. They replace any earlier canvas-pinned cards.\n\n" +
    cards +
    (retired === "" ? "" : `\n${retired}`) +
    "</canvas-pinned-cards>"
  )
}

/** The canvas's cards entry for `view`. */
export const encodeCanvasPinned = (
  view: CanvasPinnedView,
  nameOf: (writer: WriterId) => string,
  timestamp: number,
): CanvasPinnedMessage =>
  CANVAS_PINNED.encode(
    {
      canvas: view.canvas,
      cards: view.cards.map(c => ({ id: c.id, text: c.text, by: c.by })),
      retired: view.retired.map(r => ({ id: r.id, line: r.line })),
    },
    canvasPinnedContent(view, nameOf),
    timestamp,
  )

/**
 * The cards pinned to `canvas` a run reads, or null when the model already
 * reads them as they are: every card read, none retired, the same order.
 * Cards read for another canvas (a thread moved since) are all
 * retired.
 */
export function planCanvasPinnedRead(input: {
  readonly inView: CanvasPinnedView | null
  readonly now: readonly PinnedCardRead[]
  readonly canvas: CanvasId
}): CanvasPinnedView | null {
  const inView = input.inView?.canvas === input.canvas ? input.inView : null
  const diff = pinnedDiff(inView, input.now)
  // What another canvas's entry said no longer applies here.
  const elsewhere =
    input.inView !== null && inView === null
      ? input.inView.cards.map(c => ({
          id: c.id,
          line: firstLine(c.text, RETIRED_LINE),
        }))
      : []
  const unchanged =
    [...diff.status.values()].every(s => s === "read") &&
    diff.retired.length === 0 &&
    elsewhere.length === 0 &&
    !diff.reordered
  if (unchanged) return null
  // A first entry with nothing pinned and nothing to retire says nothing.
  if (
    input.now.length === 0 &&
    diff.retired.length === 0 &&
    elsewhere.length === 0
  )
    return null
  return {
    canvas: input.canvas,
    cards: input.now,
    retired: [...diff.retired, ...elsewhere],
  }
}
