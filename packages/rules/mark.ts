// mark — a canvas's title, and the one plan for titling a canvas or a titled card.

import {
  type AgentId,
  type CanvasId,
  ERR,
  isAgentId,
  type Refusal,
  refused,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import {
  KINDS,
  kindOfCard,
  type MarkTarget,
  type TitledCardId,
} from "@pinetrie/threads"
import { Type } from "typebox"
import { CARD_TITLE, type CardTitleRecord } from "./card-title.ts"
import { AuthorSchema, parseCanvasKey, recordDecoder } from "./decode.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"

// The shape only: the host is the session's one writer, and stores only
// titles `parseTitle` accepted, so the title rule is not repeated here.
const MarkSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  by: AuthorSchema,
  at: Type.Number(),
})

/**
 * A canvas's title: a host-written `pinetrie.mark` value in the session, keyed by
 * the canvas's id, so a canvas has at most one.
 */
export interface MarkRecord {
  readonly canvas: CanvasId
  readonly title: string
  /** The person who set it, or the agent for a title it made unasked. */
  readonly by: WriterId | AgentId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

/** Each canvas's title, at the canvas's id. */
export const MARK: RecordSpec<
  MarkRecord,
  CanvasId,
  "session",
  typeof MarkSchema
> = {
  namespace: "pinetrie.mark",
  home: "session",
  keyOf: r => r.canvas,
  encode: ({ canvas, ...contents }) => contents,
  decode: recordDecoder(MarkSchema, parseCanvasKey, (r, canvas) => ({
    canvas,
    title: r.title,
    by: r.by,
    at: r.at,
  })),
}

type MarkPlan =
  | Refusal
  /** The title is already stored, or there is none to clear: nothing is written. */
  | { readonly kind: "unchanged" }
  /** The title's record written, or deleted to clear it. */
  | {
      readonly kind: "writes"
      readonly writes: readonly ValueWrite<"session">[]
    }

/**
 * Decide a mark: set a canvas's or a titled card's title, or clear it with
 * null. A canvas's title is in `MARK`, a card's in `CARD_TITLE`. A card's is
 * refused for a card in no place it is titled in (`titled`), and for the
 * agent where its kind is a person's alone to title (`KINDS`' `titled`).
 */
export function planMark(input: {
  readonly of: MarkTarget
  readonly title: string | null
  readonly by: WriterId | AgentId
  readonly now: number
  /** Every canvas the session holds. */
  readonly canvases: ReadonlySet<CanvasId>
  readonly marks: ReadonlyMap<CanvasId, MarkRecord>
  /** Every titled card that is on a canvas, in an inventory or in a column, and not trashed. */
  readonly titled: ReadonlySet<TitledCardId>
  readonly cardTitles: ReadonlyMap<TitledCardId, CardTitleRecord>
}): MarkPlan {
  const { of, title, by, now } = input
  switch (of.kind) {
    case "canvas": {
      const { canvas } = of
      if (!input.canvases.has(canvas))
        return refused(ERR.UNKNOWN_TARGET, "no such canvas to title")
      const stored = input.marks.get(canvas)?.title ?? null
      if (stored === title) return { kind: "unchanged" }
      return {
        kind: "writes",
        writes: [
          title === null
            ? deleteRecord(MARK, canvas)
            : setRecord(MARK, { canvas, title, by, at: now }),
        ],
      }
    }
    case "card": {
      const { card } = of
      const only = KINDS[kindOfCard(card)].titled
      if (!input.titled.has(card) || (isAgentId(by) && only === "person"))
        return refused(ERR.UNKNOWN_TARGET, "no such card to title")
      const stored = input.cardTitles.get(card)?.title ?? null
      if (stored === title) return { kind: "unchanged" }
      return {
        kind: "writes",
        writes: [
          title === null
            ? deleteRecord(CARD_TITLE, card)
            : setRecord(CARD_TITLE, { card, title, by, at: now }),
        ],
      }
    }
  }
}
