// schema/places — where every card is (ADR-0059): written only by the host.
//
// A card's text is its own `TextDoc` (`card:<id>`), written by clients; its
// record, here, says where it is and whose it is. A place does not merge
// (S75), so the host writes this document alone, in arrival order, through
// handoffs it applies or refuses. It is `json`, like the session: one
// writer, compacted. A client cannot write it: every peer declares the host
// its only writer (`writersPolicy`), so a client's write throws before it is
// made, where it would otherwise fork that client's copy for good (S28, S76).

import {
  type BoundSchema,
  createDoc,
  type DocRef,
  json,
  Schema,
} from "@kyneta/schema"
import { type CardId, cardId } from "@pineta/core"

/**
 * A card's record as flat strings, "" for none, decoded in
 * `@pineta/marginalia` (`decodeCard`). One leaf (`.json()`), since the host
 * always writes a record whole.
 */
const StoredCard = Schema.struct.json({
  owner: Schema.string(),
  /** `drafting`, `queued`, `fresh` or `inventory`: the place's kind (`CardPlace`). */
  kind: Schema.string(),
  /** A drafting or queued card's entry. */
  at: Schema.string(),
  /** A drafting or queued card's lane. */
  lane: Schema.string(),
  /** A fresh card's column key. */
  column: Schema.string(),
  /** A queued card's place in its lane's queue (S69). */
  order: Schema.string(),
  /** Who queued it. */
  by: Schema.string(),
  /** A queued card's text version as its queuer had it (`textVersion`, S72). */
  seen: Schema.string(),
  /** Its command (ADR-0055). */
  command: Schema.string(),
  /** Why the host could not send it. */
  unsent: Schema.string(),
  /** Who put it where it is. */
  placer: Schema.string(),
  /** Whose inventory holds it. */
  holder: Schema.string(),
})

export const PlacesDoc = json.bind(
  Schema.struct({
    /**
     * Raised with every write to `cards`, in the same batch. A reply to a
     * move carries it, and a client draws its move until its copy reaches
     * that number (ADR-0059): the reply and this document's change reach the
     * client separately, in either order.
     */
    rev: Schema.number(),
    cards: Schema.record(StoredCard),
  }),
)

/** The places document, as the Exchange gives it. */
export type PlacesDocHandle =
  typeof PlacesDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** A places document on its own, with no Exchange: for tests. */
export const newPlacesDoc = (): PlacesDocHandle => createDoc(PlacesDoc)

const CARD_PREFIX = "card:"

/** The document holding a card's text. */
export const cardDocId = (id: CardId): string => `${CARD_PREFIX}${id}`

/** A document id -> the card whose text it holds, or undefined for any other document. */
export const cardIdOfDoc = (docId: string): CardId | undefined =>
  docId.startsWith(CARD_PREFIX) && docId.length > CARD_PREFIX.length
    ? cardId(docId.slice(CARD_PREFIX.length))
    : undefined
