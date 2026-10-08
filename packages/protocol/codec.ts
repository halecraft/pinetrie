// protocol/codec — the one place wire sentinels are understood.
//
// Kyneta schemas are total, so on the wire every field is present and `""`
// stands for "absent". That is a real constraint, but only of the wire. This
// module decodes the flat wire shapes into precise unions on the way in and
// encodes them back on the way out, so no `""`, no `?? ""` and no `.trim()` of
// an id reaches decision logic.
//
// It owns every SHAPE rule. `planCommand` in @pinetrie/core owns only state
// policy (ready, busy). Keeping all shape rules here means the order in which
// a malformed command is refused is decided in exactly one function.

import {
  atEntry,
  CARD_COMMANDS,
  type CardCommand,
  type CardId,
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
  isSha256,
  isWorkflowStateId,
  keyOfFields,
  MAX_TITLE,
  MOVE_DIRECTIONS,
  type Move,
  type MoveDirection,
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
  QUEUE_HOLD_CHANGES,
  type QueueHoldChange,
  type Refusal,
  type Reorder,
  ROOT,
  type RootId,
  type RunId,
  refused,
  runId,
  type SentCard,
  WORKFLOW_ACTIONS,
  type WorkflowAction,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
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
  /** A move of cards, or a command on a card, was carried out (ADR-0059). */
  | { readonly kind: "moved" }
  /** A thread's queue is held now, whoever held it first (ADR-0048 step 7). */
  | { readonly kind: "held" }
  /** A thread's queue is released now (ADR-0048 step 7). */
  | { readonly kind: "released" }
  /** An undo or redo of moves moved these cards, each to the place it is now (ADR-0066). */
  | { readonly kind: "undone"; readonly cards: readonly MovedCard[] }
  /** An undo or redo found nothing to do. */
  | { readonly kind: "nothing" }
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
   * Someone wrote at the slot first: `by` is their writer, the sender's own when
   * the host falls back to the lane's asker, or null when no one can be named
   * (two lanes just started at one point).
   */
  | { readonly kind: "conflict"; readonly by: WriterId | null }
  | { readonly kind: "named" }
  /** The sender's picture is set, or removed (ADR-0098). */
  | { readonly kind: "pictured" }
  | { readonly kind: "stopped" }
  /**
   * A root moved on the board, or already there (ADR-0112): into the closed
   * state it is archived, and out of it restored.
   */
  | { readonly kind: "moved-root" }
  /** The workflow's states changed, or already were as asked (ADR-0112). */
  | { readonly kind: "workflow-changed" }
  /** An entry's title is set or cleared (ADR-0045); also when it already was. */
  | { readonly kind: "marked" }
  /** A model is asked for a root's title, which arrives as its mark (ADR-0074). */
  | { readonly kind: "retitling" }
  /** The lane's offer is accepted into accepted work or a WIP now (ADR-0104). */
  | { readonly kind: "accepted" }
  /** An offer action was carried out (squash, describe, refresh). */
  | { readonly kind: "offered" }
  /** A thread is named before its lane exists, or already was (ADR-0057). */
  | { readonly kind: "reserved" }
  /** Traces the sender has seen are gone (ADR-0048). */
  | { readonly kind: "seen" }
  /** Accepted work was set up, or published (ADR-0104, ADR-0090). */
  | { readonly kind: "accepted-moved" }
  | Refusal
  /**
   * The host failed carrying the command out, and may have done part of it:
   * unlike a refusal, it does not say that nothing was written.
   */
  | { readonly kind: "failed"; readonly message: string }

/** A card an undo moved, and its place now: null when the undo removed it. */
export interface MovedCard {
  readonly card: CardId
  readonly place: PlaceKey | null
}

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
  if (kind === "picture") {
    const sha = text(wire?.text)
    if (sha === "") return { kind: "picture", sha256: null }
    return isSha256(sha)
      ? { kind: "picture", sha256: sha }
      : refused(ERR.IMAGE_MISSING, `not a stored image's hash: ${sha}`)
  }
  if (kind === "stop" || kind === "carry-on" || kind === "unqueue-all") {
    const lane = text(wire?.lane)
    return isLaneName(lane)
      ? { kind, lane }
      : refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
  }
  if (kind === "queue-hold") {
    const lane = text(wire?.lane)
    if (!isLaneName(lane))
      return refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
    const mode = text(wire?.mode)
    return mode === "hold" || mode === "release"
      ? { kind, lane, held: mode === "hold" }
      : refused(ERR.UNKNOWN_KIND, `unknown queue hold: ${mode}`)
  }
  if (kind === "reorder") {
    const reorder = decodeReorder(text(wire?.cardId), text(wire?.moves))
    return typeof reorder === "string"
      ? refused(ERR.UNKNOWN_TARGET, reorder)
      : { kind, reorder }
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
    const reserved = text(wire?.reserved)
    const reservedLane = reserved === "" ? null : parseNewLane(reserved)
    if (reservedLane === undefined) return notNewLane(reserved)
    const base = text(wire?.base)
    const pinned = pinnedFromWire(text(wire?.pinned))
    if (pinned === undefined)
      return refused(ERR.UNKNOWN_TARGET, "malformed pinned cards")
    const stateText = text(wire?.state)
    if (stateText !== "" && !isWorkflowStateId(stateText))
      return refused(ERR.UNKNOWN_STATE, `not a workflow state: ${stateText}`)
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
      card: cardFromWire(text(wire?.cardId), text(wire?.seen)),
      pinned,
      reserved: reservedLane,
      base: base === "" ? null : base,
      state: stateText === "" ? null : (stateText as WorkflowStateId),
    }
  }
  if (kind === "setup" || kind === "publish") return { kind }
  if (kind === "move") {
    const moves = decodeMoves(text(wire?.moves))
    if (typeof moves === "string") return refused(ERR.UNKNOWN_TARGET, moves)
    // One way into a queue, which decides its hold too (ADR-0113).
    return moves.some(m => m.to.kind === "queued")
      ? refused(ERR.UNKNOWN_TARGET, "a card is queued by queue-card")
      : { kind: "move", moves }
  }
  if (kind === "queue-card") {
    const moves = decodeMoves(text(wire?.moves))
    if (typeof moves === "string") return refused(ERR.UNKNOWN_TARGET, moves)
    const [move, ...more] = moves
    if (move === undefined || more.length > 0 || move.to.kind !== "queued")
      return refused(
        ERR.UNKNOWN_TARGET,
        "a queue-card names one move into a queue",
      )
    const hold = text(wire?.mode)
    return isQueueHoldChange(hold)
      ? { kind, move, hold }
      : refused(ERR.UNKNOWN_KIND, `unknown queue hold change: ${hold}`)
  }
  if (kind === "undo-move") {
    const root = text(wire?.root)
    if (!isRootId(root))
      return refused(ERR.UNKNOWN_TARGET, `not a root: ${root}`)
    const direction = text(wire?.mode)
    return isMoveDirection(direction)
      ? { kind, root, direction }
      : refused(ERR.UNKNOWN_KIND, `unknown undo direction: ${direction}`)
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
  if (kind === "traces-seen") {
    const traces = tracesFromWire(text(wire?.text))
    return traces === undefined
      ? refused(
          ERR.UNKNOWN_TARGET,
          `traces seen must be 1 to ${MAX_TRACES_SEEN} ids`,
        )
      : { kind: "traces-seen", traces }
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
    if (action !== "accept") return { kind, lane, action, to: null, seen: null }
    const seen = offerSeenFromWire(text(wire?.seen))
    return seen === null
      ? refused(ERR.REFUSED, "an acceptance must say which offer it was shown")
      : { kind, lane, action, to: to === "" ? null : to, seen }
  }
  if (kind === "move-root") {
    const root = text(wire?.root)
    if (!isRootId(root))
      return refused(ERR.UNKNOWN_TARGET, `not a root: ${root}`)
    const move = rootMoveFromWire(text(wire?.text))
    return move === null
      ? refused(ERR.UNKNOWN_STATE, "a move on the board names its states")
      : { kind: "move-root", root, ...move }
  }
  if (kind === "workflow") {
    const action = text(wire?.mode)
    if (!isWorkflowAction(action))
      return refused(ERR.UNKNOWN_KIND, `unknown workflow action: ${action}`)
    const state = text(wire?.targetId)
    const before = text(wire?.parentId)
    if (
      (state !== "" && !isWorkflowStateId(state)) ||
      (before !== "" && !isWorkflowStateId(before))
    )
      return refused(ERR.UNKNOWN_STATE, "not a workflow state")
    if (action !== "add" && state === "")
      return refused(ERR.UNKNOWN_STATE, `a ${action} names its state`)
    return {
      kind: "workflow",
      edit: {
        action,
        state: state === "" ? null : (state as WorkflowStateId),
        name: text(wire?.text),
        before: before === "" ? null : (before as WorkflowStateId),
      },
    }
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
  if (kind === "retitle") {
    const root = text(wire?.root)
    return isRootId(root)
      ? { kind: "retitle", root }
      : refused(ERR.UNKNOWN_TARGET, `not a root: ${root}`)
  }
  return refused(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(kind)}`)
}

const notNewLane = (lane: string): Refusal =>
  refused(ERR.UNKNOWN_TARGET, `not a new thread's lane: ${lane}`)

/** What an acceptance was shown, as the wire carries it in `seen`: JSON. */
export const offerSeenToWire = (seen: OfferSeen | null): string =>
  seen === null ? "" : JSON.stringify(seen)

const isCommit = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]+$/.test(v)

/** The wire's `seen` for an acceptance -> what it was shown; null when malformed. */
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

/** A chat's pinned cards -> the wire: a JSON list of `{ card, seen }`, `""` for none. */
const pinnedToWire = (pinned: readonly SentCard[]): string =>
  pinned.length === 0
    ? ""
    : JSON.stringify(pinned.map(p => ({ card: p.id, seen: p.seen })))

/** The wire -> a chat's pinned cards; undefined for anything malformed. */
/** The most traces one `traces-seen` names: a column's worth, and more. */
export const MAX_TRACES_SEEN = 100

/** A JSON list of trace ids, each non-empty: 1 to `MAX_TRACES_SEEN`. */
function tracesFromWire(s: string): readonly string[] | undefined {
  const value = parsed(s)
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_TRACES_SEEN ||
    !value.every(id => typeof id === "string" && id !== "")
  )
    return undefined
  return value as string[]
}

