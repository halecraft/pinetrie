// ssh/names — the values a lane hands the host, each checked once where it
// crosses: a host name, a port, and the token that says which lane it is.

import { createHmac, timingSafeEqual } from "node:crypto"

declare const sshNameBrand: unique symbol
/** A host name as a lane typed it, safe to pass to `ssh -G` as its last argument. */
export type SshName = string & { readonly [sshNameBrand]: true }

declare const sshPortBrand: unique symbol
export type SshPort = number & { readonly [sshPortBrand]: true }

declare const laneTokenBrand: unique symbol
/** A lane's name under the host's secret: `<lane, base64url>.<HMAC-SHA256, hex>`. */
export type LaneToken = string & { readonly [laneTokenBrand]: true }

// A name starting with `-` would be read by ssh as an option.
const NAME = /^[A-Za-z0-9._:[\]][A-Za-z0-9._:[\]-]*$/

export const parseSshName = (text: string): SshName | null =>
  NAME.test(text) && text.length <= 255 ? (text as SshName) : null

export function parseSshPort(text: string): SshPort | null {
  if (!/^[0-9]{1,5}$/.test(text)) return null
  const port = Number(text)
  return port >= 1 && port <= 65535 ? (port as SshPort) : null
}

const mac = (secret: Uint8Array, lane: string): Buffer =>
  createHmac("sha256", secret).update(lane).digest()

/**
 * `lane`'s token. It carries the lane, so the host keeps no table of tokens:
 * `tokenLane` reads the lane back and checks the MAC.
 */
export const laneToken = (secret: Uint8Array, lane: string): LaneToken =>
  `${Buffer.from(lane).toString("base64url")}.${mac(secret, lane).toString("hex")}` as LaneToken

/** The lane a token names, or null when its MAC is not the secret's. */
export function tokenLane(secret: Uint8Array, token: string): string | null {
  const dot = token.indexOf(".")
  if (dot < 0) return null
  const lane = Buffer.from(token.slice(0, dot), "base64url").toString()
  const given = Buffer.from(token.slice(dot + 1), "hex")
  const expected = mac(secret, lane)
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? lane
    : null
}
