// ssh/relay-step — what the relay does with each request on one lane's agent
// connection. A connection's state is the sessions bound on it, each to the
// host key that signed its id, as an OpenSSH agent checked it.

import { createHash } from "node:crypto"
import {
  type AgentRequest,
  type BindRequest,
  blobText,
  type SignRequest,
  signSession,
} from "./agent.ts"
import type { HostKeyFacts } from "./lane-files.ts"

interface ConnectionState {
  /** Session id (hex) → the host key (base64 blob) bound to it. */
  readonly bound: ReadonlyMap<string, string>
}

export const NEW_CONNECTION: ConnectionState = { bound: new Map() }

export interface RelayFacts {
  /** The service agent's key blobs, base64. */
  readonly service: ReadonlySet<string>
  /** The person's agent's key blobs; null when the lane holds no personal identity. */
  readonly personal: ReadonlySet<string> | null
  readonly hostKeys: HostKeyFacts
  /** The name the broker last connected for this lane; null for none. */
  readonly newestName: string | null
}

type RelayStep =
  /** Service keys, then personal ones, each blob once. */
  | { readonly kind: "list" }
  | {
      readonly kind: "sign"
      readonly with: "service" | "personal"
      readonly request: SignRequest
    }
  /** A personal key: ask whether the lane may, then sign or refuse. */
  | {
      readonly kind: "ask"
      /** The host it is for, as the lane's `known_hosts` names it; null if unknown. */
      readonly host: string | null
      readonly request: SignRequest
    }
  /** A session binding: an OpenSSH agent checks its signature first. */
  | { readonly kind: "verify"; readonly request: BindRequest }
  /** A personal key, for a session bound to no host key the lane may use. */
  | { readonly kind: "outside"; readonly refusal: OutsideRefusal }
  | { readonly kind: "refuse" }

/** A personal signature refused, its host's key outside the allowed hosts. */
export interface OutsideRefusal {
  /** The host's own name for the key, else the broker's newest for the lane. */
  readonly host: string | null
  /** The key's fingerprint; null when the session was never bound. */
  readonly key: string | null
}

/** A host key's fingerprint, as `ssh-keygen -l` prints it. */
export const fingerprint = (blob: string): string =>
  `SHA256:${createHash("sha256").update(Buffer.from(blob, "base64")).digest("base64").replace(/=+$/, "")}`

/**
 * One request's step.
 * - Anything but listing, signing and session binding is refused: adding,
 *   removing and locking keys, and every other extension.
 * - A service key signs with no question; it wins over the same key in the
 *   person's agent.
 * - A personal key asks. With personal hosts narrowed, it is refused as
 *   `outside`, unasked, unless its session was bound to a host key the
 *   lane may use, so a lane that skips its config's host check still
 *   cannot sign elsewhere.
 */
export function relayStep(
  state: ConnectionState,
  request: AgentRequest,
  facts: RelayFacts,
): RelayStep {
  switch (request.kind) {
    case "other":
      return { kind: "refuse" }
    case "list":
      return { kind: "list" }
    case "bind":
      return { kind: "verify", request }
    case "sign": {
      const key = blobText(request.key)
      if (facts.service.has(key))
        return { kind: "sign", with: "service", request }
      if (facts.personal === null || !facts.personal.has(key))
        return { kind: "refuse" }
      const session = signSession(request.data)
      const hostKey = session === null ? undefined : state.bound.get(session)
      const allowed = facts.hostKeys.personal
      if (allowed !== "all" && (hostKey === undefined || !allowed.has(hostKey)))
        return {
          kind: "outside",
          refusal: {
            host:
              (hostKey === undefined
                ? undefined
                : facts.hostKeys.names.get(hostKey)) ?? facts.newestName,
            key: hostKey === undefined ? null : fingerprint(hostKey),
          },
        }
      const host =
        hostKey === undefined
          ? facts.newestName
          : (facts.hostKeys.names.get(hostKey) ??
            facts.newestName ??
            fingerprint(hostKey))
      return { kind: "ask", host, request }
    }
    default: {
      const exhaustive: never = request
      return exhaustive
    }
  }
}

/** The state once an OpenSSH agent accepted `bind`'s signature. */
export const withBinding = (
  state: ConnectionState,
  bind: BindRequest,
): ConnectionState => ({
  bound: new Map(state.bound).set(
    Buffer.from(bind.session).toString("hex"),
    blobText(bind.hostKey),
  ),
})
