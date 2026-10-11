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
  type ChatAt,
  type ChatMode,
  type CommitId,
  commitId,
  DISCARDED,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type Intent,
  isNoteColumnId,
  isReferenceCardId,
  isReorderAt,
  isRootId,
  isSha256,
  isTaskId,
  isTextCardId,
  isThreadId,
  isWorkflowStateId,
  keyFieldsFrom,
  keyFieldsOf,
  keyOfFields,
  kindOfCard,
  MAX_TITLE,
  type MarkTarget,
  MOVE_DIRECTIONS,
  type Move,
  type MoveDirection,
  type MoveTarget,
  modeOf,
  normalizeName,
  OFFER_ACTIONS,
  type OfferAction,
  type OfferSeen,
  type Paste,
  type PlaceKey,
  type PlaceRefusal,
  type Position,
  parseAddress,
  parseCardId,
  parseMentions,
  parseNewRoot,
  parseNewTask,
  parseNewThread,
  parseTextCardId,
  parseTitle,
  placeFields,
  printAddress,
  QUEUE_HOLD_CHANGES,
  type QueueHoldChange,
  type Refusal,
  type Reorder,
  ROOT,
  type RunId,
  refused,
  runId,
  type SentCard,
  type TaskId,
  type ThreadId,
  type TypedMove,
  targetOfFields,
  typedMove,
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
      readonly code: PlaceRefusal
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
  /** The workflow's states changed, or already were as asked (ADR-0122). */
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