function pinnedFromWire(s: string): readonly SentCard[] | undefined {
  if (s === "") return []
  const value = parsed(s)
  if (!Array.isArray(value)) return undefined
  const out: SentCard[] = []
  for (const item of value) {
    const { card, seen } = (item ?? {}) as Record<string, unknown>
    if (typeof card !== "string" || card === "" || typeof seen !== "string")
      return undefined
    out.push({ id: cardId(card), seen })
  }
  return out
}

const isCardCommand = (c: string): c is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(c)

/**
 * A place's key as a JSON value: its flat fields, null for none. A key has
 * no order but a note's, which is its cell (ADR-0113).
 */
const keyToJson = (key: PlaceKey | null) => {
  if (key === null) return null
  const { kind, root, at, lane, column, order, seen, holder } = placeFields(key)
  return { kind, root, at, lane, column, order, seen, holder }
}

/** A place's key -> the wire: its flat fields as JSON, `""` for none. */
export const encodeKey = (key: PlaceKey | null): string =>
  key === null ? "" : JSON.stringify(keyToJson(key))

/** JSON text -> its value, or undefined when it does not parse. */
const parsed = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/**
 * The wire -> a place's key: null for `""`, undefined for anything
 * malformed. The flat fields are read by core's `keyOfFields`, as the
 * places document's are by `placeOfFields`, so the two cannot drift.
 */
