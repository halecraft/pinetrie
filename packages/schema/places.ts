// schema/places — where every card is, and whose: written only by the host.
//
// A place does not merge, so the host writes this document alone, in arrival
// order. It is Yjs, so the host's undo stacks can undo a move whole or refuse
// it. It grows about 25 bytes a move for good: compaction gives none of it
// back. Every peer declares the host its only writer (`writersPolicy`), so a
// client's write throws before it is made, where it would otherwise fork that
// client's copy for good.

import {
  type BoundSchema,
  createDoc,
  type DocRef,
  Schema,
} from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { type TextCardId, textCardId } from "@pinetrie/core"

/**
 * A card's record as flat strings, "" for none, decoded in
 * `@pinetrie/rules` (`decodeCard`). One leaf (`.json()`), since the host
 * always writes a record whole.
 */
const StoredCard = Schema.struct.json({
  owner: Schema.string(),
  /** `drafting`, `note`, `pinned`, `queued`, `margin`, `canvas`, `inventory`, `board` or `discarded`: the place's kind (`CardPlace`). */
  kind: Schema.string(),
  /** A comment's entry. */
  at: Schema.string(),
  /** A card at a thread's thread, which names its lane. */
  lane: Schema.string(),
  /** A note's note column. */
  column: Schema.string(),
  /** A queued, pinned, canvas or board card's rank, or a note's in its column. */
  order: Schema.string(),
  /** Who queued it. */
  by: Schema.string(),
  /** A queued card's text version as its queuer had it (`textVersion`). */
  seen: Schema.string(),
  /** Its command. */
  command: Schema.string(),
  /**
   * The fact it carries, as JSON; absent from a record stored
   * before facts were, which reads as a message.
   */
  fact: Schema.string(),
  /** An ask card's relay, as JSON. */
  relay: Schema.string(),
  /** Why the host could not send it. */
  unsent: Schema.string(),
  /** Who put it where it is. */
  placer: Schema.string(),
  /** Whose inventory or trash holds it. */
  holder: Schema.string(),
  /** A canvas card's, or a trashed card's, task. */
  task: Schema.string(),
  /** A canvas card's width: `1` or `2` columns. */
  width: Schema.string(),
  /** A task's card's workflow state on the board. */
  state: Schema.string(),
  /** A reference's address, printed (`printAddress`). */
  address: Schema.string(),
  /** A reference's quote's blob: its markdown's SHA-256. */
  quote: Schema.string(),
  /** A text card's origin, a printed address: "" for none. */
  origin: Schema.string(),
})

const placesSchema = Schema.struct({
  /**
   * Raised after every write to `cards`, in a batch of its own: raised
   * inside an undo step, it would refuse every whole undo. A reply to
   * a move carries it, and a client draws its move until its copy reaches
   * that number: the reply and this document's change reach the
   * client separately, in either order.
   */
  rev: Schema.number(),
  cards: Schema.record(StoredCard),
})

export const PlacesDoc = yjs.bind(placesSchema)

/** The places document, as the Exchange gives it. */
export type PlacesDocHandle =
  typeof PlacesDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/** A places document on its own, with no Exchange: for tests. */
export const newPlacesDoc = (): PlacesDocHandle => createDoc(PlacesDoc)

const CARD_PREFIX = "card:"

/** The document holding a text card's text. */
export const cardDocId = (id: TextCardId): string => `${CARD_PREFIX}${id}`

/** A document id -> the text card whose text it holds, or undefined for any other document. */
export const cardIdOfDoc = (docId: string): TextCardId | undefined =>
  docId.startsWith(CARD_PREFIX) && docId.length > CARD_PREFIX.length
    ? textCardId(docId.slice(CARD_PREFIX.length))
    : undefined
