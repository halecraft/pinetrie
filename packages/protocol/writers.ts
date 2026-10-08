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
} from "@pinetrie/core"
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

/**
 * A person's own documents (ADR-0059, ADR-0077, ADR-0122): their inventory,
 * what they have dealt with, and the roots they have open. Only that person's tabs
 * write one, and the host stores it and shares it with that person only.
 * Each kind is its own document, since each is written at its own rate and
 * keeps its own history.
 */
export const PERSON_DOC_KINDS = ["inventory", "attention", "open"] as const
export type PersonDocKind = (typeof PERSON_DOC_KINDS)[number]

/** The document holding `writer`'s `kind`: `inventory:w-ada@x.io`. */
export const personDocId = (kind: PersonDocKind, writer: WriterId): string =>
  `${kind}:${writer}`

/**
 * A document id -> whose document of which kind it is, or undefined for any
 * other document: only an id `personDocId` makes names a writer.
 */
export function ownerOfPersonDoc(
  docId: string,
): { readonly kind: PersonDocKind; readonly writer: WriterId } | undefined {
  const cut = docId.indexOf(":")
  const kind = PERSON_DOC_KINDS.find(k => k === docId.slice(0, cut))
  if (kind === undefined) return undefined
  const rest = docId.slice(cut + 1)
  const writer = rest.startsWith("w-")
    ? writerOfPrincipal(rest.slice(2))
    : undefined
  return writer !== undefined && personDocId(kind, writer) === docId
    ? { kind, writer }
    : undefined
}

/**
 * Whether the peer whose principal is `principal` is the person whose
 * document `docId` is; undefined for any other document. Pure.
 */
export function holdsPersonDoc(
  docId: string,
  principal: string | undefined,
): boolean | undefined {
  const owner = ownerOfPersonDoc(docId)
  return owner === undefined
    ? undefined
    : writerOfPrincipal(principal) === owner.writer
}

/**
 * Whether the peer whose principal is `principal` may write `docId`;
 * undefined leaves it to the other policies. The session, the places and
 * `pinetrie:live` are the host's (`isHostDoc`); a person's document is that
 * person's, relayed by the host. Pure.
 */
export function mayWrite(
  docId: string,
  principal: string | undefined,
): boolean | undefined {
  if (isHostDoc(docId)) return principal === HOST_PRINCIPAL
  const holds = holdsPersonDoc(docId, principal)
  if (holds === undefined) return undefined
  return principal === HOST_PRINCIPAL || holds
}

/** `mayWrite` as a Kyneta policy, for the host and every client to register. */
export const writersPolicy: Policy = {
  name: "pinetrie.writers",
  canWrite: (docId, peer) => mayWrite(docId, peer.principal),
}