export const decodeKey = (s: string): PlaceKey | null | undefined =>
  s === "" ? null : keyFromJson(parsed(s))

/** A JSON value -> a place's key: null for null, undefined for anything malformed. */
function keyFromJson(value: unknown): PlaceKey | null | undefined {
  if (value === null) return null
  if (typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const field = (k: string) =>
    typeof v[k] === "string" ? (v[k] as string) : ""
  return keyOfFields({
    kind: field("kind"),
    root: field("root"),
    at: field("at"),
    lane: field("lane"),
    column: field("column"),
    order: field("kind") === "note" ? field("order") : "",
    by: "",
    seen: field("seen"),
    holder: field("holder"),
  })
}

/** Moves -> the wire: a JSON list of `{ card, from, to }`. */
export const encodeMoves = (moves: readonly Move[]): string =>
  JSON.stringify(
    moves.map(m => ({
      card: m.card,
      from: keyToJson(m.from),
      to: keyToJson(m.to),
    })),
  )

/**
 * The wire -> moves, or why they are malformed: an empty list, a move with
 * no card, a malformed place, or a move from nowhere to nowhere.
 */
export function decodeMoves(s: string): readonly Move[] | string {
  const value = parsed(s)
  if (!Array.isArray(value) || value.length === 0)
    return "a move must name its cards"
  const moves: Move[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null)
      return "a move must name its card"
    const m = item as Record<string, unknown>
    const card = typeof m.card === "string" ? m.card.trim() : ""
    if (card === "") return "a move must name its card"
    const from = keyFromJson(m.from ?? null)
    const to = keyFromJson(m.to ?? null)
    if (from === undefined || to === undefined)
      return "a move names a malformed place"
    if (to === null) return "a move must name where the card goes"
    moves.push({ card: cardId(card), from, to })
  }
  return moves
}

