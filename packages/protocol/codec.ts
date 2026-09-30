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
  ARCHIVE_ACTIONS,
  type ArchiveAction,
  atEntry,
  CHAT_MODES,
  type ChatMode,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type Intent,
  isLaneName,
  MAX_TITLE,
  NOTE_ACTIONS,
  type NoteAction,
  type NoteId,
  normalizeName,
  noteId,
  OFFER_ACTIONS,
  type OfferAction,
  type Position,
  parseMentions,
  parseTitle,
  type Refusal,
  ROOT,
  type RunId,
  refused,
  runId,
  type WorkSetting,
  type WriterId,
} from "@pineta/core"
import { type Command, command, type Reply, reply } from "./messages.ts"

/** What a reply means. `reply()` flattens it for the wire. */
export type Outcome =
  | { readonly kind: "started"; readonly runId: RunId }
  | { readonly kind: "appended"; readonly id: EntryId }
  /** Waiting behind `position` messages for the thread's lane to be free. */
  | { readonly kind: "queued"; readonly position: number }
  /**
   * Someone took the slot first: `by` is their writer, the sender's own when
   * the host falls back to the lane's asker, or null when no one can be named
   * (two lanes just started at one point).
   */
  | { readonly kind: "conflict"; readonly by: WriterId | null }
  | { readonly kind: "named" }
  | { readonly kind: "stopped" }
  /** A note was made, joined or moved on: its id. */
  | { readonly kind: "noted"; readonly id: NoteId }
  /** A root is archived, or restored (ADR-0029); also when it already was. */
  | { readonly kind: "archived" }
  | { readonly kind: "restored" }
  /** An entry's title is set or cleared (ADR-0045); also when it already was. */
  | { readonly kind: "marked" }
  /** The lane's offer is in your history now (ADR-0038). */
  | { readonly kind: "taken" }
  /**
   * Your work was merged into the thread (ADR-0038). `text` is the composer's
   * prefill after a clean merge; "" when there was nothing to merge.
   */
  | { readonly kind: "updated"; readonly text: string }
  /** An offer action was carried out (squash, describe, refresh). */
  | { readonly kind: "offered" }
  | Refusal

/**
 * A command as it arrives: untrusted. Every field is `unknown` because this
 * came off a socket, and typing it as our own `Command` would claim the very
 * thing decoding exists to establish.
 */
export type WireCommand = { readonly [K in keyof Command]?: unknown }

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * Wire command -> a well-formed intent, or the first shape rule it breaks.
 *
 * `parentId: ""` is the root, and this is the only place that knows it: for a
 * chat, where only a `branch` may start a thread.
 */
