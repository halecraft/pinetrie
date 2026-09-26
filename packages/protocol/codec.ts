// protocol/codec — the one place wire sentinels are understood.
//
// Kyneta schemas are total, so on the wire every field is present and `""`
// stands for "absent". That is a real constraint, but only of the wire. This
// module decodes the flat wire shapes into precise unions on the way in and
// encodes them back on the way out, so no `""`, no `?? ""` and no `.trim()` of
// an id reaches decision logic.
//
// It owns every SHAPE rule. `planCommand` in @pineta/core owns only state
// policy (ready, busy). Keeping all shape rules here means the order in which
// a malformed command is refused is decided in exactly one function.

import {
  atEntry,
  CHAT_MODES,
  type ChatMode,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type Intent,
  isLaneName,
  normalizeName,
  type Position,
  parseMentions,
  type ReferenceId,
  type ReferenceTarget,
  ROOT,
  type RunId,
  referenceId,
  runId,
} from "@pineta/core"
import { type Command, command, type Reply, reply } from "./messages.ts"

export interface Refusal {
  readonly kind: "refused"
  readonly code: ErrCode
  readonly message: string
}

/** What a reply means. `reply()` flattens it for the wire. */
export type Outcome =
  | { readonly kind: "started"; readonly runId: RunId }
  | { readonly kind: "referenced"; readonly id: ReferenceId }
  | { readonly kind: "appended"; readonly id: EntryId }
  /** Waiting behind `position` messages for the thread's lane to be free. */
  | { readonly kind: "queued"; readonly position: number }
  /**
   * Another writer took the slot first: `by` is their display name, or null
   * when no one can be named (two lanes just started at one point).
   */
  | { readonly kind: "conflict"; readonly by: string | null }
  | { readonly kind: "named" }
  | { readonly kind: "stopped" }
  | Refusal

/**
 * A command as it arrives: untrusted. Every field is `unknown` because this
 * came off a socket, and typing it as our own `Command` would claim the very
 * thing decoding exists to establish.
 */
export type WireCommand = { readonly [K in keyof Command]?: unknown }

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

const refuse = (code: ErrCode, message: string): Refusal => ({
  kind: "refused",
  code,
  message,
})

/**
 * Wire command -> a well-formed intent, or the first shape rule it breaks.
 *
 * `parentId: ""` is the root, and this is the only place that knows it: for a
 * chat, where only a `branch` may start a thread; for a reference, no anchor
 * (refused by `planReference`).
 */
