// protocol/writers — who may write each document, declared once and
// registered on every peer: the host and every client (Kyneta's `canWrite`).
//
// Kyneta judges `canWrite` against a peer's own identity for its local writes,
// and against the sender of every offer. So one declaration refuses a client's
// write to the places before anything is applied, rather than letting the
// write diverge that client's copy for good (S28, S76), and refuses the same
// operations arriving from anyone else. It judges the sender, not the author:
// the host relays an inventory between its person's tabs, so the host is one
// of its writers, though it never writes one (ADR-0059).

import type { Policy } from "@kyneta/exchange"
import {
  MOVES_DOC_PREFIX,
  rootOfDocId,
  type WriterId,
  writerOfPrincipal,
} from "@pineta/core"
import {
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "./messages.ts"

/**
 * Whether only the host writes `docId`: the session, the places, what is
 * streaming, every root's document, and its stacks of people's moves
 * (ADR-0023, ADR-0059, ADR-0063, ADR-0066).
 */
export const isHostDoc = (docId: string): boolean =>
  docId === SESSION_DOC_ID ||
  docId === PLACES_DOC_ID ||
  docId === LIVE_DOC_ID ||
  rootOfDocId(docId) !== undefined ||
  docId.startsWith(MOVES_DOC_PREFIX)

const INVENTORY_PREFIX = "inventory:"

/** The document holding `writer`'s inventory slots (ADR-0059). */
export const inventoryDocId = (writer: WriterId): string =>
  `${INVENTORY_PREFIX}${writer}`

/**
 * A document id -> whose inventory it is, or undefined for any other
 * document: only an id `inventoryDocId` makes names a writer.
 */
export function writerOfInventoryDoc(docId: string): WriterId | undefined {
  if (!docId.startsWith(INVENTORY_PREFIX)) return undefined
  const rest = docId.slice(INVENTORY_PREFIX.length)
  const writer = rest.startsWith("w-")
    ? writerOfPrincipal(rest.slice(2))
    : undefined
  return writer !== undefined && inventoryDocId(writer) === docId
    ? writer
    : undefined
}

/**
 * Whether the peer whose principal is `principal` is the person whose
 * inventory `docId` is; undefined for any other document. Pure.
 */
export function holdsInventory(
  docId: string,
  principal: string | undefined,
): boolean | undefined {
  const holder = writerOfInventoryDoc(docId)
  return holder === undefined
    ? undefined
    : writerOfPrincipal(principal) === holder
}

/**
 * Whether the peer whose principal is `principal` may write `docId`;
 * undefined leaves it to the other policies. The session, the places and
 * `pineta:live` are the host's (`isHostDoc`); an inventory is its person's,
 * relayed by the host. Pure.
 */
export function mayWrite(
  docId: string,
  principal: string | undefined,
): boolean | undefined {
  if (isHostDoc(docId)) return principal === HOST_PRINCIPAL
  const holds = holdsInventory(docId, principal)
  if (holds === undefined) return undefined
  return principal === HOST_PRINCIPAL || holds
}

/** `mayWrite` as a Kyneta policy, for the host and every client to register. */
export const writersPolicy: Policy = {
  name: "pineta.writers",
  canWrite: (docId, peer) => mayWrite(docId, peer.principal),
}
