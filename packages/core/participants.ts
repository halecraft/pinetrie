// core/participants — who is in the session: each seat the host has seen,
// each writer's display name, and their picture.

import type { WriterId } from "./ids.ts"
import type { Sha256 } from "./images.ts"

/**
 * A seat the host has seen: its Kyneta peer, the Yjs `clientID` its operations
 * carry, and the person it is. A host-written `pinetrie.seat` value keyed by
 * the peer, so anyone can name who wrote in a text after the seat has gone.
 */
export interface SeatRecord {
  readonly peer: string
  readonly clientId: number
  readonly writer: WriterId
  /** When the host first saw it, which orders contributors. */
  readonly at: number
}

/** A writer's display name. */
export interface ParticipantRecord {
  readonly writer: WriterId
  readonly name: string
}

/** A person's picture: a blob, keyed by their writer. */
export interface PictureRecord {
  readonly writer: WriterId
  readonly sha256: Sha256
}
