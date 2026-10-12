// host/lines — which command Lines to destroy.
//
// Kyneta issues every client a fresh seat per page load, and a Line is
// addressed by seat. A client keeps no store and does not reconnect, so once
// its seat has left, its Line can never resume: its documents would stay in the
// host's store forever, a pair per visit. The host destroys a departed seat's
// Line, and at startup deletes every stored one.

/** The seats with an open Line that are no longer among the peers. */
export const departedSeats = (
  open: Iterable<string>,
  peers: ReadonlyMap<string, unknown>,
): string[] => [...open].filter(seat => !peers.has(seat))

/**
 * The prefix of every stored document of a Line on `topic`: Kyneta names them
 * `line:${topic}:${from}→${to}` (`lineDocId`).
 */
export const lineDocPrefix = (topic: string): string => `line:${topic}:`
