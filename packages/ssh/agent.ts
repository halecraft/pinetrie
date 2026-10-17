// ssh/agent — the ssh agent protocol, as much of it as the relay passes:
// listing, signing and session binding (OpenSSH's PROTOCOL.agent). Each
// message is a `uint32` length, a type byte and its fields (`wire.ts`).

import { ascii, wireReader, wireString, wireU32 } from "./wire.ts"

/** A request the relay understands; every other is `other`, and refused. */
export type AgentRequest =
  | { readonly kind: "list" }
  | {
      readonly kind: "sign"
      readonly key: Uint8Array
      readonly data: Uint8Array
      readonly flags: number
    }
  | {
      readonly kind: "bind"
      readonly hostKey: Uint8Array
      readonly session: Uint8Array
      readonly signature: Uint8Array
      readonly forwarding: boolean
    }
  | { readonly kind: "other" }

export type SignRequest = Extract<AgentRequest, { kind: "sign" }>
export type BindRequest = Extract<AgentRequest, { kind: "bind" }>

export interface AgentKey {
  readonly blob: Uint8Array
  readonly comment: string
}

const REQUEST_IDENTITIES = 11
const IDENTITIES_ANSWER = 12
const SIGN_REQUEST = 13
const EXTENSION = 27
const AGENT_FAILURE = 5
const AGENT_SUCCESS = 6
const SESSION_BIND = "session-bind@openssh.com"
/** SSH2_MSG_USERAUTH_REQUEST, which follows the session id in a login's data. */
const USERAUTH_REQUEST = 50
/** OpenSSH's agent refuses a longer message (`AGENT_MAX_LEN`). */
const AGENT_MAX_LENGTH = 256 * 1024

/** A message body (type and fields) as it goes on the wire. */
export const frame = (body: Uint8Array): Uint8Array =>
  Buffer.concat([wireU32(body.length), body])

/**
 * The first whole message in `buffer`, and what follows it; null while it
 * is incomplete, and `too-long` for a length past `AGENT_MAX_LENGTH`.
 */
export function takeFrame(
  buffer: Uint8Array,
):
  | { readonly body: Uint8Array; readonly rest: Uint8Array }
  | null
  | "too-long" {
  if (buffer.length < 4) return null
  const n = Buffer.from(buffer.buffer, buffer.byteOffset, 4).readUInt32BE(0)
  if (n > AGENT_MAX_LENGTH) return "too-long"
  if (buffer.length < 4 + n) return null
  return { body: buffer.subarray(4, 4 + n), rest: buffer.subarray(4 + n) }
}

/** A request's body, decoded. Total: anything malformed is `other`. */
export function decodeAgentRequest(body: Uint8Array): AgentRequest {
  const r = wireReader(body)
  const type = r.u8()
  if (type === REQUEST_IDENTITIES)
    return r.done() ? { kind: "list" } : { kind: "other" }
  if (type === SIGN_REQUEST) {
    const key = r.string()
    const data = r.string()
    const flags = r.u32()
    return key === null || data === null || flags === null || !r.done()
      ? { kind: "other" }
      : { kind: "sign", key, data, flags }
  }
  if (type === EXTENSION) {
    const name = r.string()
    if (name === null || ascii(name) !== SESSION_BIND) return { kind: "other" }
    const hostKey = r.string()
    const session = r.string()
    const signature = r.string()
    const forwarding = r.u8()
    return hostKey === null ||
      session === null ||
      signature === null ||
      forwarding === null ||
      forwarding > 1 ||
      !r.done()
      ? { kind: "other" }
      : {
          kind: "bind",
          hostKey,
          session,
          signature,
          forwarding: forwarding === 1,
        }
  }
  return { kind: "other" }
}

/** A sign request's body, written from its decoded fields alone. */
export const encodeSign = (r: SignRequest): Uint8Array =>
  Buffer.concat([
    Buffer.from([SIGN_REQUEST]),
    wireString(r.key),
    wireString(r.data),
    wireU32(r.flags),
  ])

/** A session binding's body, written from its decoded fields alone. */
export const encodeBind = (r: BindRequest): Uint8Array =>
  Buffer.concat([
    Buffer.from([EXTENSION]),
    wireString(SESSION_BIND),
    wireString(r.hostKey),
    wireString(r.session),
    wireString(r.signature),
    Buffer.from([r.forwarding ? 1 : 0]),
  ])

export const LIST_REQUEST: Uint8Array = Buffer.from([REQUEST_IDENTITIES])
export const FAILURE: Uint8Array = Buffer.from([AGENT_FAILURE])
export const SUCCESS: Uint8Array = Buffer.from([AGENT_SUCCESS])

export const listReply = (keys: readonly AgentKey[]): Uint8Array =>
  Buffer.concat([
    Buffer.from([IDENTITIES_ANSWER]),
    wireU32(keys.length),
    ...keys.flatMap(k => [wireString(k.blob), wireString(k.comment)]),
  ])

/** An agent's answer to a list request; null for anything else. */
export function decodeIdentities(body: Uint8Array): readonly AgentKey[] | null {
  const r = wireReader(body)
  if (r.u8() !== IDENTITIES_ANSWER) return null
  const n = r.u32()
  if (n === null) return null
  const keys: AgentKey[] = []
  for (let i = 0; i < n; i++) {
    const blob = r.string()
    const comment = r.string()
    if (blob === null || comment === null) return null
    keys.push({ blob, comment: Buffer.from(comment).toString() })
  }
  return r.done() ? keys : null
}

/**
 * The session id a sign request's data is for, hex; null when the data is
 * not a login's (its session id, then `SSH2_MSG_USERAUTH_REQUEST`).
 */
export function signSession(data: Uint8Array): string | null {
  const r = wireReader(data)
  const session = r.string()
  return session !== null && r.u8() === USERAUTH_REQUEST
    ? Buffer.from(session).toString("hex")
    : null
}

/** A key blob as `known_hosts` and `.pub` lines write it. */
export const blobText = (blob: Uint8Array): string =>
  Buffer.from(blob).toString("base64")
