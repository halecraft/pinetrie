// host/policy — which documents a client may write.
//
// The host is the session's only writer (ADR-0023): clients send commands,
// and a write to the session document from a client is refused. Presence is
// written by each client (ADR-0024). Every other document is left to Kyneta's
// default. Notes add their documents here (PLAN-2026-09-27-notes).

import type { Policy } from "@kyneta/exchange"
import { PRESENCE_DOC_ID, SESSION_DOC_ID } from "@pineta/protocol/messages"

/** Whether a client's write to `docId` is accepted; undefined is no opinion. Pure. */
export function acceptsWrite(docId: string): boolean | undefined {
  if (docId === SESSION_DOC_ID) return false
  if (docId === PRESENCE_DOC_ID) return true
  return undefined
}

export const writePolicy: Policy = {
  name: "pineta.writes",
  canAccept: docId => acceptsWrite(docId),
}
