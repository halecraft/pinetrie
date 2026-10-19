// card-title — the title of a card with one of its own: a note column's, a
// media column's or an image's (`KINDS`' `titled`). A canvas's title is a
// mark (`mark.ts`).

import type { AgentId, WriterId } from "@pinetrie/core"
import {
  type CardRecord,
  isTitledCardId,
  type TitledCardId,
} from "@pinetrie/threads"
import { Type } from "typebox"
import { decodeRecord, titledCardKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

// The shape only: the host stores only titles `parseTitle` accepted.
const CardTitleSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  by: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/**
 * A card's title: a host-written `pinetrie.card-title` value in the session,
 * keyed by the card's id, absent while untitled. Who made the card is its
 * owner, and when is in its id.
 */
export interface CardTitleRecord {
  readonly card: TitledCardId
  readonly title: string
  /** Who set it: a person, or the agent where its kind allows. */
  readonly by: WriterId | AgentId
  /** When it was set, in ms since the epoch. */
  readonly at: number
}

/** Each titled card's title, at its id. */
export const CARD_TITLE: RecordSpec<CardTitleRecord, TitledCardId, "session"> =
  {
    namespace: "pinetrie.card-title",
    home: "session",
    keyOf: r => r.card,
    encode: ({ card, ...contents }) => contents,
    decode: (contents, key) =>
      decodeRecord(
        CardTitleSchema,
        contents,
        titledCardKey(key),
        (r, card) => ({
          card,
          title: r.title,
          // A writer id always starts `w-` (`writerId`), so neither is read as the other.
          by: r.by as WriterId | AgentId,
          at: r.at,
        }),
      ),
  }

/** Every titled card anyone may title now: any not in a trash. */
export const titledCards = (
  cards: readonly CardRecord[],
): ReadonlySet<TitledCardId> =>
  new Set(
    cards.flatMap(c =>
      c.place.kind !== "trash" && isTitledCardId(c.id) ? [c.id] : [],
    ),
  )
