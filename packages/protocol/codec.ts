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
  CARD_COMMANDS,
  type CardCommand,
  CHAT_MODES,
  type ChatMode,
  type CommitId,
  cardId,
  commitId,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type Intent,
  isLaneName,
  isRootId,
  keyOfFields,
  LINE_ACTIONS,
  type LineAction,
  MAX_TITLE,
  type MoveRefusal,
  normalizeName,
  OFFER_ACTIONS,
  type OfferAction,
  type OfferSeen,
  type PlaceKey,
  type Position,
  parseMentions,
  parseNewLane,
  parseNewRoot,
  parseTitle,
  placeFields,
  type Refusal,
  ROOT,
  type RunId,
  refused,
  runId,
  type SentCard,
  type WorkSetting,
  type WriterId,
} from "@pineta/core"
import { type Command, command, type Reply, reply } from "./messages.ts"

/** What a reply means. `reply()` flattens it for the wire. */
export type Outcome =
  | { readonly kind: "started"; readonly runId: RunId }
  | { readonly kind: "appended"; readonly id: EntryId }
  /**
   * The thread's lane is running, or has cards queued: nothing was written.
   * A chat sent from a card is queued instead (`queued`).
   */
  | { readonly kind: "busy" }
  /** The lane was busy, so the host queued the chat's card behind the others (ADR-0059). */
  | { readonly kind: "queued" }
  /** A move or a command on a card was carried out (ADR-0059). */
  | { readonly kind: "moved" }
  /**
   * A move the host refused (ADR-0059): why, where the card is now (null
   * when it is gone), and who put it there.
   */
  | {
      readonly kind: "unmoved"
      readonly code: MoveRefusal
      readonly place: PlaceKey | null
      readonly by: WriterId | null
    }
  /**
   * Someone took the slot first: `by` is their writer, the sender's own when
   * the host falls back to the lane's asker, or null when no one can be named
   * (two lanes just started at one point).
   */
  | { readonly kind: "conflict"; readonly by: WriterId | null }
  | { readonly kind: "named" }
  | { readonly kind: "stopped" }
  /** A root is archived, or restored (ADR-0029); also when it already was. */
  | { readonly kind: "archived" }
  | { readonly kind: "restored" }
  /** An entry's title is set or cleared (ADR-0045); also when it already was. */
  | { readonly kind: "marked" }
  /** The lane's offer is in your history now (ADR-0038). */
  | { readonly kind: "taken" }
  /** An offer action was carried out (squash, describe, refresh). */
  | { readonly kind: "offered" }
  /** A thread is named before its lane exists, or already was (ADR-0057). */
  | { readonly kind: "reserved" }
  /** The integration line was set up, or moved forward to your work (ADR-0060). */
  | { readonly kind: "line-moved" }
  | Refusal
  /**
   * The host failed carrying the command out, and may have done part of it:
   * unlike a refusal, it does not say that nothing was written.
   */
  | { readonly kind: "failed"; readonly message: string }

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
    const reserved = text(wire?.reserved)
    const reservedLane = reserved === "" ? null : parseNewLane(reserved)
    if (reservedLane === undefined) return notNewLane(reserved)
    const base = text(wire?.base)
    const rootText = text(wire?.root)
    // A thread at the root starts a root, under the id its tab minted.
    const root =
      at.kind === "root"
        ? parseNewRoot(rootText)
        : isRootId(rootText)
          ? rootText
          : undefined
    if (root === undefined)
      return refused(ERR.UNKNOWN_TARGET, `not a root: ${rootText}`)
    return {
      kind: "chat",
      text: body,
      root,
      at,
      mode,
      lane: isLaneName(lane) ? lane : null,
      asksAgent: wire?.asksAgent === true,
      mentions: parseMentions(body),
      work,
      card: cardFromWire(text(wire?.cardId), text(wire?.seen)),
      reserved: reservedLane,
      base: base === "" ? null : base,
    }
  }
  if (kind === "line") {
    const action = text(wire?.mode)
    return isLineAction(action)
      ? { kind, action }
      : refused(ERR.UNKNOWN_KIND, `unknown line action: ${action}`)
  }
  if (kind === "move") {
    const card = text(wire?.cardId)
    if (card === "")
      return refused(ERR.UNKNOWN_TARGET, "a move must name its card")
    const from = decodeKey(text(wire?.from))
    const to = decodeKey(text(wire?.to))
    if (from === undefined || to === undefined)
      return refused(ERR.UNKNOWN_TARGET, "a move names a malformed place")
    if (from === null && to === null)
      return refused(ERR.UNKNOWN_TARGET, "a move must name a place")
    return { kind: "move", move: { card: cardId(card), from, to } }
  }
  if (kind === "set-command") {
    const card = text(wire?.cardId)
    if (card === "")
      return refused(ERR.UNKNOWN_TARGET, "a command must name its card")
    const name = text(wire?.mode)
    if (name !== "" && !isCardCommand(name))
      return refused(ERR.UNKNOWN_KIND, `unknown card command: ${name}`)
    return {
      kind: "set-command",
      card: cardId(card),
      command: name === "" ? null : name,
    }
  }
  if (kind === "reserve") {
    const lane = text(wire?.lane)
    const reserved = parseNewLane(lane)
    return reserved === undefined
      ? notNewLane(lane)
      : { kind: "reserve", lane: reserved }
  }
  if (kind === "offer") {
    const lane = text(wire?.lane)
    if (!isLaneName(lane))
      return refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
    const action = text(wire?.mode)
    const to = text(wire?.targetId)
    if (!isOfferAction(action))
      return refused(ERR.UNKNOWN_KIND, `unknown offer action: ${action}`)
    if (action !== "take") return { kind, lane, action, to: null, seen: null }
    const seen = offerSeenFromWire(text(wire?.seen))
    return seen === null
      ? refused(ERR.REFUSED, "a take must say which offer it was shown")
      : { kind, lane, action, to: to === "" ? null : to, seen }
  }
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
    const root = text(wire?.root)
    if (!isRootId(root))
      return refused(ERR.UNKNOWN_TARGET, `not a root: ${root}`)
    const title = parseTitle(text(wire?.text))
    switch (title.kind) {
      case "invalid":
        return refused(
          ERR.INVALID_TITLE,
          `a title is one line of at most ${MAX_TITLE} characters`,
        )
      case "clear":
        return { kind: "mark", root, entry: entryId(entry), title: null }
      case "set":
        return { kind: "mark", root, entry: entryId(entry), title: title.title }
    }
  }
  return refused(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(kind)}`)
}

const notNewLane = (lane: string): Refusal =>
  refused(ERR.UNKNOWN_TARGET, `not a new thread's lane: ${lane}`)

