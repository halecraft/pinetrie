// host/policy — which documents a client may write, and which it may hold.
//
// The host is the session's only writer (ADR-0023): clients send commands,
// and a write to the session document from a client is refused. Presence is
// written by each client (ADR-0024). A note's text is written by everyone
// while the note is a draft or open, and by no one once it is done (ADR-0025);
// a note with no record is no note.
//
// A command Line's documents belong to its two ends, the host and one client
// seat (ADR-0037): no other client may hold or write them. Kyneta's default
// shares every document with every peer, which would hand each client
// everyone's commands and replies, and would offer a departed seat's Line back
// to the host after the host destroyed it. Every other document is left to
// Kyneta's default.

import { type Policy, routeLine } from "@kyneta/exchange"
import type { NoteId, NoteState } from "@pineta/core"
import { PRESENCE_DOC_ID, SESSION_DOC_ID } from "@pineta/protocol/messages"
import { noteIdOfDoc } from "@pineta/schema"

/**
 * Whether a client's write to `docId` is accepted; undefined is no opinion.
 * Pure, given `noteState`, which looks a note's state up in its record.
 */
export function acceptsWrite(
  docId: string,
  noteState: (id: NoteId) => NoteState | undefined,
): boolean | undefined {
  if (docId === SESSION_DOC_ID) return false
  if (docId === PRESENCE_DOC_ID) return true
  const note = noteIdOfDoc(docId)
  if (note === undefined) return undefined
  const state = noteState(note)
  return state === "draft" || state === "open"
}

/** The policy, over the host's lookup of each note's state. */
export const writePolicy = (
  noteState: (id: NoteId) => NoteState | undefined,
): Policy => ({
  name: "pineta.writes",
  // A Line's documents only between its ends, in both directions.
  canShare: (docId, peer) => routeLine(docId, peer),
  canAccept: (docId, peer) =>
    routeLine(docId, peer) === false ? false : acceptsWrite(docId, noteState),
})
