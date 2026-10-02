// host/policy — which documents a client may write, which it may hold, and
// which the host takes in when a client creates them.
//
// The host is the session's only writer (ADR-0023): clients send commands,
// and a write to the session document from a client is refused. So is one to
// the places document: a card's place is the host's to write, through
// handoffs (ADR-0059). Presence is written by each client (ADR-0024). Every
// card's text is accepted from anyone (ADR-0048), since a refused write
// cannot be recovered from (S28): the writer keeps its own value for good
// (S76). A tab's undo stack is its own: the host neither holds nor relays it.
// A person's inventory is theirs: shared with and taken from only the peers
// whose principal is that person (ADR-0059). `resolve` fires only for a peer
// `canShare` grants (S76), so nobody else can create it either. A principal
// is what a peer says it is (ADR-0037), so this keeps it from honest clients
// only.
//
// A command Line's documents belong to its two ends, the host and one client
// seat (ADR-0037): no other client may hold or write them. Kyneta's default
// shares every document with every peer, which would hand each client
// everyone's commands and replies, and would offer a departed seat's Line back
// to the host after the host destroyed it. Every other document is left to
// Kyneta's default.

import { type Policy, routeLine } from "@kyneta/exchange"
import { writerOfPrincipal } from "@pineta/core"
import {
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { cardIdOfDoc, writerOfInventoryDoc } from "@pineta/schema"

const isUndo = (docId: string): boolean => docId.startsWith("undo:")

/**
 * What the host makes of a document a client announces and the host does not
 * hold: a card's text, a person's inventory, or a tab's undo stack to reject.
 * Undefined leaves it to Kyneta's default. Without this, a document the host
 * never opened itself would be neither stored nor relayed (S58). Pure.
 */
export function resolveDoc(
  docId: string,
): "text" | "inventory" | "reject" | undefined {
  if (cardIdOfDoc(docId) !== undefined) return "text"
  if (writerOfInventoryDoc(docId) !== undefined) return "inventory"
  if (isUndo(docId)) return "reject"
  return undefined
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

/** Whether a client's write to `docId` is accepted; undefined is no opinion. Pure. */
export function acceptsWrite(docId: string): boolean | undefined {
  if (docId === SESSION_DOC_ID || docId === PLACES_DOC_ID) return false
  if (docId === PRESENCE_DOC_ID) return true
  if (cardIdOfDoc(docId) !== undefined) return true
  if (isUndo(docId)) return false
  return undefined
}

export const writePolicy: Policy = {
  name: "pineta.writes",
  // A Line's documents only between its ends, in both directions; an
  // inventory only with its person; a tab's undo stack with no one.
  canShare: (docId, peer) =>
    isUndo(docId)
      ? false
      : (routeLine(docId, peer) ?? holdsInventory(docId, peer.principal)),
  canAccept: (docId, peer) =>
    routeLine(docId, peer) === false
      ? false
      : (holdsInventory(docId, peer.principal) ?? acceptsWrite(docId)),
}