/** What a take was shown, as the wire carries it in `seen`: JSON. */
export const offerSeenToWire = (seen: OfferSeen | null): string =>
  seen === null ? "" : JSON.stringify(seen)

const isCommit = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]+$/.test(v)

/** The wire's `seen` for a take -> what it was shown; null when malformed. */
function offerSeenFromWire(wire: string): OfferSeen | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(wire)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const { ledger, conflicted } = parsed as Record<string, unknown>
  if (typeof conflicted !== "boolean") return null
  if (ledger === null) return { ledger: null, conflicted }
  if (typeof ledger !== "object" || ledger === undefined) return null
  const { source, start } = ledger as Record<string, unknown>
  if (
    !isCommit(source) ||
    !Array.isArray(start) ||
    start.length === 0 ||
    !start.every(isCommit)
  )
    return null
  const commits: CommitId[] = start.map(commitId)
  return { ledger: { source: commitId(source), start: commits }, conflicted }
}

/** A chat's card on the wire, with its text's version: `""` is none. */
const cardFromWire = (id: string, seen: string): SentCard | null =>
  id === "" ? null : { id: cardId(id), seen }

const isCardCommand = (c: string): c is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(c)

/** A place's key -> the wire: its flat fields as JSON, `""` for none. */
export const encodeKey = (key: PlaceKey | null): string => {
  if (key === null) return ""
  const { kind, root, at, lane, column, seen, holder } = placeFields(key)
  return JSON.stringify({ kind, root, at, lane, column, seen, holder })
}

/**
 * The wire -> a place's key: null for `""`, undefined for anything
 * malformed. The flat fields are read by core's `keyOfFields`, as the
 * places document's are by `placeOfFields`, so the two cannot drift.
 */
export function decodeKey(s: string): PlaceKey | null | undefined {
  if (s === "") return null
  let value: unknown
  try {
    value = JSON.parse(s)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null) return undefined
  const v = value as Record<string, unknown>
  const field = (k: string) =>
    typeof v[k] === "string" ? (v[k] as string) : ""
  return keyOfFields({
    kind: field("kind"),
    root: field("root"),
    at: field("at"),
    lane: field("lane"),
    column: field("column"),
    order: "",
    by: "",
    seen: field("seen"),
    holder: field("holder"),
  })
}

const MOVE_REFUSALS: readonly MoveRefusal[] = [
  "moved",
  "gone",
  "exists",
  "not-fresh",
  "full",
  "not-yours",
]
const isMoveRefusal = (c: string): c is MoveRefusal =>
  (MOVE_REFUSALS as readonly string[]).includes(c)

const isOfferAction = (a: string): a is OfferAction =>
  (OFFER_ACTIONS as readonly string[]).includes(a)