export function decodeCommand(
  wire: WireCommand | null | undefined,
): Intent | Refusal {
  const kind = wire?.kind
  // "" is the root. Only the codec knows that.
  const at = positionFromWire(text(wire?.parentId))

  if (kind === "name") {
    const name = normalizeName(text(wire?.text))
    return name === undefined
      ? refused(
          ERR.INVALID_NAME,
          "a name must be 1 to 40 characters, with a letter or digit, and not 'agent'",
        )
      : { kind: "name", name }
  }
  if (kind === "stop") {
    const lane = text(wire?.lane)
    return isLaneName(lane)
      ? { kind: "stop", lane }
      : refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
  }
  if (kind === "chat") {
    const body = text(wire?.text)
    if (body === "") return refused(ERR.EMPTY_MESSAGE, "message text is empty")
    const mode = text(wire?.mode)
    if (!isChatMode(mode)) {
      return refused(ERR.UNKNOWN_KIND, `unknown chat mode: ${mode}`)
    }
    if (at.kind === "root" && mode !== "branch") {
      return refused(ERR.NO_ANCHOR, "only a branch starts a thread at the root")
    }
    const lane = text(wire?.lane)
    if (lane !== "" && !isLaneName(lane)) {
      return refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
    }
    const work = workFromWire(text(wire?.workKind), text(wire?.workDir))
    if (work === "invalid")
      return refused(ERR.BAD_DIRECTORY, "working directly needs a directory")
    return {
      kind: "chat",
      text: body,
      at,
      mode,
      lane: isLaneName(lane) ? lane : null,
      asksAgent: wire?.asksAgent === true,
      mentions: parseMentions(body),
      work,
    }
  }
  if (kind === "update" || kind === "offer") {
    const lane = text(wire?.lane)
    if (!isLaneName(lane))
      return refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
    if (kind === "update") return { kind, lane }
    const action = text(wire?.mode)
    return isOfferAction(action)
      ? { kind, lane, action }
      : refused(ERR.UNKNOWN_KIND, `unknown offer action: ${action}`)
  }
  if (kind === "note") return decodeNote(wire, at)
  if (kind === "archive") {
    const action = text(wire?.mode)
    if (!isArchiveAction(action))
      return refused(ERR.UNKNOWN_KIND, `unknown archive action: ${action}`)
    const root = text(wire?.targetId)
    return root === ""
      ? refused(ERR.UNKNOWN_TARGET, "an archive action must name its root")
      : { kind: "archive", action, root: entryId(root) }
  }
  if (kind === "mark") {
    const entry = text(wire?.targetId)
    if (entry === "")
      return refused(ERR.UNKNOWN_TARGET, "a mark must name its entry")
    const title = parseTitle(text(wire?.text))
    switch (title.kind) {
      case "invalid":
        return refused(
          ERR.INVALID_TITLE,
          `a title is one line of at most ${MAX_TITLE} characters`,
        )
      case "clear":
        return { kind: "mark", entry: entryId(entry), title: null }
      case "set":
        return { kind: "mark", entry: entryId(entry), title: title.title }
    }
  }
  return refused(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(kind)}`)
}

/** A `note` command: `mode` names the action; only the codec reads it there. */
function decodeNote(
  wire: WireCommand | null | undefined,
  at: Position,
): Intent | Refusal {
  const action = text(wire?.mode)
  if (!isNoteAction(action))
    return refused(ERR.UNKNOWN_KIND, `unknown note action: ${action}`)
  const note = (a: NoteAction): Intent => ({ kind: "note", action: a })
  if (action === "open") {
    return at.kind === "root"
      ? refused(ERR.NO_ANCHOR, "the root is no message to open")
      : note({ kind: "open", entry: at.id })
  }
  if (action === "draft") {
    if (at.kind === "root")
      return refused(ERR.NO_ANCHOR, "a draft continues a thread")
    const lane = text(wire?.lane)
    if (lane !== "" && !isLaneName(lane))
      return refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
    return note({
      kind: "draft",
      at,
      lane: isLaneName(lane) ? lane : null,
      // What its sender had typed, as typed: a draft is not trimmed.
      text: typeof wire?.text === "string" ? wire.text : "",
    })
  }
  const target = text(wire?.targetId)
  return target === ""
    ? refused(ERR.UNKNOWN_TARGET, "a note action must name its note")
    : note({ kind: action, note: noteId(target) })
}

const isNoteAction = (a: string): a is (typeof NOTE_ACTIONS)[number] =>
  (NOTE_ACTIONS as readonly string[]).includes(a)

const isOfferAction = (a: string): a is OfferAction =>
  (OFFER_ACTIONS as readonly string[]).includes(a)

const isArchiveAction = (a: string): a is ArchiveAction =>
  (ARCHIVE_ACTIONS as readonly string[]).includes(a)

const isChatMode = (mode: string): mode is ChatMode =>
  (CHAT_MODES as readonly string[]).includes(mode)

/** The wire's work fields -> a setting, null for "the lane above's", or invalid. */
function workFromWire(
  kind: string,
  dir: string,
): WorkSetting | null | "invalid" {
  if (kind === "") return null
  if (kind === "own") return { kind: "own" }
  if (kind === "direct") return dir === "" ? "invalid" : { kind: "direct", dir }
  return "invalid"
}

const workToWire = (work: WorkSetting | null) =>
  work === null
    ? { workKind: "", workDir: "" }
    : work.kind === "own"
      ? { workKind: "own", workDir: "" }
      : { workKind: "direct", workDir: work.dir }

/** Intent -> the flat wire command. The client's half of `decodeCommand`. */
export function encodeIntent(id: string, intent: Intent): Command {
  switch (intent.kind) {
    case "chat":
      return command({
        id,
        kind: "chat",
        text: intent.text,
        parentId: positionToWire(intent.at),
        mode: intent.mode,
        lane: intent.lane ?? "",
        asksAgent: intent.asksAgent,
        ...workToWire(intent.work),
      })
    case "name":
      return command({ id, kind: "name", text: intent.name })
    case "stop":
      return command({ id, kind: "stop", lane: intent.lane })
    case "note":
      return command({ id, kind: "note", ...noteToWire(intent.action) })
    case "archive":
      return command({
        id,
        kind: "archive",
        mode: intent.action,
        targetId: intent.root,
      })
    case "mark":
      return command({
        id,
        kind: "mark",
        targetId: intent.entry,
        text: intent.title ?? "",
      })
    case "update":
      return command({ id, kind: "update", lane: intent.lane })
    case "offer":
      return command({
        id,
        kind: "offer",
        lane: intent.lane,
        mode: intent.action,
      })
  }
}

const noteToWire = (a: NoteAction) => {
  switch (a.kind) {
    case "open":
      return { mode: "open", parentId: a.entry }
    case "draft":
      return {
        mode: "draft",
        parentId: positionToWire(a.at),
        lane: a.lane ?? "",
        text: a.text,
      }
    default:
      return { mode: a.kind, targetId: a.note }
  }
}

/** Outcome -> the flat wire reply. */
export function encodeOutcome(id: string, outcome: Outcome): Reply {
  switch (outcome.kind) {
    case "started":
      return reply({ id, outcome: "started", runId: outcome.runId })
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
    case "noted":
      return reply({ id, outcome: "noted", noteId: outcome.id })
    case "archived":
      return reply({ id, outcome: "archived" })
    case "restored":
      return reply({ id, outcome: "restored" })
    case "marked":
      return reply({ id, outcome: "marked" })
    case "taken":
      return reply({ id, outcome: "taken" })
    case "updated":
      return reply({ id, outcome: "updated", text: outcome.text })
    case "offered":
      return reply({ id, outcome: "offered" })
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
    case "appended":
      return { kind: "appended", id: entryId(wire.entryId) }
    case "queued":
      return { kind: "queued", position: wire.position }
    case "conflict":
      return {
        kind: "conflict",
        by: wire.by === "" ? null : (wire.by as WriterId),
      }
    case "named":
      return { kind: "named" }
    case "stopped":
      return { kind: "stopped" }
    case "noted":
      return { kind: "noted", id: noteId(wire.noteId) }
    case "archived":
      return { kind: "archived" }
    case "restored":
      return { kind: "restored" }
    case "marked":
      return { kind: "marked" }
    case "taken":
      return { kind: "taken" }
    case "updated":
      return { kind: "updated", text: wire.text }
    case "offered":
      return { kind: "offered" }
    case "refused":
      return refused(asErrCode(wire.errorCode), wire.errorMessage)
  }
}

const positionToWire = (p: Position): string => (p.kind === "root" ? "" : p.id)
const positionFromWire = (s: string): Position =>
  s === "" ? ROOT : atEntry(entryId(s))

const ERR_CODES: ReadonlySet<string> = new Set(Object.values(ERR))

/**
 * A code from the wire is untrusted text. An unrecognised one is reported as
 * an unknown kind rather than cast, so `ErrCode` stays a closed set.
 */
function asErrCode(code: string): ErrCode {
  return ERR_CODES.has(code) ? (code as ErrCode) : ERR.UNKNOWN_KIND
}
