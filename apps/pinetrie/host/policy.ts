// host/policy — which documents a client may hold, which writes the host
// takes in, and which documents it takes in when a client creates them.
//
// Who may write the session, the places and a person's document is the
// protocol's (`writersPolicy`, `@pinetrie/protocol/writers`), registered here
// and on every client: a client's own write to the places is refused before it
// is made. Presence is written by each client. Every card's text is accepted
// from anyone. A tab's undo stack is its own: the host neither holds nor relays
// it. The host's stacks of people's moves (`moves:`) are its own: no client
// holds them. A person's documents, their inventory and their attention, are
// shared only with the peers whose principal is that person; `resolve` fires
// only for a peer `canShare` grants, so nobody else can create it either. A
// principal is what a peer says it is, so this keeps it from honest clients
// only.
//
// A command Line's documents belong to its two ends, the host and one client
// seat: no other client may hold or write them. Kyneta's default shares every
// document with every peer, which would hand each client everyone's commands
// and replies, and would offer a departed seat's Line back to the host after
// the host destroyed it. Every other document is left to Kyneta's default.

import { type Policy, routeLine } from "@kyneta/exchange"
import {
  MOVES_DOC_PREFIX,
  type RootId,
  rootOfDocId,
  rootOfScratchDocId,
} from "@pinetrie/core"
import {
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import {
  holdsPersonDoc,
  ownerOfPersonDoc,
  type PersonDocKind,
} from "@pinetrie/protocol/writers"
import {
  AttentionDoc,
  cardIdOfDoc,
  InventoryDoc,
  LiveDoc,
  OpenDoc,
  PlacesDoc,
  RootDoc,
  ScratchDoc,
  SessionDoc,
  TextDoc,
} from "@pinetrie/schema"

/**
 * The schema each kind of stored document is opened with: the one place a
 * document's kind becomes its schema, for `resolve` and for the check of the
 * stored schemas at startup.
 */
export const SCHEMA_OF = {
  session: SessionDoc,
  live: LiveDoc,
  places: PlacesDoc,
  root: RootDoc,
  scratch: ScratchDoc,
  text: TextDoc,
  inventory: InventoryDoc,
  attention: AttentionDoc,
  open: OpenDoc,
} as const

/** A kind of document the host stores and opens with a schema of ours. */
export type StoredKind = keyof typeof SCHEMA_OF

/**
 * The kind of a stored document, by its id: "kyneta" for a stack of moves,
 * whose schema is Kyneta's own, and undefined for one no code here opens. A
 * command Line is deleted at start, before anything asks.
 */
export function storedKind(docId: string): StoredKind | "kyneta" | undefined {
  if (isMoves(docId)) return "kyneta"
  if (docId === SESSION_DOC_ID) return "session"
  if (docId === LIVE_DOC_ID) return "live"
  if (docId === PLACES_DOC_ID) return "places"
  if (rootOfDocId(docId) !== undefined) return "root"
  if (isScratch(docId)) return "scratch"
  if (cardIdOfDoc(docId) !== undefined) return "text"
  return ownerOfPersonDoc(docId)?.kind
}

const isUndo = (docId: string): boolean => docId.startsWith("undo:")
const isMoves = (docId: string): boolean => docId.startsWith(MOVES_DOC_PREFIX)
const isScratch = (docId: string): boolean =>
  rootOfScratchDocId(docId) !== undefined

/**
 * What the host makes of a document a client announces and the host does not
 * hold, by its kind (`storedKind`): a card's text, a person's document, a
 * root's document the directory names, which the host loads from its store (an
 * archived root), or a tab's undo stack, a stack of moves or an unknown root to
 * reject: only the host makes roots and stacks of moves. The documents the host
 * opens itself, and any other id, are left to Kyneta's default (undefined).
 * Without this, a document the host never opened itself would be neither stored
 * nor relayed.
 */
export function resolveDoc(
  docId: string,
  known: (root: RootId) => boolean,
): "text" | PersonDocKind | "root" | "reject" | undefined {
  if (isUndo(docId)) return "reject"
  const kind = storedKind(docId)
  switch (kind) {
    case "root": {
      const root = rootOfDocId(docId)
      return root !== undefined && known(root) ? "root" : "reject"
    }
    case "kyneta":
    case "scratch":
      return "reject"
    case "session":
    case "live":
    case "places":
    case undefined:
      return undefined
    default:
      return kind
  }
}

/**
 * Whether a client's write to `docId` is accepted; undefined is no opinion, and
 * who may write the session, the places and an inventory is `writersPolicy`'s.
 */
export function acceptsWrite(docId: string): boolean | undefined {
  if (docId === PRESENCE_DOC_ID) return true
  if (cardIdOfDoc(docId) !== undefined) return true
  if (isUndo(docId) || isMoves(docId) || isScratch(docId)) return false
  return undefined
}

export const hostPolicy: Policy = {
  name: "pinetrie.host",
  // A Line's documents only between its ends, in both directions; a
  // person's document only with its person; a tab's undo stack, a stack of
  // moves and a scratch document with no one.
  canShare: (docId, peer) =>
    isUndo(docId) || isMoves(docId) || isScratch(docId)
      ? false
      : (routeLine(docId, peer) ?? holdsPersonDoc(docId, peer.principal)),
  canAccept: (docId, peer) =>
    routeLine(docId, peer) === false ? false : acceptsWrite(docId),
}
