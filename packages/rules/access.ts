// access — a lane's ssh identities, as the column's header shows them, and
// how its use of its owner's identity changes: asked, answered, refused for
// a host not allowed, and cleared as a host starts. The relay answers each
// signature from the record at once, and each change to it is news to the
// lane.

import {
  type AccessAnswer,
  ERR,
  type ThreadId,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, threadKey, WriterIdSchema } from "./decode.ts"
import { type RecordSpec, setRecord } from "./records.ts"

const HostSchema = Type.Union([Type.String(), Type.Null()])

const PersonalSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("waiting"),
    host: HostSchema,
    since: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal("allowed"),
    host: HostSchema,
    by: WriterIdSchema,
    at: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal("denied"),
    host: HostSchema,
    by: WriterIdSchema,
    at: Type.Number(),
    takenBack: Type.Boolean(),
  }),
])

const OutsideSchema = Type.Object({
  host: HostSchema,
  key: Type.Union([Type.String(), Type.Null()]),
  at: Type.Number(),
})

const AccessRecordSchema = Type.Object({
  personal: Type.Union([PersonalSchema, Type.Null()]),
  outside: Type.Union([OutsideSchema, Type.Null()]),
  services: Type.Array(Type.String()),
  hosts: Type.Array(Type.String()),
})

/**
 * A lane's use of its owner's ssh identity: asked, and what the owner
 * answered, each state naming the host the lane last asked for. No
 * signature is held on it: a lane not allowed is refused at once, and each
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
      readonly kind: "allowed"
      readonly host: string | null
      readonly by: WriterId
      readonly at: number
    }
  | {
      readonly kind: "denied"
      readonly host: string | null
      readonly by: WriterId
      readonly at: number
      /** Allowed, then taken back. */
      readonly takenBack: boolean
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

/** Each lane's ssh identities and what its owner said, at its lane. */
export const ACCESS: RecordSpec<AccessRecord, ThreadId, "session"> = {
  namespace: "pinetrie.access",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(AccessRecordSchema, contents, threadKey(key), (r, lane) => ({
      lane,
      personal: r.personal,
      outside: r.outside,
      services: r.services,
      hosts: r.hosts,
    })),
}

/** A lane that has asked nothing and used nothing. */
export const emptyAccess = (lane: ThreadId): AccessRecord => ({
  lane,
  personal: null,
  outside: null,
  services: [],
  hosts: [],
})

/**
 * What the owner may answer, by where the lane stands. The host refuses any
 * other answer, and the header offers exactly these: one table, so the page
 * never offers what the host would refuse.
 */
export const ACCESS_ANSWERS: Readonly<
  Record<PersonalAccess["kind"], readonly AccessAnswer[]>
> = {
  waiting: ["allow", "deny"],
  allowed: ["take-back"],
  denied: ["allow"],
}

/** The answers the owner may give a lane now; none before it has asked. */
export const answersFor = (record: AccessRecord): readonly AccessAnswer[] =>
  record.personal === null ? [] : ACCESS_ANSWERS[record.personal.kind]

/** Why an answer is refused: the host's own codes, which its reply carries unchanged. */
export type AccessRefusal = typeof ERR.NOT_OWNER | typeof ERR.NOTHING_TO_ANSWER

/**
 * An answer, as the record it makes and its write, or why it is refused. It
 * keeps the host the lane asked for. A lane with no record has asked nothing.
 */
export function planAccessAnswer(input: {
  readonly lane: ThreadId
  readonly record: AccessRecord | undefined
  readonly answer: AccessAnswer
  readonly sender: WriterId
  readonly owner: WriterId | null
  readonly now: number
}):
  | {
      readonly record: AccessRecord
      readonly writes: readonly ValueWrite<"session">[]
    }
  | { readonly refused: AccessRefusal } {
  const { answer, sender, now } = input
  const record = input.record ?? emptyAccess(input.lane)
  if (input.owner === null || sender !== input.owner)
    return { refused: ERR.NOT_OWNER }
  if (record.personal === null || !answersFor(record).includes(answer))
    return { refused: ERR.NOTHING_TO_ANSWER }
  const { host } = record.personal
  const personal: PersonalAccess =
    answer === "allow"
      ? { kind: "allowed", host, by: sender, at: now }
      : {
          kind: "denied",
          host,
          by: sender,
          at: now,
          takenBack: answer === "take-back",
        }
  const answered = { ...record, personal }
  return { record: answered, writes: [setRecord(ACCESS, answered)] }
}

