// host/policy — which documents a client may hold, which writes the host
// takes in, and which documents it takes in when a client creates them.
//
// Who may write the session, the places and a person's document is the protocol's
// (`writersPolicy`, `@pinetrie/protocol/writers`), registered here and on every
// client: a client's own write to the places is refused before it is made.
// Presence is written by each client (ADR-0024). Every card's text is
// accepted from anyone (ADR-0048). A tab's undo stack is its own: the host
// neither holds nor relays it. The host's stacks of people's moves
// (`moves:`, ADR-0066) are its own: no client holds them. A person's
// documents, their inventory and their attention, are shared only with the
// peers whose principal is that person (ADR-0059, ADR-0077); `resolve` fires only for a
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
import { MOVES_DOC_PREFIX, type RootId, rootOfDocId } from "@pinetrie/core"
import { PRESENCE_DOC_ID } from "@pinetrie/protocol/messages"
import {
  holdsPersonDoc,
  ownerOfPersonDoc,
  type PersonDocKind,
} from "@pinetrie/protocol/writers"
import { cardIdOfDoc } from "@pinetrie/schema"

const isUndo = (docId: string): boolean => docId.startsWith("undo:")
const isMoves = (docId: string): boolean => docId.startsWith(MOVES_DOC_PREFIX)

/**
 * What the host makes of a document a client announces and the host does not
 * hold: a card's text, a person's document (by its kind), a root's document the directory
 * names, which the host loads from its store (an archived root, ADR-0063),
 * or a tab's undo stack, a stack of moves or an unknown root to reject: only
 * the host makes roots and stacks of moves. Undefined leaves it to Kyneta's default. Without this, a document
 * the host never opened itself would be neither stored nor relayed (S58).
 * Pure.
 */
export function resolveDoc(
  docId: string,
  known: (root: RootId) => boolean,
): "text" | PersonDocKind | "root" | "reject" | undefined {
  const root = rootOfDocId(docId)
  if (root !== undefined) return known(root) ? "root" : "reject"
  if (cardIdOfDoc(docId) !== undefined) return "text"
  const person = ownerOfPersonDoc(docId)
  if (person !== undefined) return person.kind
  if (isUndo(docId) || isMoves(docId)) return "reject"
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
  if (isUndo(docId) || isMoves(docId)) return false
  return undefined
}

export const hostPolicy: Policy = {
  name: "pinetrie.host",
  // A Line's documents only between its ends, in both directions; a
  // person's document only with its person; a tab's undo stack and a stack of
  // moves with no one.
  canShare: (docId, peer) =>
    isUndo(docId) || isMoves(docId)
      ? false
      : (routeLine(docId, peer) ?? holdsPersonDoc(docId, peer.principal)),
  canAccept: (docId, peer) =>
    routeLine(docId, peer) === false ? false : acceptsWrite(docId),
}
