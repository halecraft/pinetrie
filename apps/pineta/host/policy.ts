// host/policy — which documents a client may hold, which writes the host
// takes in, and which documents it takes in when a client creates them.
//
// Who may write the session, the places and an inventory is the protocol's
// (`writersPolicy`, `@pineta/protocol/writers`), registered here and on every
// client: a client's own write to the places is refused before it is made.
// Presence is written by each client (ADR-0024). Every card's text is
// accepted from anyone (ADR-0048). A tab's undo stack is its own: the host
// neither holds nor relays it. A person's inventory is shared only with the
// peers whose principal is that person (ADR-0059); `resolve` fires only for a
// peer `canShare` grants (S76), so nobody else can create it either. A
// principal is what a peer says it is (ADR-0037), so this keeps it from
// honest clients only.
//
// A command Line's documents belong to its two ends, the host and one client
// seat (ADR-0037): no other client may hold or write them. Kyneta's default
// shares every document with every peer, which would hand each client
// everyone's commands and replies, and would offer a departed seat's Line back
// to the host after the host destroyed it. Every other document is left to
// Kyneta's default.

import { type Policy, routeLine } from "@kyneta/exchange"
import { PRESENCE_DOC_ID } from "@pineta/protocol/messages"
import { holdsInventory, writerOfInventoryDoc } from "@pineta/protocol/writers"
import { cardIdOfDoc } from "@pineta/schema"

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
 * Whether a client's write to `docId` is accepted; undefined is no opinion,
 * and who may write the session, the places and an inventory is
 * `writersPolicy`'s. Pure.
 */
export function acceptsWrite(docId: string): boolean | undefined {
  if (docId === PRESENCE_DOC_ID) return true
  if (cardIdOfDoc(docId) !== undefined) return true
  if (isUndo(docId)) return false
  return undefined
}

export const hostPolicy: Policy = {
  name: "pineta.host",
  // A Line's documents only between its ends, in both directions; an
  // inventory only with its person; a tab's undo stack with no one.
  canShare: (docId, peer) =>
    isUndo(docId)
      ? false
      : (routeLine(docId, peer) ?? holdsInventory(docId, peer.principal)),
  canAccept: (docId, peer) =>
    routeLine(docId, peer) === false ? false : acceptsWrite(docId),
}