/** A lane asks for its owner's identity: it waits, unless it asked or was answered already. */
export const planAccessAsk = (input: {
  readonly record: AccessRecord
  readonly host: string | null
  readonly now: number
}): AccessRecord =>
  input.record.personal === null
    ? {
        ...input.record,
        personal: { kind: "waiting", host: input.host, since: input.now },
      }
    : input.record

/**
 * A personal signature's answer, at once, from the lane's record: an
 * allowed lane signs; any other is refused, and a lane that never asked
 * asks as it is refused. A lane that may not ask writes nothing.
 */
export function planPersonalSign(input: {
  readonly record: AccessRecord
  readonly mayAsk: boolean
  readonly host: string | null
  readonly now: number
}): { readonly signs: boolean; readonly write: AccessRecord | null } {
  const { record } = input
  if (!input.mayAsk) return { signs: false, write: null }
  if (record.personal?.kind === "allowed") return { signs: true, write: null }
  return {
    signs: false,
    write: record.personal === null ? planAccessAsk(input) : null,
  }
}

/**
 * A starting host's records: no refusal for a host not allowed is kept,
 * since the allowed hosts are read again at start. A request is kept: no
 * signature waited on it, so a stop lost nothing.
 */
export const planAccessRecovery = (
  records: readonly AccessRecord[],
): readonly AccessRecord[] =>
  records.filter(r => r.outside !== null).map(r => ({ ...r, outside: null }))

/**
 * A signature refused for a host not allowed, recorded; null when it is the
 * host and key recorded already, so a lane that retries writes nothing.
 */
export function planAccessOutside(
  record: AccessRecord,
  refusal: { readonly host: string | null; readonly key: string | null },
  now: number,
): AccessRecord | null {
  const was = record.outside
  if (was !== null && was.host === refusal.host && was.key === refusal.key)
    return null
  return { ...record, outside: { ...refusal, at: now } }
}

/** The most names a record keeps of the hosts a lane connected. */
const ACCESS_HOSTS = 8

/**
 * A use recorded: a name is added once, in first-use order, so a lane that
 * reconnects writes nothing. Null when nothing changes.
 */
export function planAccessUse(
  record: AccessRecord,
  use: { readonly kind: "service" | "host"; readonly name: string },
): AccessRecord | null {
  const list = use.kind === "service" ? record.services : record.hosts
  if (list.includes(use.name)) return null
  if (use.kind === "host" && list.length >= ACCESS_HOSTS) return null
  return use.kind === "service"
    ? { ...record, services: [...list, use.name] }
    : { ...record, hosts: [...list, use.name] }
}

/** What a change to a lane's record tells it; each names its host and owner. */
export interface AccessNews {
  /**
   * `asked`: it waits for its owner. `allowed`: it may sign. `denied`:
   * its request was denied. `taken-back`: what was allowed was taken back,
   * and its sessions end.
   */
  readonly kind: "asked" | "allowed" | "denied" | "taken-back"
  readonly host: string | null
  readonly owner: WriterId
}

/**
 * The news a change to a lane's record makes; null for no change of state.
 * It is read from the record, not from who wrote it, so two signatures that
 * both wrote `waiting` make one change, and one piece of news. `owner` names
 * a request's owner; an answer names its own `by`.
 */
export function planAccessChange(
  prev: PersonalAccess | null,
  next: PersonalAccess | null,
  owner: WriterId,
): AccessNews | null {
  if (next === null || prev?.kind === next.kind) return null
  switch (next.kind) {
    case "waiting":
      return { kind: "asked", host: next.host, owner }
    case "allowed":
      return { kind: "allowed", host: next.host, owner: next.by }
    case "denied":
      return {
        kind: prev?.kind === "allowed" ? "taken-back" : "denied",
        host: next.host,
        owner: next.by,
      }
  }
}
