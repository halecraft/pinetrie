// access — a lane's ssh identities, as the column's header shows them, and
// how its use of its owner's identity changes: asked, answered, timed out,
// refused for a host not allowed, and recovered after a host stops. The
// host's relay follows the record, so each change to its owner's answer is
// also what happens to a request held for the owner.

import type {
  AccessAnswer,
  AccessRecord,
  PersonalAccess,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, threadKey, WriterIdSchema } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const HostSchema = Type.Union([Type.String(), Type.Null()])

const PersonalSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("waiting"),
    host: HostSchema,
    since: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal("approved"),
    by: WriterIdSchema,
    at: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal("refused"),
    by: WriterIdSchema,
    at: Type.Number(),
    revoked: Type.Boolean(),
  }),
  Type.Object({
    kind: Type.Literal("unanswered"),
    host: HostSchema,
    at: Type.Number(),
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
  waiting: ["approve", "refuse"],
  approved: ["revoke"],
  refused: ["approve"],
  unanswered: ["approve"],
}

/** The answers the owner may give a lane now; none before it has asked. */
export const answersFor = (record: AccessRecord): readonly AccessAnswer[] =>
  record.personal === null ? [] : ACCESS_ANSWERS[record.personal.kind]

export type AccessRefusal = "not_owner" | "nothing_to_answer"

/** An answer, as the record it makes, or why it is refused. */
export function planAccessAnswer(input: {
  readonly record: AccessRecord
  readonly answer: AccessAnswer
  readonly sender: WriterId
  readonly owner: WriterId | null
  readonly now: number
}): { readonly record: AccessRecord } | { readonly refused: AccessRefusal } {
  const { record, answer, sender, now } = input
  if (input.owner === null || sender !== input.owner)
    return { refused: "not_owner" }
  if (!answersFor(record).includes(answer))
    return { refused: "nothing_to_answer" }
  const personal: PersonalAccess =
    answer === "approve"
      ? { kind: "approved", by: sender, at: now }
      : {
          kind: "refused",
          by: sender,
          at: now,
          revoked: answer === "revoke",
        }
  return { record: { ...record, personal } }
}

/** A lane asks for its owner's identity: it waits, unless it was answered already. */
export function planAccessAsk(input: {
  readonly record: AccessRecord
  readonly host: string | null
  readonly now: number
}): AccessRecord {
  const { record } = input
  const kind = record.personal?.kind
  return kind === undefined || kind === "unanswered"
    ? {
        ...record,
        personal: {
          kind: "waiting",
          host: input.host,
          since: input.now,
        },
      }
    : record
}

/** Nobody answered a lane that waits: it is unanswered, and asks again next time. */
export const planAccessTimeout = (
  record: AccessRecord,
  now: number,
): AccessRecord =>
  record.personal?.kind === "waiting"
    ? {
        ...record,
        personal: { kind: "unanswered", host: record.personal.host, at: now },
      }
    : record

/**
 * A starting host's records: nothing waits for an answer any longer, since
 * the requests that waited went with the host that held them, and no
 * refusal for a host not allowed is kept, since the allowed hosts are read
 * again at start.
 */
export const planAccessRecovery = (
  records: readonly AccessRecord[],
  now: number,
): readonly AccessRecord[] =>
  records
    .filter(r => r.personal?.kind === "waiting" || r.outside !== null)
    .map(r => ({ ...planAccessTimeout(r, now), outside: null }))

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

/** What a change to a lane's record does to its requests held for the owner. */
export type AccessEffect =
  /** Approved: sign what waits. */
  | "release"
  /** Refused or unanswered: refuse what waits. */
  | "refuse"
  /** Approved, then refused: refuse what waits, and end every session it holds. */
  | "cut"

export function planAccessChange(
  prev: PersonalAccess | null,
  next: PersonalAccess | null,
): AccessEffect | null {
  if (next === null || prev?.kind === next.kind) return null
  if (next.kind === "approved") return "release"
  if (next.kind === "refused" && prev?.kind === "approved") return "cut"
  if (next.kind === "refused" || next.kind === "unanswered") return "refuse"
  return null
}