/** A reorder's place and neighbours -> the wire: `{ at, after, before }`. */
export const encodeReorder = (r: Reorder): string =>
  JSON.stringify({
    at: keyToJson(r.at),
    after: r.after ?? "",
    before: r.before ?? "",
  })

/**
 * The wire -> a reorder, or why it is malformed: no card, a place that is
 * not a queue's or the pinned cards', no neighbour, or a neighbour that is
 * the card itself or both of them.
 */
export function decodeReorder(card: string, s: string): Reorder | string {
  if (card === "") return "a reorder must name its card"
  const value = parsed(s)
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "a reorder must name its place"
  const v = value as Record<string, unknown>
  const at = keyFromJson(v.at ?? null)
  if (
    at === null ||
    at === undefined ||
    (at.kind !== "queued" && at.kind !== "pinned")
  )
    return "a reorder stays in a queue or among the pinned cards"
  const neighbour = (k: unknown): string =>
    typeof k === "string" ? k.trim() : ""
  const [after, before] = [neighbour(v.after), neighbour(v.before)]
  if (after === "" && before === "") return "a reorder must name a neighbour"
  if (after === card || before === card || after === before)
    return "a reorder's neighbours are two other cards"
  return {
    card: cardId(card),
    at,
    after: after === "" ? null : cardId(after),
    before: before === "" ? null : cardId(before),
  }
}

/** Cards an undo moved -> the wire: a JSON list of `{ card, place }`. */
const encodeMovedCards = (cards: readonly MovedCard[]): string =>
  JSON.stringify(cards.map(c => ({ card: c.card, place: keyToJson(c.place) })))

/** The wire -> cards an undo moved; one malformed is left out. Total. */
function decodeMovedCards(s: string): readonly MovedCard[] {
  const value = parsed(s)
  if (!Array.isArray(value)) return []
  return (value as unknown[]).flatMap(item => {
    if (typeof item !== "object" || item === null) return []
    const c = item as Record<string, unknown>
    const place = keyFromJson(c.place ?? null)
    return typeof c.card === "string" && c.card !== "" && place !== undefined
      ? [{ card: cardId(c.card), place }]
      : []
  })
}

const isQueueHoldChange = (h: string): h is QueueHoldChange =>
  (QUEUE_HOLD_CHANGES as readonly string[]).includes(h)

const isMoveDirection = (d: string): d is MoveDirection =>
  (MOVE_DIRECTIONS as readonly string[]).includes(d)

const MOVE_REFUSALS: readonly MoveRefusal[] = [
  "moved",
  "gone",
  "exists",
  "full",
  "not-yours",
  "fact",
  "order-changed",
]
const isMoveRefusal = (c: string): c is MoveRefusal =>
  (MOVE_REFUSALS as readonly string[]).includes(c)

const isOfferAction = (a: string): a is OfferAction =>
  (OFFER_ACTIONS as readonly string[]).includes(a)

const isWorkflowAction = (a: string): a is WorkflowAction =>
  (WORKFLOW_ACTIONS as readonly string[]).includes(a)

/**
 * A move on the board's states, as the wire carries it in `text`: JSON
 * `{ from, to, before }`, `before` a root or null. Null when malformed.
 */
export function rootMoveFromWire(s: string): {
  readonly from: WorkflowStateId
  readonly to: WorkflowStateId
  readonly before: RootId | null
} | null {
  const raw = parsed(s)
  if (typeof raw !== "object" || raw === null) return null
  const { from, to, before } = raw as Record<string, unknown>
  if (typeof from !== "string" || !isWorkflowStateId(from)) return null
  if (typeof to !== "string" || !isWorkflowStateId(to)) return null
  if (before !== null && (typeof before !== "string" || !isRootId(before)))
    return null
  return { from, to, before }
}

