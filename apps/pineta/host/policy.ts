// host/policy — which documents a client may write, which it may hold, and
// which the host takes in when a client creates them.
//
// The host is the session's only writer (ADR-0023): clients send commands,
// and a write to the session document from a client is refused. Presence is
// written by each client (ADR-0024). Cards are written by clients (ADR-0048): the
// cards document and every card's text are accepted from anyone, since a
// refused write cannot be recovered from (S28). A tab's undo stack is its
// own: the host neither holds nor relays it.
//
// A command Line's documents belong to its two ends, the host and one client
// seat (ADR-0037): no other client may hold or write them. Kyneta's default
// shares every document with every peer, which would hand each client
// everyone's commands and replies, and would offer a departed seat's Line back
// to the host after the host destroyed it. Every other document is left to
// Kyneta's default.

import { type Policy, routeLine } from "@kyneta/exchange"
import {
  CARDS_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { cardIdOfDoc } from "@pineta/schema"

const isUndo = (docId: string): boolean => docId.startsWith("undo:")

/**
 * What the host makes of a document a client announces and the host does not
 * hold: the cards document, a card's text, or a tab's undo stack to reject.
 * Undefined leaves it to Kyneta's default. Without this, a card the host never
 * opened itself would be neither stored nor relayed (S58). Pure.
 */
export function resolveDoc(
  docId: string,
): "cards" | "text" | "reject" | undefined {
  if (docId === CARDS_DOC_ID) return "cards"
  if (cardIdOfDoc(docId) !== undefined) return "text"
  if (isUndo(docId)) return "reject"
  return undefined
}

/** Whether a client's write to `docId` is accepted; undefined is no opinion. Pure. */
export function acceptsWrite(docId: string): boolean | undefined {
  if (docId === SESSION_DOC_ID) return false
  if (docId === PRESENCE_DOC_ID) return true
  if (docId === CARDS_DOC_ID || cardIdOfDoc(docId) !== undefined) return true
  if (isUndo(docId)) return false
  return undefined
}

export const writePolicy: Policy = {
  name: "pineta.writes",
  // A Line's documents only between its ends, in both directions; a tab's
  // undo stack with no one.
  canShare: (docId, peer) => (isUndo(docId) ? false : routeLine(docId, peer)),
  canAccept: (docId, peer) =>
    routeLine(docId, peer) === false ? false : acceptsWrite(docId),
}
