// session/card-copies — when this client's copy of a card's text goes;
// `card-texts.ts` carries it out.

import type { CardId } from "@pinetrie/core"

/**
 * Whether the host let go of a card's document: it left the document while
 * still connected. Only the host destroys card documents, and only those of
 * cards it has spent, removed or swept. An undo past a card's creation, yours or
 * another's, leaves the host in place; a departing host leaves
 * `exchange.peers` first, and a dropped one leaves nothing.
 */
export const hostLetGo = (input: {
  /** The host was among the document's peers before this change. */
  readonly hadHost: boolean
  /** It is among them after. */
  readonly hasHost: boolean
  /** The host is in `exchange.peers`. */
  readonly hostConnected: boolean
}): boolean => input.hadHost && !input.hasHost && input.hostConnected

/**
 * The cards whose copies this client destroys now: the host let go of their
 * documents, and their records are gone. The two arrive in either order (the
 * host's `dismiss` can come before its delete of the record), so a card
 * the host let go of waits for its record to go: until then, a render may
 * still read its text, and would make a new copy.
 */
export const spentCards = <Id extends CardId>(
  letGo: Iterable<Id>,
  live: (id: CardId) => boolean,
): Id[] => [...letGo].filter(id => !live(id))
