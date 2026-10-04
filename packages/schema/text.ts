// schema/text — the text people type together: one Yjs document per card
// (ADR-0048), and who wrote in it.
//
// Typed text is the one thing people edit together, so it is a CRDT
// (ADR-0023); a card's record is in the places document (`places.ts`). Kyneta gives each peer's
// Yjs `clientID` from its seat (`yjsClientId`), so the operations in a text
// say which seat wrote them, and the seat's principal says who that is
// (ADR-0037). The host writes that down once per seat (`pineta.seat`), so
// anyone can name a text's writers after they have gone.
//
// A text's document is never compacted: Kyneta cannot compact a live Yjs
// document (S24). A spent card's is destroyed instead.

import {
  type BoundSchema,
  type DocRef,
  Schema,
  unwrap,
  version,
} from "@kyneta/schema"
import { YjsVersion, yjs, yjsClientId } from "@kyneta/yjs-schema"
import { type WriterId, writerOfPrincipal } from "@pineta/core"

export const TextDoc = yjs.bind(Schema.struct({ text: Schema.text() }))

/** A text's document, as the Exchange gives it. */
export type TextDocHandle =
  typeof TextDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

/**
 * A seat's peer, its Yjs `clientID` and the person behind it, or null for a
 * seat whose principal is no email: the host's among them. The one place a seat becomes
 * a person; the host's seat records (`pineta.seat`) come from it, and a
 * card's writers from those.
 */
export const seatOf = (
  peerId: string,
  principal: string,
): {
  readonly peer: string
  readonly clientId: number
  readonly writer: WriterId
} | null => {
  const writer = writerOfPrincipal(principal)
  return writer === undefined
    ? null
    : { peer: peerId, clientId: yjsClientId(peerId), writer }
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

/**
 * The text's version, serialized: what a client writes on a card it queues,
 * so the host takes the card only once it holds that much of the text.
 * Kyneta keeps no order between documents, so a card's record can reach the
 * host before the text typed just before it (S96).
 */
export const textVersion = (doc: TextDocHandle): string =>
  version(doc).serialize()

/**
 * Whether this copy of the text holds everything in `seen` (`textVersion`):
 * equal or ahead. "" (a card queued before versions were written) is held.
 * A version this build cannot read is held too: nothing would ever come to
 * wait for.
 */
export function textHolds(doc: TextDocHandle, seen: string): boolean {
  if (seen === "") return true
  let wanted: YjsVersion
  try {
    wanted = YjsVersion.parse(seen)
  } catch {
    return true
  }
  const order = version(doc).compare(wanted)
  return order === "equal" || order === "ahead"
}