const isLineAction = (a: string): a is LineAction =>
  (LINE_ACTIONS as readonly string[]).includes(a)

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
        root: intent.root,
        mode: intent.mode,
        lane: intent.lane ?? "",
        asksAgent: intent.asksAgent,
        ...workToWire(intent.work),
        cardId: intent.card?.id ?? "",
        seen: intent.card?.seen ?? "",
        reserved: intent.reserved ?? "",
        base: intent.base ?? "",
      })
    case "name":
      return command({ id, kind: "name", text: intent.name })
    case "stop":
      return command({ id, kind: "stop", lane: intent.lane })
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
        root: intent.root,
        targetId: intent.entry,
        text: intent.title ?? "",
      })
    case "offer":
      return command({
        id,
        kind: "offer",
        lane: intent.lane,
        mode: intent.action,
        targetId: intent.to ?? "",
        seen: offerSeenToWire(intent.seen),
      })
    case "line":
      return command({ id, kind: "line", mode: intent.action })
    case "reserve":
      return command({ id, kind: "reserve", lane: intent.lane })
    case "move":
      return command({
        id,
        kind: "move",
        cardId: intent.move.card,
        from: encodeKey(intent.move.from),
        to: encodeKey(intent.move.to),
      })
    case "set-command":
      return command({
        id,
        kind: "set-command",
        cardId: intent.card,
        mode: intent.command ?? "",
      })
  }
}

/**
 * Outcome -> the flat wire reply. `rev` is the places document's after the
 * command's step, when the step wrote it or refused a move (ADR-0059).
 */
export function encodeOutcome(
  id: string,
  outcome: Outcome,
  rev: number | null = null,
): Reply {
  return { ...outcomeToWire(id, outcome), rev: rev ?? 0 }
}

function outcomeToWire(id: string, outcome: Outcome): Reply {
  switch (outcome.kind) {
    case "started":
      return reply({ id, outcome: "started", runId: outcome.runId })
    case "appended":
      return reply({ id, outcome: "appended", entryId: outcome.id })
    case "busy":
      return reply({ id, outcome: "busy" })
    case "conflict":
      return reply({ id, outcome: "conflict", by: outcome.by ?? "" })
    case "named":
      return reply({ id, outcome: "named" })
    case "stopped":
      return reply({ id, outcome: "stopped" })
    case "archived":
      return reply({ id, outcome: "archived" })
    case "restored":
      return reply({ id, outcome: "restored" })
    case "marked":
      return reply({ id, outcome: "marked" })
    case "taken":
      return reply({ id, outcome: "taken" })
    case "offered":
      return reply({ id, outcome: "offered" })
    case "reserved":
      return reply({ id, outcome: "reserved" })
    case "line-moved":
      return reply({ id, outcome: "line-moved" })
    case "queued":
      return reply({ id, outcome: "queued" })
    case "moved":
      return reply({ id, outcome: "moved" })
    case "unmoved":
      return reply({
        id,
        outcome: "unmoved",
        errorCode: outcome.code,
        place: encodeKey(outcome.place),
        by: outcome.by ?? "",
      })
    case "refused":
      return reply({
        id,
        outcome: "refused",
        errorCode: outcome.code,
        errorMessage: outcome.message,
      })
    case "failed":
      return reply({ id, outcome: "failed", errorMessage: outcome.message })
  }
}

/** Wire reply -> what it means. The client's half of `encodeOutcome`. */
export function decodeReply(wire: Reply): Outcome {
  switch (wire.outcome) {
    case "started":
      return { kind: "started", runId: runId(wire.runId) }
    case "appended":
      return { kind: "appended", id: entryId(wire.entryId) }
    case "busy":
      return { kind: "busy" }
    case "conflict":
      return {
        kind: "conflict",
        by: wire.by === "" ? null : (wire.by as WriterId),
      }
    case "named":
      return { kind: "named" }
    case "stopped":
      return { kind: "stopped" }
    case "archived":
      return { kind: "archived" }
    case "restored":
      return { kind: "restored" }
    case "marked":
      return { kind: "marked" }
    case "taken":
      return { kind: "taken" }
    case "offered":
      return { kind: "offered" }
    case "reserved":
      return { kind: "reserved" }
    case "line-moved":
      return { kind: "line-moved" }
    case "queued":
      return { kind: "queued" }
    case "moved":
      return { kind: "moved" }
    case "unmoved":
      return {
        kind: "unmoved",
        code: isMoveRefusal(wire.errorCode) ? wire.errorCode : "gone",
        place: decodeKey(wire.place) ?? null,
        by: wire.by === "" ? null : (wire.by as WriterId),
      }
    case "refused":
      return refused(asErrCode(wire.errorCode), wire.errorMessage)
    case "failed":
      return { kind: "failed", message: wire.errorMessage }
  }
}

/** A reply's `rev`: the places document's after its step, or null for none. */
export const revOfReply = (wire: Reply): number | null =>
  wire.rev > 0 ? wire.rev : null

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
