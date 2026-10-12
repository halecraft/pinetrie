// ssh/hop-line — the first line of every connection a lane's hop opens to the
// host: which lane it is, and whether it carries the agent protocol or a
// connection the broker makes.

import {
  type LaneToken,
  parseSshName,
  parseSshPort,
  type SshName,
  type SshPort,
  tokenLane,
} from "./names.ts"

export type HopLine =
  | { readonly kind: "agent"; readonly lane: string }
  | {
      readonly kind: "connect"
      readonly lane: string
      readonly name: SshName
      readonly port: SshPort
    }

/** The longest first line the host reads before it gives up on a connection. */
export const HOP_LINE_LIMIT = 1024

/** A hop passes its token on as it was given: only the host can check one. */
export const agentLine = (token: LaneToken | string): string =>
  `agent ${token}\n`

export const connectLine = (
  token: LaneToken | string,
  name: SshName,
  port: SshPort,
): string => `connect ${token} ${name} ${port}\n`

/** Why the host did not connect a name for a lane. */
export type ConnectRefusal =
  /** The host's config runs a program for it, which a lane may not. */
  | "proxycommand"
  /** `ssh -G` did not resolve it. */
  | "unresolved"
  /** The host could not reach it. */
  | "unreachable"
  /** The host has no `ssh` to resolve names with. */
  | "no-broker"

const REFUSALS: readonly ConnectRefusal[] = [
  "proxycommand",
  "unresolved",
  "unreachable",
  "no-broker",
]

/** The host's answer to a connect line, before any of the connection's bytes. */
export const connectAnswer = (refusal: ConnectRefusal | null): string =>
  refusal === null ? "ok\n" : `refused ${refusal}\n`

export function decodeConnectAnswer(
  line: string,
):
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly why: ConnectRefusal }
  | null {
  if (line === "ok") return { kind: "ok" }
  const why = REFUSALS.find(r => line === `refused ${r}`)
  return why === undefined ? null : { kind: "refused", why }
}

/**
 * A first line, without its newline, as the host reads it: null for anything
 * else, a token whose MAC is not the secret's included. A lane is only ever
 * known through a token that checked.
 */
export function decodeHopLine(
  line: string,
  secret: Uint8Array,
): HopLine | null {
  const words = line.split(" ")
  const [kind, token] = words
  if (token === undefined) return null
  const lane = tokenLane(secret, token)
  if (lane === null) return null
  if (kind === "agent" && words.length === 2) return { kind, lane }
  if (kind !== "connect" || words.length !== 4) return null
  const name = parseSshName(words[2] ?? "")
  const port = parseSshPort(words[3] ?? "")
  return name === null || port === null ? null : { kind, lane, name, port }
}
