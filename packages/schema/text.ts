// schema/text — the text people type together: one Yjs document per card
// (ADR-0048), and who wrote in it.
//
// Typed text is the one thing people edit together, so it is a CRDT
// (ADR-0023); a card's record is in the cards document (`card.ts`). Kyneta gives each peer's
// Yjs `clientID` from its seat (`yjsClientId`), so the operations in a text
// say which seat wrote them, and the seat's principal says who that is
// (ADR-0037). The host writes that down once per seat (`pineta.seat`), so
// anyone can name a text's writers after they have gone.
//
// A text's document is never compacted: Kyneta cannot compact a live Yjs
// document (S24). A spent card's is destroyed instead.

import { type BoundSchema, type DocRef, Schema, unwrap } from "@kyneta/schema"
import { yjs, yjsClientId } from "@kyneta/yjs-schema"
import { type WriterId, writerOfPrincipal } from "@pineta/core"

export const TextDoc = yjs.bind(Schema.struct({ text: Schema.text() }))

/** A text's document, as the Exchange gives it. */
export type TextDocHandle =
  typeof TextDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/**
 * A seat's Yjs `clientID` and the person behind it, or null for a seat whose
 * principal is no email: the host's among them. The one place a seat becomes
 * a person; the host's seat records (`pineta.seat`) come from it, and a
 * card's writers from those.
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
