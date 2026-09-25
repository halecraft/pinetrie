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
  type ChatAt,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type Intent,
  NOBODY,
  normalizeName,
  type Position,
  parseMentions,
  type ReferenceId,
  type ReferenceTarget,
  ROOT,
  type RunId,
  referenceId,
  runId,
  THE_AGENT,
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
  | { readonly kind: "appended"; readonly id: EntryId }
  | { readonly kind: "named" }
  | { readonly kind: "threaded" }
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
    // "" is the author's own tip, as for chat; only the codec knows that.
    const at: ChatAt =
      parent === "" ? { kind: "tip" } : { kind: "entry", id: entryId(parent) }
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
  if (kind === "navigate") {
    return {
      kind: "navigate",
      to: parent === "" ? ROOT : atEntry(entryId(parent)),
    }
  }
  if (kind === "name") {
    const name = normalizeName(text(wire?.text))
    return name === undefined
      ? refuse(ERR.INVALID_NAME, "a name must be 1 to 40 characters")
      : { kind: "name", name }
  }
  if (kind === "thread") {
    if (parent === "") {
      return refuse(ERR.NO_PARENT, "a thread default must name its entry")
    }
    const mode = text(wire?.text)
    if (mode !== "session" && mode !== "conversation") {
      return refuse(ERR.UNKNOWN_KIND, `unknown thread mode: ${mode}`)
    }
    return {
      kind: "thread",
      at: entryId(parent),
      compels:
        mode === "session" ? { kind: "agent", agent: THE_AGENT } : NOBODY,
    }
  }
  if (kind === "chat") {
    const body = text(wire?.text)
    if (body === "") return refuse(ERR.EMPTY_PROMPT, "message text is empty")
    return {
      kind: "chat",
      text: body,
      // "" is the sender's own lane tip; only the codec knows that.
      at:
        parent === ""
          ? { kind: "tip" }
          : { kind: "entry", id: entryId(parent) },
      mentions: parseMentions(body),
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
      return command({
        id,
        kind: "reference",
        ...targetToWire(intent.to),
        parentId: intent.at.kind === "tip" ? "" : intent.at.id,
      })
    case "chat":
      return command({
        id,
        kind: "chat",
        text: intent.text,
        parentId: intent.at.kind === "tip" ? "" : intent.at.id,
      })
    case "name":
      return command({ id, kind: "name", text: intent.name })
    case "thread":
      return command({
        id,
        kind: "thread",
        parentId: intent.at,
        // The wire names a mode; only the host's one agent can be compelled.
        text: intent.compels.kind === "agent" ? "session" : "conversation",
      })
  }
}

/** Outcome -> the flat wire reply. */
export function encodeOutcome(id: string, outcome: Outcome): Reply {
  switch (outcome.kind) {
    case "started":
      return reply({ id, outcome: "started", runId: outcome.runId })
    case "navigated":
      return reply({ id, outcome: "navigated" })
    case "referenced":
      return reply({ id, outcome: "referenced", referenceId: outcome.id })
    case "appended":
      return reply({ id, outcome: "appended", entryId: outcome.id })
    case "named":
      return reply({ id, outcome: "named" })
    case "threaded":
      return reply({ id, outcome: "threaded" })
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
    case "navigated":
      return { kind: "navigated" }
    case "referenced":
      return { kind: "referenced", id: referenceId(wire.referenceId) }
    case "appended":
      return { kind: "appended", id: entryId(wire.entryId) }
    case "named":
      return { kind: "named" }
    case "threaded":
      return { kind: "threaded" }
    case "refused":
      return refuse(asErrCode(wire.errorCode), wire.errorMessage)
  }
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
