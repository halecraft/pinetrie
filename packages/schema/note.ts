// schema/note — a note's text: one Yjs document per note (ADR-0025).
//
// Notes are the one place people type together, so their text is a CRDT
// (ADR-0023); the note's record is a host-written session value
// (`pineta.note`). Kyneta gives each peer's Yjs `clientID` from its seat
// (`yjsClientId`), so the operations in a note say which seat wrote them, and
// the seat's principal says who that is (ADR-0037): the host derives
// contributors from them, and needs nothing from the client.
//
// A note's document is never compacted: Kyneta cannot compact a live Yjs
// document (S24). At note sizes its history is small.

import { type BoundSchema, type DocRef, Schema } from "@kyneta/schema"
import { yjs, yjsClientId } from "@kyneta/yjs-schema"
import {
  type NoteId,
  noteId,
  type WriterId,
  writerOfPrincipal,
} from "@pineta/core"

export const NoteDoc = yjs.bind(Schema.struct({ text: Schema.text() }))

/** A note's document, as the Exchange gives it. */
export type NoteDocHandle =
  typeof NoteDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

const NOTE_PREFIX = "note:"

/** The document holding a note's text. */
export const noteDocId = (id: NoteId): string => `${NOTE_PREFIX}${id}`

/** A document id -> the note whose text it holds, or undefined for any other document. */
export const noteIdOfDoc = (docId: string): NoteId | undefined =>
  docId.startsWith(NOTE_PREFIX) && docId.length > NOTE_PREFIX.length
    ? noteId(docId.slice(NOTE_PREFIX.length))
    : undefined

/**
 * Each seat's Yjs `clientID`, mapped to the person behind it. A seat whose
 * principal is no email is nobody's, as is any `clientID` not listed: the
 * host's own among them.
 */
export const noteAuthors = (
  seats: Iterable<{ readonly peerId: string; readonly principal: string }>,
): ReadonlyMap<number, WriterId> =>
  new Map(
    [...seats].flatMap(({ peerId, principal }) => {
      const writer = writerOfPrincipal(principal)
      return writer === undefined ? [] : [[yjsClientId(peerId), writer]]
    }),
  )
