// schema/note — a note's text: one Yjs document per note (ADR-0025).
//
// Notes are the one place people type together, so their text is a CRDT
// (ADR-0023); the note's record is a host-written session value
// (`pineta.note`). Kyneta gives each peer's Yjs `clientID` from its peer id,
// so the operations in a note say who wrote them (S26 addendum): the host
// derives contributors from them, and needs nothing from the client.
//
// A note's document is never compacted: Kyneta cannot compact a live Yjs
// document (S24). At note sizes its history is small.

import { type BoundSchema, type DocRef, Schema } from "@kyneta/schema"
import { yjs } from "@kyneta/yjs-schema"
import { type NoteId, noteId, peerIdOf, type WriterId } from "@pineta/core"

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
 * The Yjs `clientID` Kyneta gives a peer: FNV-1a over its id, 32 bits, with 0
 * kept for structure. A copy of Kyneta's `hashPeerId`, which it does not
 * export; `note.test.ts` pins it to a real document, so drift fails a test.
 */
export function clientIdOf(peerId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < peerId.length; i++) {
    hash ^= peerId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const id = hash >>> 0
  return id === 0 ? 1 : id
}

/** Each writer, keyed by the `clientID` their edits carry. */
export const noteAuthors = (
  writers: Iterable<WriterId>,
): ReadonlyMap<number, WriterId> =>
  new Map([...writers].map(w => [clientIdOf(peerIdOf(w)), w]))
