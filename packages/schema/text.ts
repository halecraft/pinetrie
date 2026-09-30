// schema/text — the text people type together: one Yjs document per note
// (ADR-0025) and per card (ADR-0048), and who wrote in it.
//
// Typed text is the one thing people edit together, so it is a CRDT
// (ADR-0023); a note's record is a host-written session value (`pineta.note`),
// and a card's is in the cards document (`card.ts`). Kyneta gives each peer's
// Yjs `clientID` from its seat (`yjsClientId`), so the operations in a text
// say which seat wrote them, and the seat's principal says who that is
// (ADR-0037). The host writes that down once per seat (`pineta.seat`), so
// anyone can name a text's writers after they have gone.
//
// A text's document is never compacted: Kyneta cannot compact a live Yjs
// document (S24). A spent card's is destroyed instead.

import { type BoundSchema, type DocRef, Schema, unwrap } from "@kyneta/schema"
import { yjs, yjsClientId } from "@kyneta/yjs-schema"
import {
  type NoteId,
  noteId,
  type WriterId,
  writerOfPrincipal,
} from "@pineta/core"

export const TextDoc = yjs.bind(Schema.struct({ text: Schema.text() }))

/** A text's document, as the Exchange gives it. */
export type TextDocHandle =
  typeof TextDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

const NOTE_PREFIX = "note:"

/** The document holding a note's text. */
export const noteDocId = (id: NoteId): string => `${NOTE_PREFIX}${id}`

/** A document id -> the note whose text it holds, or undefined for any other document. */
export const noteIdOfDoc = (docId: string): NoteId | undefined =>
  docId.startsWith(NOTE_PREFIX) && docId.length > NOTE_PREFIX.length
    ? noteId(docId.slice(NOTE_PREFIX.length))
    : undefined

/**
 * A seat's Yjs `clientID` and the person behind it, or null for a seat whose
 * principal is no email: the host's among them. The one place a seat becomes
 * a person; the host's seat records (`pineta.seat`) come from it, and a
 * note's and a card's writers from those.
 */
export const seatOf = (
  peerId: string,
  principal: string,
): { readonly clientId: number; readonly writer: WriterId } | null => {
  const writer = writerOfPrincipal(principal)
  return writer === undefined ? null : { clientId: yjsClientId(peerId), writer }
}

/**
 * The `clientID`s that wrote in a text, every one that ever did, deletions
 * included. Kyneta writes a structural seed under `clientID` 0 before anyone
 * types (S58), which is nobody's and left out.
 */
export const textClients = (doc: TextDocHandle): number[] => {
  const clients: ReadonlyMap<number, unknown> = (
    unwrap(doc) as { store: { clients: ReadonlyMap<number, unknown> } }
  ).store.clients
  return [...clients.keys()].filter(c => c !== 0)
}