export function decodeCommand(
  wire: WireCommand | null | undefined,
): Intent | Refusal {
  const kind = wire?.kind
  // "" is the root. Only the codec knows that.
  const at = positionFromWire(text(wire?.parentId))

  if (kind === "reference") {
    const target = text(wire?.targetId)
    if (target === "") {
      return refuse(ERR.UNKNOWN_TARGET, "a reference must name a target")
    }
    const start = wire?.spanStart
    const end = wire?.spanEnd
    // -1 on both is the wire's "whole entry"; only the codec knows that.
    if (start === -1 && end === -1) {
      return {
        kind: "reference",
        to: { kind: "entry", id: entryId(target) },
        at,
      }
    }
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start
    ) {
      return refuse(ERR.INVALID_SPAN, "a span must satisfy 0 <= start < end")
    }
    return {
      kind: "reference",
      to: { kind: "span", id: entryId(target), start, end },
      at,
    }
  }
  if (kind === "name") {
    const name = normalizeName(text(wire?.text))
    return name === undefined
      ? refuse(
          ERR.INVALID_NAME,
          "a name must be 1 to 40 characters, with a letter or digit, and not 'agent'",
        )
      : { kind: "name", name }
  }
  if (kind === "stop") {
    const lane = text(wire?.lane)
    return isLaneName(lane)
      ? { kind: "stop", lane }
      : refuse(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
  }
  if (kind === "chat") {
    const body = text(wire?.text)
    if (body === "") return refuse(ERR.EMPTY_MESSAGE, "message text is empty")
    const mode = text(wire?.mode)
    if (!isChatMode(mode)) {
      return refuse(ERR.UNKNOWN_KIND, `unknown chat mode: ${mode}`)
    }
    if (at.kind === "root" && mode !== "branch") {
      return refuse(ERR.NO_ANCHOR, "only a branch starts a thread at the root")
    }
    const lane = text(wire?.lane)
    if (lane !== "" && !isLaneName(lane)) {
      return refuse(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
    }
    return {
      kind: "chat",
      text: body,
      at,
      mode,
      lane: isLaneName(lane) ? lane : null,
      asksAgent: wire?.asksAgent === true,
      mentions: parseMentions(body),
    }
  }
  return refuse(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(kind)}`)
}

const isChatMode = (mode: string): mode is ChatMode =>
  (CHAT_MODES as readonly string[]).includes(mode)

/** Intent -> the flat wire command. The client's half of `decodeCommand`. */
export function encodeIntent(id: string, intent: Intent): Command {
  switch (intent.kind) {
    case "reference":
      return command({
        id,
        kind: "reference",
        ...targetToWire(intent.to),
        parentId: positionToWire(intent.at),
      })
    case "chat":
      return command({
        id,
        kind: "chat",
        text: intent.text,
        parentId: positionToWire(intent.at),
        mode: intent.mode,
        lane: intent.lane ?? "",
        asksAgent: intent.asksAgent,
      })
    case "name":
      return command({ id, kind: "name", text: intent.name })
    case "stop":
      return command({ id, kind: "stop", lane: intent.lane })
  }
}

/** Outcome -> the flat wire reply. */
export function encodeOutcome(id: string, outcome: Outcome): Reply {
  switch (outcome.kind) {
    case "started":
      return reply({ id, outcome: "started", runId: outcome.runId })
    case "referenced":
      return reply({ id, outcome: "referenced", referenceId: outcome.id })
    case "appended":
      return reply({ id, outcome: "appended", entryId: outcome.id })
    case "queued":
      return reply({ id, outcome: "queued", position: outcome.position })
    case "conflict":
      return reply({ id, outcome: "conflict", by: outcome.by ?? "" })
    case "named":
      return reply({ id, outcome: "named" })
    case "stopped":
      return reply({ id, outcome: "stopped" })
    case "refused":
      return reply({
        id,
        outcome: "refused",
        errorCode: outcome.code,
        errorMessage: outcome.message,
      })
  }
}

/** Wire reply -> what it means. The client's half of `encodeOutcome`. */
export function decodeReply(wire: Reply): Outcome {
  switch (wire.outcome) {
    case "started":
      return { kind: "started", runId: runId(wire.runId) }
    case "referenced":
      return { kind: "referenced", id: referenceId(wire.referenceId) }
    case "appended":
      return { kind: "appended", id: entryId(wire.entryId) }
    case "queued":
      return { kind: "queued", position: wire.position }
    case "conflict":
      return { kind: "conflict", by: wire.by === "" ? null : wire.by }
    case "named":
      return { kind: "named" }
    case "stopped":
      return { kind: "stopped" }
    case "refused":
      return refuse(asErrCode(wire.errorCode), wire.errorMessage)
  }
}

const positionToWire = (p: Position): string => (p.kind === "root" ? "" : p.id)
const positionFromWire = (s: string): Position =>
  s === "" ? ROOT : atEntry(entryId(s))

const targetToWire = (t: ReferenceTarget) =>
  t.kind === "entry"
    ? { targetId: t.id, spanStart: -1, spanEnd: -1 }
    : { targetId: t.id, spanStart: t.start, spanEnd: t.end }

const ERR_CODES: ReadonlySet<string> = new Set(Object.values(ERR))

/**
 * A code from the wire is untrusted text. An unrecognised one is reported as
 * an unknown kind rather than cast, so `ErrCode` stays a closed set.
 */
function asErrCode(code: string): ErrCode {
  return ERR_CODES.has(code) ? (code as ErrCode) : ERR.UNKNOWN_KIND
}