const isChatMode = (mode: string): mode is ChatMode =>
  (CHAT_MODES as readonly string[]).includes(mode)

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
        cardId: intent.card?.id ?? "",
        seen: intent.card?.seen ?? "",
        pinned: pinnedToWire(intent.pinned),
        reserved: intent.reserved ?? "",
        base: intent.base ?? "",
        state: intent.state ?? "",
      })
    case "name":
      return command({ id, kind: "name", text: intent.name })
    case "picture":
      return command({ id, kind: "picture", text: intent.sha256 ?? "" })
    case "stop":
    case "carry-on":
    case "unqueue-all":
      return command({ id, kind: intent.kind, lane: intent.lane })
    case "queue-hold":
      return command({
        id,
        kind: "queue-hold",
        lane: intent.lane,
        mode: intent.held ? "hold" : "release",
      })
    case "reorder":
      return command({
        id,
        kind: "reorder",
        cardId: intent.reorder.card,
        moves: encodeReorder(intent.reorder),
      })
    case "move-root":
      return command({
        id,
        kind: "move-root",
        root: intent.root,
        text: JSON.stringify({
          from: intent.from,
          to: intent.to,
          before: intent.before,
        }),
      })
    case "workflow":
      return command({
        id,
        kind: "workflow",
        mode: intent.edit.action,
        targetId: intent.edit.state ?? "",
        text: intent.edit.name,
        parentId: intent.edit.before ?? "",
      })
    case "mark":
      return command({
        id,
        kind: "mark",
        root: intent.root,
        targetId: intent.entry,
        text: intent.title ?? "",
      })
    case "retitle":
      return command({ id, kind: "retitle", root: intent.root })
    case "offer":
      return command({
        id,
        kind: "offer",
        lane: intent.lane,
        mode: intent.action,
        targetId: intent.to ?? "",
        seen: offerSeenToWire(intent.seen),
      })
    case "setup":
    case "publish":
      return command({ id, kind: intent.kind })
    case "reserve":
      return command({ id, kind: "reserve", lane: intent.lane })
    case "move":
      return command({ id, kind: "move", moves: encodeMoves(intent.moves) })
    case "queue-card":
      return command({
        id,
        kind: "queue-card",
        moves: encodeMoves([intent.move]),
        mode: intent.hold,
      })
    case "undo-move":
      return command({
        id,
        kind: "undo-move",
        root: intent.root,
        mode: intent.direction,
      })
    case "set-command":
      return command({
        id,
        kind: "set-command",
        cardId: intent.card,
        mode: intent.command ?? "",
      })
    case "traces-seen":
      return command({
        id,
        kind: "traces-seen",
        text: JSON.stringify(intent.traces),
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
    case "pictured":
      return reply({ id, outcome: "pictured" })
    case "stopped":
      return reply({ id, outcome: "stopped" })
    case "moved-root":
      return reply({ id, outcome: "moved-root" })
    case "workflow-changed":
      return reply({ id, outcome: "workflow-changed" })
    case "marked":
      return reply({ id, outcome: "marked" })
    case "retitling":
      return reply({ id, outcome: "retitling" })
    case "accepted":
      return reply({ id, outcome: "accepted" })
    case "offered":
      return reply({ id, outcome: "offered" })
    case "reserved":
      return reply({ id, outcome: "reserved" })
    case "seen":
      return reply({ id, outcome: "seen" })
    case "accepted-moved":
      return reply({ id, outcome: "accepted-moved" })
    case "queued":
      return reply({ id, outcome: "queued" })
    case "moved":
      return reply({ id, outcome: "moved" })
    case "held":
      return reply({ id, outcome: "held" })
    case "released":
      return reply({ id, outcome: "released" })
    case "undone":
      return reply({
        id,
        outcome: "undone",
        cards: encodeMovedCards(outcome.cards),
      })
    case "nothing":
      return reply({ id, outcome: "nothing" })
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
    case "pictured":
      return { kind: "pictured" }
    case "stopped":
      return { kind: "stopped" }
    case "moved-root":
      return { kind: "moved-root" }
    case "workflow-changed":
      return { kind: "workflow-changed" }
    case "marked":
      return { kind: "marked" }
    case "retitling":
      return { kind: "retitling" }
    case "accepted":
      return { kind: "accepted" }
    case "offered":
      return { kind: "offered" }
    case "reserved":
      return { kind: "reserved" }
    case "seen":
      return { kind: "seen" }
    case "accepted-moved":
      return { kind: "accepted-moved" }
    case "queued":
      return { kind: "queued" }
    case "moved":
      return { kind: "moved" }
    case "held":
      return { kind: "held" }
    case "released":
      return { kind: "released" }
    case "undone":
      return { kind: "undone", cards: decodeMovedCards(wire.cards) }
    case "nothing":
      return { kind: "nothing" }
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
