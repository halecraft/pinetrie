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
  ERR,
  type ErrCode,
  entryId,
  type Intent,
  type Position,
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
  | { readonly kind: "navigated" }
  | { readonly kind: "referenced"; readonly id: ReferenceId }
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
 * `parentId: ""` means different things per kind, and this is the only place
 * that knows it: on a `navigate` it means the root; on a `branch` it means no
 * parent was named, which is refused.
 *
 * Order matters and is pinned by a test: empty text is reported before a
 * missing parent, so a user is told the first thing that is wrong.
 */
export function decodeCommand(
  wire: WireCommand | null | undefined,
): Intent | Refusal {
  const kind = wire?.kind
  const parent = text(wire?.parentId)

  if (kind === "reference") {
    const target = text(wire?.targetId)
    if (target === "") {
      return refuse(ERR.UNKNOWN_TARGET, "a reference must name a target")
    }
    const start = wire?.spanStart
    const end = wire?.spanEnd
    // -1 on both is the wire's "whole entry"; only the codec knows that.
    if (start === -1 && end === -1) {
      return { kind: "reference", to: { kind: "entry", id: entryId(target) } }
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
    }
  }
  if (kind === "navigate") {
    return {
      kind: "navigate",
      to: parent === "" ? ROOT : atEntry(entryId(parent)),
    }
  }
  if (kind !== "prompt" && kind !== "branch") {
    return refuse(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(kind)}`)
  }

  const body = text(wire?.text)
  if (body === "") return refuse(ERR.EMPTY_PROMPT, "prompt text is empty")
  if (kind === "prompt") return { kind: "prompt", text: body }

  if (parent === "") {
    return refuse(ERR.NO_PARENT, "a branch must name a parent entry")
  }
  return { kind: "branch", text: body, from: entryId(parent) }
}

/** Intent -> the flat wire command. The client's half of `decodeCommand`. */
export function encodeIntent(id: string, intent: Intent): Command {
  switch (intent.kind) {
    case "prompt":
      return command({ id, kind: "prompt", text: intent.text })
    case "branch":
      return command({
        id,
        kind: "branch",
        text: intent.text,
        parentId: intent.from,
      })
    case "navigate":
      return command({
        id,
        kind: "navigate",
        parentId: positionToWire(intent.to),
      })
    case "reference":
      return command({ id, kind: "reference", ...targetToWire(intent.to) })
  }
}

/** Outcome -> the flat wire reply. */
export function encodeOutcome(id: string, outcome: Outcome): Reply {
  switch (outcome.kind) {
    case "started":
      return reply({ id, accepted: true, runId: outcome.runId })
    case "navigated":
      return reply({ id, accepted: true })
    case "referenced":
      return reply({ id, accepted: true, referenceId: outcome.id })
    case "refused":
      return reply({
        id,
        accepted: false,
        errorCode: outcome.code,
        errorMessage: outcome.message,
      })
  }
}

/** Wire reply -> what it means. The client's half of `encodeOutcome`. */
export function decodeReply(wire: Reply): Outcome {
  if (!wire.accepted) {
    return refuse(asErrCode(wire.errorCode), wire.errorMessage)
  }
  if (wire.referenceId !== "") {
    return { kind: "referenced", id: referenceId(wire.referenceId) }
  }
  return wire.runId === ""
    ? { kind: "navigated" }
    : { kind: "started", runId: runId(wire.runId) }
}

const positionToWire = (p: Position): string => (p.kind === "root" ? "" : p.id)

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