/** A command's sender's task: null for "", undefined for one that is no task's id. */
const hereOf = (
  wire: { readonly here?: unknown } | null | undefined,
): TaskId | null | undefined => {
  const here = text(wire?.here)
  return here === "" ? null : isTaskId(here) ? here : undefined
}

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
    return isThreadId(lane)
      ? { kind, lane }
      : refused(ERR.UNKNOWN_TARGET, `not a thread's lane: ${lane}`)
  }
  if (kind === "queue-hold") {
    const lane = text(wire?.lane)
    if (!isThreadId(lane))
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
    if (mode !== "reply" && mode !== "branch") {
      return refused(ERR.UNKNOWN_KIND, `unknown chat mode: ${mode}`)
    }
    if (at.kind === "root" && mode !== "branch") {
      return refused(ERR.NO_ANCHOR, "only a branch starts a thread at the root")
    }
    const threadText = text(wire?.lane)
    // A branch names the thread its column minted, in the shape a client
    // mints; a reply names a thread that may be older than that shape.
    const thread =
      mode === "branch"
        ? parseNewThread(threadText)
        : isThreadId(threadText)
          ? threadText
          : undefined
    if (thread === undefined)
      return mode === "branch"
        ? notNewLane(threadText)
        : refused(ERR.UNKNOWN_TARGET, `not a thread: ${threadText}`)
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
    const chatAt = chatAtFromWire(mode, thread, at, text(wire?.task))
    if (chatAt === undefined)
      return refused(ERR.UNKNOWN_TARGET, `not a task: ${text(wire?.task)}`)
    const card = cardFromWire(text(wire?.cardId), text(wire?.seen))
    if (card === undefined)
      return refused(ERR.UNKNOWN_TARGET, "a chat's card is no text card")
    return {
      kind: "chat",
      text: body,
      root,
      at: chatAt,
      asksAgent: wire?.asksAgent === true,
      mentions: parseMentions(body),
      card,
      pinned,
      base: base === "" ? null : base,
      state: stateText === "" ? null : (stateText as WorkflowStateId),
    }
  }
  if (kind === "setup" || kind === "publish") return { kind }
  if (kind === "move") {
    const moves = decodeMoves(text(wire?.moves))
    if (typeof moves === "string") return refused(ERR.UNKNOWN_TARGET, moves)
    // One way into a queue, which decides its hold too (ADR-0113).
    if (moves.some(m => m.to.kind === "queued"))
      return refused(ERR.UNKNOWN_TARGET, "a card is queued by queue-card")
    const here = hereOf(wire)
    return here === undefined
      ? refused(ERR.UNKNOWN_TARGET, "its sender's task is not a task")
      : { kind: "move", moves, here }
  }
  if (kind === "queue-card") {
    const moves = decodeMoves(text(wire?.moves))
    if (typeof moves === "string") return refused(ERR.UNKNOWN_TARGET, moves)
    const [first, ...more] = moves
    const to = first?.to
    if (first === undefined || more.length > 0 || to?.kind !== "queued")
      return refused(
        ERR.UNKNOWN_TARGET,
        "a queue-card names one move into a queue",
      )
    const move = { ...first, to }
    const hold = text(wire?.mode)
    if (!isQueueHoldChange(hold))
      return refused(ERR.UNKNOWN_KIND, `unknown queue hold change: ${hold}`)
    const name = text(wire?.targetId)
    if (name === "") return { kind, move, hold, command: null }
    if (!isCardCommand(name))
      return refused(ERR.UNKNOWN_KIND, `unknown card command: ${name}`)
    // A command rides only on a creation: a card that exists keeps its own.
    return move.from === null
      ? { kind, move, hold, command: name }
      : refused(ERR.UNKNOWN_TARGET, "only a card queued new names a command")
  }
  if (kind === "spin-off") {
    const moves = decodeMoves(text(wire?.moves))
    if (typeof moves === "string") return refused(ERR.UNKNOWN_TARGET, moves)
    const [first, ...more] = moves
    const to = first?.to
    if (first === undefined || more.length > 0 || to?.kind !== "trash")
      return refused(
        ERR.UNKNOWN_TARGET,
        "a spin-off names one move, to its sender's trash",
      )
    const move = { ...first, to }
    const root = parseNewRoot(text(wire?.root))
    const thread = parseNewThread(text(wire?.lane))
    if (root === undefined || thread === undefined)
      return refused(
        ERR.UNKNOWN_TARGET,
        "a spin-off names a new root and its new thread",
      )
    const state = text(wire?.state)
    if (state !== "" && !isWorkflowStateId(state))
      return refused(ERR.UNKNOWN_TARGET, `not a workflow state: ${state}`)
    const task = parseNewTask(text(wire?.task))
    if (task === undefined)
      return refused(ERR.UNKNOWN_TARGET, "a spin-off names a new task")
    const here = hereOf(wire)
    if (here === undefined)
      return refused(ERR.UNKNOWN_TARGET, "its sender's task is not a task")
    return {
      kind,
      move,
      root,
      thread,
      task,
      state: state === "" ? null : state,
      here,
    }
  }
  if (kind === "open-thread") {
    const thread = parseNewThread(text(wire?.lane))
    if (thread === undefined) return notNewLane(text(wire?.lane))
    // A new tab's thread starts a new root in a new task; a branch is in
    // the root and the task its column is on.
    const rootText = text(wire?.root)
    const root = at.kind === "root" ? parseNewRoot(rootText) : rootText
    if (root === undefined || !isRootId(root))
      return refused(ERR.UNKNOWN_TARGET, `not a root: ${rootText}`)
    const taskText = text(wire?.task)
    const task = at.kind === "root" ? parseNewTask(taskText) : taskText
    if (task === undefined || !isTaskId(task))
      return refused(ERR.UNKNOWN_TARGET, `not a task: ${taskText}`)
    const state = text(wire?.state)
    if (state !== "" && !isWorkflowStateId(state))
      return refused(ERR.UNKNOWN_STATE, `not a workflow state: ${state}`)
    return {
      kind,
      thread,
      root,
      at: at.kind === "entry" ? at.id : null,
      task,
      state: state === "" ? null : state,
    }
  }
  if (kind === "copy-thread") {
    const source = text(wire?.lane)
    if (!isThreadId(source))
      return refused(ERR.UNKNOWN_TARGET, `not a thread: ${source}`)
    if (at.kind !== "entry")
      return refused(ERR.UNKNOWN_TARGET, "a copy names the end it forks at")
    const moves = decodeMoves(text(wire?.moves))
    if (typeof moves === "string") return refused(ERR.UNKNOWN_TARGET, moves)
    const [first, ...more] = moves
    if (
      first === undefined ||
      more.length > 0 ||
      first.from !== null ||
      !isThreadId(first.card) ||
      (first.to.kind !== "canvas-at" && first.to.kind !== "inventory")
    )
      return refused(
        ERR.UNKNOWN_TARGET,
        "a copy names one new thread's card, onto a canvas or into an inventory",
      )
    return {
      kind,
      source,
      end: at.id,
      move: { card: first.card, from: null, to: first.to },
    }
  }
  if (kind === "paste") {
    const moves = decodeMoves(text(wire?.moves))
    if (typeof moves === "string") return refused(ERR.UNKNOWN_TARGET, moves)
    // Its card's move last, after the discard of the card it replaces.
    const main = moves.at(-1)
    const replaced = moves.length === 2 ? moves[0] : undefined
    if (
      main === undefined ||
      moves.length > 2 ||
      (replaced !== undefined &&
        (replaced.from === null || replaced.to.kind !== "trash"))
    )
      return refused(
        ERR.UNKNOWN_TARGET,
        "a paste names its card's move, after a discard of the card it replaces",
      )
    const here = hereOf(wire)
    if (here === undefined)
      return refused(ERR.UNKNOWN_TARGET, "its sender's task is not a task")
    const replacing =
      replaced?.from == null
        ? null
        : { card: replaced.card, from: replaced.from }
    const paste = pasteOfWire(text(wire?.mode), main, wire)
    if (typeof paste === "string") return refused(ERR.UNKNOWN_TARGET, paste)
    return { kind, paste, to: main.to, replacing, here }
  }
  if (kind === "undo-move") {
    // "" names the sender's history outside any task (ADR-0126).
    const task = text(wire?.task)
    if (task !== "" && !isTaskId(task))
      return refused(ERR.UNKNOWN_TARGET, `not a task: ${task}`)
    const direction = text(wire?.mode)
    return isMoveDirection(direction)
      ? { kind, task: task === "" ? null : task, direction }
      : refused(ERR.UNKNOWN_KIND, `unknown undo direction: ${direction}`)
  }
  if (kind === "card-width") {
    const card = parseCardId(text(wire?.cardId))
    if (card === undefined)
      return refused(ERR.UNKNOWN_TARGET, "a width must name its card")
    const task = text(wire?.task)
    if (!isTaskId(task))
      return refused(ERR.UNKNOWN_TARGET, `not a task: ${task}`)
    const width = text(wire?.mode)
    return width === "1" || width === "2"
      ? {
          kind,
          card,
          at: { kind: "canvas", task },
          width: width === "1" ? 1 : 2,
        }
      : refused(ERR.UNKNOWN_KIND, `a card is 1 or 2 columns wide, not ${width}`)
  }
  if (kind === "set-command") {
    const card = parseCardId(text(wire?.cardId))
    if (card === undefined)
      return refused(ERR.UNKNOWN_TARGET, "a command must name its card")
    const name = text(wire?.mode)
    if (name !== "" && !isCardCommand(name))
      return refused(ERR.UNKNOWN_KIND, `unknown card command: ${name}`)
    return {
      kind: "set-command",
      card,
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
    const reserved = parseNewThread(lane)
    return reserved === undefined
      ? notNewLane(lane)
      : { kind: "reserve", lane: reserved }
  }
  if (kind === "offer") {
    const lane = text(wire?.lane)
    if (!isThreadId(lane))
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
  if (kind === "move-task") {
    const task = text(wire?.task)
    if (!isTaskId(task))
      return refused(ERR.UNKNOWN_TARGET, `not a task: ${task}`)
    const move = taskMoveFromWire(text(wire?.text))
    return move === null
      ? refused(ERR.UNKNOWN_STATE, "a move on the board names its states")
      : { kind: "move-task", task, ...move }
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
    const task = text(wire?.task)
    const column = text(wire?.cardId)
    const of: MarkTarget | undefined =
      column === ""
        ? isTaskId(task)
          ? { kind: "task", task }
          : undefined
        : isNoteColumnId(column) && task === ""
          ? { kind: "note-column", column }
          : undefined
    if (of === undefined)
      return refused(
        ERR.UNKNOWN_TARGET,
        `not a task or a note column: ${task}${column}`,
      )
    const title = parseTitle(text(wire?.text))
    switch (title.kind) {
      case "invalid":
        return refused(
          ERR.INVALID_TITLE,
          `a title is one line of at most ${MAX_TITLE} characters`,
        )
      case "clear":
        return { kind: "mark", of, title: null }
      case "set":
        return { kind: "mark", of, title: title.title }
    }
  }
  if (kind === "retitle") {
    const task = text(wire?.task)
    return isTaskId(task)
      ? { kind: "retitle", task }
      : refused(ERR.UNKNOWN_TARGET, `not a task: ${task}`)
  }
  return refused(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(kind)}`)
}

/**
 * Where a chat goes, from its mode and position: a reply at the end of the
 * thread it saw there; a branch at its fork, its card in the task named,
 * which at the root is a new one its tab minted (ADR-0116). Undefined for a
 * branch with no task. A reply at the root was refused before this.
 */
function chatAtFromWire(
  mode: ChatMode,
  thread: ThreadId,
  at: Position,
  taskText: string,
): ChatAt | undefined {
  if (mode === "reply" && at.kind === "entry")
    return { kind: "end", thread, seen: at.id }
  const task =
    at.kind === "root"
      ? parseNewTask(taskText)
      : isTaskId(taskText)
        ? taskText
        : undefined
  return task === undefined
    ? undefined
    : { kind: "branch", thread, at: at.kind === "root" ? null : at.id, task }
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
/** The card a chat is sent from: null for none; undefined for an id that is no text card's. */
const cardFromWire = (
  id: string,
  seen: string,
): SentCard | null | undefined => {
  if (id === "") return null
  const card = parseTextCardId(id)
  return card === undefined ? undefined : { id: card, seen }
}

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
    const id = typeof card === "string" ? parseTextCardId(card) : undefined
    if (id === undefined || typeof seen !== "string") return undefined
    out.push({ id, seen })
  }
  return out
}

const isCardCommand = (c: string): c is CardCommand =>
  (CARD_COMMANDS as readonly string[]).includes(c)

/** A place's key, or a move's target, as a JSON value: its flat fields, null for none. */
const keyToJson = (key: MoveTarget | null) =>
  key === null ? null : keyFieldsOf(placeFields(key))

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
  return keyOfFields(
    keyFieldsFrom(k => (typeof v[k] === "string" ? (v[k] as string) : "")),
  )
}

/** A JSON value -> a move's target: a key, a thread's nearest notes, or a spot on a canvas. */
function targetFromJson(value: unknown): MoveTarget | null | undefined {
  if (value === null) return null
  if (typeof value !== "object" || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  return targetOfFields(
    keyFieldsFrom(k => (typeof v[k] === "string" ? (v[k] as string) : "")),
  )
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
 * The wire -> moves, typed by each card's kind (`typedMove`), or why they
 * are malformed: an empty list, a move with no card, a malformed place, a
 * move from nowhere to nowhere, or one from or to a place its card's kind
 * is never in.
 */
export function decodeMoves(s: string): readonly TypedMove[] | string {
  const value = parsed(s)
  if (!Array.isArray(value) || value.length === 0)
    return "a move must name its cards"
  const moves: TypedMove[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null)
      return "a move must name its card"
    const m = item as Record<string, unknown>
    const card = parseCardId(typeof m.card === "string" ? m.card.trim() : "")
    if (card === undefined) return "a move must name its card"
    const from = keyFromJson(m.from ?? null)
    const to = targetFromJson(m.to ?? null)
    if (from === undefined || to === undefined)
      return "a move names a malformed place"
    if (to === null) return "a move must name where the card goes"
    const move = typedMove({ card, from, to })
    if (move === undefined)
      return `a ${kindOfCard(card)} card is never moved from ${from?.kind ?? "nowhere"} to ${to.kind}`
    moves.push(move)
  }
  return moves
}

/**
 * A paste's card, by `mode`, from its one move and the wire, or why it is
 * malformed: a text card or a reference made from nothing, a reference
 * naming its address (`text`) and its quote's blob (`seen`), a text card
 * its origin or none (`text`, `""`), a cut card out of a trash.
 */
function pasteOfWire(
  mode: string,
  move: TypedMove,
  wire: WireCommand | null | undefined,
): Paste | string {
  switch (mode) {
    case "text": {
      const printed = text(wire?.text)
      const origin = printed === "" ? null : parseAddress(printed)
      if (
        move.from !== null ||
        !isTextCardId(move.card) ||
        origin === undefined
      )
        return "a pasted text card is new, and names its origin or none"
      return { kind: "text", card: move.card, origin }
    }
    case "reference": {
      const address = parseAddress(text(wire?.text))
      const quote = text(wire?.seen)
      if (
        move.from !== null ||
        !isReferenceCardId(move.card) ||
        address === undefined ||
        !isSha256(quote)
      )
        return "a pasted reference is new, and names its address and its quote's blob"
      return { kind: "reference", card: move.card, address, quote }
    }
    case "uncut":
      return move.from?.kind === "trash"
        ? { kind: "uncut", card: move.card }
        : "a cut card is pasted out of a trash"
    default:
      return `unknown paste: ${mode}`
  }
}

/** A reorder's place and neighbours -> the wire: `{ at, after, before }`. */
export const encodeReorder = (r: Reorder): string =>
  JSON.stringify({
    at: keyToJson(r.at),
    after: r.after ?? "",
    before: r.before ?? "",
  })

/**
 * The wire -> a reorder, or why it is malformed: no card, a place no
 * reorder is in (`REORDER_PLACES`), no neighbour, or a neighbour that is
 * the card itself or both of them.
 */
export function decodeReorder(text: string, s: string): Reorder | string {
  const card = parseCardId(text)
  if (card === undefined) return "a reorder must name its card"
  const value = parsed(s)
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "a reorder must name its place"
  const v = value as Record<string, unknown>
  const at = keyFromJson(v.at ?? null)
  if (at === null || at === undefined || !isReorderAt(at))
    return "a reorder stays in a queue, among the pinned cards, in a note column or on a canvas"
  const neighbour = (k: unknown): string =>
    typeof k === "string" ? k.trim() : ""
  const [after, before] = [neighbour(v.after), neighbour(v.before)]
  if (after === "" && before === "") return "a reorder must name a neighbour"
  if (after === card || before === card || after === before)
    return "a reorder's neighbours are two other cards"
  const [afterId, beforeId] = [parseCardId(after), parseCardId(before)]
  if (
    (after !== "" && afterId === undefined) ||
    (before !== "" && beforeId === undefined)
  )
    return "a reorder's neighbours are cards"
  return { card, at, after: afterId ?? null, before: beforeId ?? null }
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
    const card = typeof c.card === "string" ? parseCardId(c.card) : undefined
    return card !== undefined && place !== undefined ? [{ card, place }] : []
  })
}

const isQueueHoldChange = (h: string): h is QueueHoldChange =>
  (QUEUE_HOLD_CHANGES as readonly string[]).includes(h)

const isMoveDirection = (d: string): d is MoveDirection =>
  (MOVE_DIRECTIONS as readonly string[]).includes(d)

/** Every refusal of a move or a reorder, so the wire carries each as itself. */
const PLACE_REFUSALS = {
  moved: true,
  gone: true,
  exists: true,
  full: true,
  "not-yours": true,
  replied: true,
  archived: true,
  "no-place": true,
  fact: true,
  "order-changed": true,
} as const satisfies Record<PlaceRefusal, true>
const isPlaceRefusal = (c: string): c is PlaceRefusal => c in PLACE_REFUSALS

const isOfferAction = (a: string): a is OfferAction =>
  (OFFER_ACTIONS as readonly string[]).includes(a)

const isWorkflowAction = (a: string): a is WorkflowAction =>
  (WORKFLOW_ACTIONS as readonly string[]).includes(a)

/**
 * A move on the board's states, as the wire carries it in `text`: JSON
 * `{ from, to, before }`, `before` a root or null. Null when malformed.
 */
export function taskMoveFromWire(s: string): {
  readonly from: WorkflowStateId
  readonly to: WorkflowStateId
  readonly before: TaskId | null
} | null {
  const raw = parsed(s)
  if (typeof raw !== "object" || raw === null) return null
  const { from, to, before } = raw as Record<string, unknown>
  if (typeof from !== "string" || !isWorkflowStateId(from)) return null
  if (typeof to !== "string" || !isWorkflowStateId(to)) return null
  if (before !== null && (typeof before !== "string" || !isTaskId(before)))
    return null
  return { from, to, before }
}

/** Intent -> the flat wire command. The client's half of `decodeCommand`. */
export function encodeIntent(id: string, intent: Intent): Command {
  switch (intent.kind) {
    case "chat":
      return command({
        id,
        kind: "chat",
        text: intent.text,
        parentId:
          intent.at.kind === "end" ? intent.at.seen : (intent.at.at ?? ""),
        root: intent.root,
        task: intent.at.kind === "branch" ? intent.at.task : "",
        mode: modeOf(intent.at),
        lane: intent.at.thread,
        asksAgent: intent.asksAgent,
        cardId: intent.card?.id ?? "",
        seen: intent.card?.seen ?? "",
        pinned: pinnedToWire(intent.pinned),
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
    case "move-task":
      return command({
        id,
        kind: "move-task",
        task: intent.task,
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
        ...(intent.of.kind === "task"
          ? { task: intent.of.task }
          : { cardId: intent.of.column }),
        text: intent.title ?? "",
      })
    case "retitle":
      return command({ id, kind: "retitle", task: intent.task })
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
      return command({
        id,
        kind: "move",
        moves: encodeMoves(intent.moves),
        here: intent.here ?? "",
      })
    case "queue-card":
      return command({
        id,
        kind: "queue-card",
        moves: encodeMoves([intent.move]),
        mode: intent.hold,
        targetId: intent.command ?? "",
      })
    case "spin-off":
      return command({
        id,
        kind: "spin-off",
        moves: encodeMoves([intent.move]),
        root: intent.root,
        lane: intent.thread,
        task: intent.task,
        state: intent.state ?? "",
        here: intent.here ?? "",
      })
    case "open-thread":
      return command({
        id,
        kind: "open-thread",
        lane: intent.thread,
        root: intent.root,
        parentId: intent.at ?? "",
        task: intent.task,
        state: intent.state ?? "",
      })
    case "copy-thread":
      return command({
        id,
        kind: "copy-thread",
        lane: intent.source,
        parentId: intent.end,
        moves: encodeMoves([intent.move]),
      })
    case "paste":
      return command({
        id,
        kind: "paste",
        mode: intent.paste.kind,
        cardId: intent.paste.card,
        text:
          intent.paste.kind === "reference"
            ? printAddress(intent.paste.address)
            : intent.paste.kind === "text" && intent.paste.origin !== null
              ? printAddress(intent.paste.origin)
              : "",
        seen: intent.paste.kind === "reference" ? intent.paste.quote : "",
        moves: encodeMoves([
          ...(intent.replacing === null
            ? []
            : [{ ...intent.replacing, to: DISCARDED }]),
          {
            card: intent.paste.card,
            from: intent.paste.kind === "uncut" ? DISCARDED : null,
            to: intent.to,
          },
        ]),
        here: intent.here ?? "",
      })
    case "undo-move":
      return command({
        id,
        kind: "undo-move",
        task: intent.task ?? "",
        mode: intent.direction,
      })
    case "card-width":
      return command({
        id,
        kind: "card-width",
        cardId: intent.card,
        task: intent.at.task,
        mode: String(intent.width),
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
        code: isPlaceRefusal(wire.errorCode) ? wire.errorCode : "gone",
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
