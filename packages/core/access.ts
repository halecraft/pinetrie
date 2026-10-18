// core/access — a lane's use of its owner's ssh identity: what was asked and
// answered, the hosts it signed for, and the owner's answers.

import type { ThreadId, WriterId } from "./ids.ts"

/**
 * A lane's use of its owner's ssh identity: asked, and what the owner
 * answered, each state naming the host the lane last asked for. No
 * signature is held on it: a lane not approved is refused at once, and each
 * change of state is news to the lane.
 */
export type PersonalAccess =
  | {
      readonly kind: "waiting"
      /** Null when the lane's session named no host. */
      readonly host: string | null
      readonly since: number
    }
  | {
      readonly kind: "approved"
      readonly host: string | null
      readonly by: WriterId
      readonly at: number
    }
  | {
      readonly kind: "refused"
      readonly host: string | null
      readonly by: WriterId
      readonly at: number
      /** Approved, then taken back. */
      readonly revoked: boolean
    }

/**
 * The last of a lane's personal signatures refused unasked, its host's key
 * outside the owner's `lanes.ssh.hosts`.
 */
export interface OutsideHost {
  /** The host's own name for the key, else the name the lane last connected; null for neither. */
  readonly host: string | null
  /** The key's fingerprint; null when the lane's session was never bound to one. */
  readonly key: string | null
  readonly at: number
}

/**
 * What ssh identities a lane holds and has used: a host-written
 * `pinetrie.access` value keyed by lane, which the column's header shows.
 */
export interface AccessRecord {
  readonly lane: ThreadId
  /** Null until the lane first asks for its owner's identity. */
  readonly personal: PersonalAccess | null
  /** Null until a signature is refused for a host not allowed, and again once a host starts. */
  readonly outside: OutsideHost | null
  /** Service identities it has signed with, by name, in first-use order. */
  readonly services: readonly string[]
  /** Names the host connected for it, in first-use order. */
  readonly hosts: readonly string[]
}

/** What the owner can say to a lane's use of their ssh identity. */
export type AccessAnswer = "approve" | "refuse" | "revoke"
