// schema/card — the cards document (ADR-0048): every card's record, written
// by clients.
//
// A card's text is its own `TextDoc` (`card:<id>`); its record, here, says
// where it is and whose it is. Clients write both directly: the host writes
// this document only to spend a card, when it becomes a message, and to
// sweep empty ones when it starts. It is Yjs
// because several clients write it at once. Each card is a struct of flat
// strings, written whole when the card is created and never set whole again:
// a whole-record set concurrent with the host's delete brings a spent card
// back, where a field write loses to it (S58). Keys are card ids, uuidv7, so
// no two writers create one key (ADR-0016).

import {
  type BoundSchema,
  createDoc,
  type DocRef,
  Schema,
} from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { type CardId, cardId } from "@pineta/core"

export const CardsDoc = yjs.bind(
  Schema.struct({
    cards: Schema.record(
      Schema.struct({
        owner: Schema.string(),
        /** `drafting` or `fresh`: the place's kind (`CardPlace`). */
        kind: Schema.string(),
        /** A drafting card's entry, "" for none. */
        at: Schema.string(),
        /** A drafting card's lane, "" for none. */
        lane: Schema.string(),
        /** A fresh card's column key, "" for none. */
        column: Schema.string(),
      }),
    ),
  }),
)

/** The cards document, as the Exchange gives it. */
export type CardsDocHandle =
  typeof CardsDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** A cards document on its own, with no Exchange: for tests. */
export const newCardsDoc = (): CardsDocHandle => createDoc(CardsDoc)

const CARD_PREFIX = "card:"

/** The document holding a card's text. */
export const cardDocId = (id: CardId): string => `${CARD_PREFIX}${id}`

/** A document id -> the card whose text it holds, or undefined for any other document. */
export const cardIdOfDoc = (docId: string): CardId | undefined =>
  docId.startsWith(CARD_PREFIX) && docId.length > CARD_PREFIX.length
    ? cardId(docId.slice(CARD_PREFIX.length))
    : undefined
