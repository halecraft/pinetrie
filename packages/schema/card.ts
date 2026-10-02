// schema/card — the cards document (ADR-0048): every card's record, written
// by clients.
//
// A card's text is its own `TextDoc` (`card:<id>`); its record, here, says
// where it is and whose it is. Clients write both directly: the host writes
// this document only to take a queued card, to write back one it could not
// send, and to sweep empty ones when it starts. It is Yjs
// because several clients write it at once. Each card is a struct of flat
// strings, written whole when the card is created and never set whole again:
// a whole-record set concurrent with the host's delete brings a spent card
// back, where a field write loses to it (S58). Keys are card ids, uuidv7, so
// no two writers create one key (ADR-0016). A field added after cards were
// first stored is missing from older records, and `decodeCard` reads it as "".

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
        /** `drafting`, `queued` or `fresh`: the place's kind (`CardPlace`). */
        kind: Schema.string(),
        /** A drafting or queued card's entry, "" for none. */
        at: Schema.string(),
        /** A drafting or queued card's lane, "" for none. */
        lane: Schema.string(),
        /** A fresh card's column key, "" for none. */
        column: Schema.string(),
        /** A queued card's place in its lane's queue (S69), "" for none. */
        order: Schema.string(),
        /** Who queued it, "" for none. */
        by: Schema.string(),
        /** Its command (ADR-0055), "" for none. */
        command: Schema.string(),
        /** Why the host could not send it, "" for none. */
        unsent: Schema.string(),
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
