// core/tree — every read of the conversation tree.
//
// The tree is read many ways (a transcript, a spine, columns, a rail, where a
// view should follow) but indexed once: `indexTree` builds the parent and
// child maps a view needs, and every view takes that index. Before this, each
// view re-derived them, and a column view that calls several of them per
// column would have rebuilt the index each time.
//
// Order is structural throughout: the `parentId` walk, and ids, which are
// uuidv7 and so sort by creation (S9). Nothing here can see a seq (ADR-0013).
//
// A tool's result is its own entry, but it belongs to its call: `projectSpine`
// pairs it with the call on the same path, and it is never a message itself.

import { type ImageRef, isImageMime, isSha256 } from "./images.ts"
import {
  type AnswerDetails,
  atEntry,
  type CardId,
  type CatchUpFrom,
  type CommitId,
  type EntryId,
  type HeardDetails,
  type Position,
  type RelayDetails,
  type SendAt,
  type TaskId,
  type ThreadId,
  type WriterId,
} from "./index.ts"
import { subjectOf } from "./tools.ts"

// ── entries and messages ──────────────────────────────────────────────────

export interface MessagePart {
  readonly type?: string
  readonly text?: string
  /** A `toolCall` part: the call's id, the tool, and its arguments. */
  readonly id?: string
  readonly name?: string
  readonly arguments?: unknown
  /**
   * An `image` part as the session stores it (ADR-0051): the blob its bytes
   * are in. An image pi wrote inline has `data` instead.
   */
  readonly sha256?: string
  readonly mimeType?: string
  readonly width?: number
  readonly height?: number
  readonly data?: string
}

/**
 * What a thread is told when its base has new work (ADR-0080): a behind
 * entry's details, decoded. `to` is the base's commit it was told of, so it
 * is told once per commit.
 */
export interface BehindView {
  readonly from: CatchUpFrom
  readonly to: CommitId
  /** The files catching up would change. */
  readonly files: readonly string[]
  /** Those of `files` this thread's work changes too. */
  readonly overlap: readonly string[]
  /** The files the thread's offer conflicts in with the base now. */
  readonly conflicts: readonly string[]
}

/** One pinned card as a run read it (ADR-0048). */
export interface PinnedCardRead {
  readonly id: CardId
  readonly text: string
  /** The card's owner, named in what the model read by their display name then. */
  readonly by: WriterId
}

/** The pinned cards a run read: a cards entry's details, decoded. */
export interface PinnedView {
  /** The lane of the run that read them. */
  readonly lane: ThreadId
  /** Every card pinned at the run's start, in order. */
  readonly cards: readonly PinnedCardRead[]
  /** Cards the model had read that are no longer pinned, with their first line. */
  readonly retired: readonly {
    readonly id: CardId
    readonly line: string
  }[]
}

/** The cards pinned to a task a run read (ADR-0116): a task's cards entry, decoded. */
export interface TaskPinnedView {
  /** The task they are pinned to. */
  readonly task: TaskId
  /** Every card pinned to it at the run's start, in order. */
  readonly cards: readonly PinnedCardRead[]
  /** Cards the model had read that are no longer pinned, with their first line. */
  readonly retired: readonly {
    readonly id: CardId
    readonly line: string
  }[]
}

/**
 * The task's cards a run was told of (ADR-0116): a canvas entry's details,
 * decoded. One line per card in the canvas's order, at most a cap of them,
 * and how many more there are.
 */
export interface CanvasView {
  readonly task: TaskId
  /** The task's title, as told. */
  readonly title: string
  readonly lines: readonly string[]
  /** How many cards the list left out past its cap. */
  readonly more: number
}

/**
 * What a run's context carries besides the conversation (ADR-0116): the
 * newest entry of each kind, which a compaction keeps in view.
 */
export interface ContextInView {
  readonly pinned?: PinnedView
  readonly taskPinned?: TaskPinnedView
  readonly canvas?: CanvasView
}

export interface AgentMessageLike {
  readonly role?: string
  readonly content?: string | readonly MessagePart[]
  /** Role `chat` only: the speaker's display name, as written. */
  readonly author?: string
  /** Role `chat` only: whether it compelled the agent to reply. */
  readonly compelled?: boolean
  /** Role `chat` only: the writer who sent it, from the transport. */
  readonly writer?: WriterId
  /** Role `chat` only: the id of the send that wrote it, for its column. */
  readonly sendId?: string
  /** Role `chat` only: the other people who wrote in the card it was sent from. */
  readonly contributors?: readonly WriterId[]
  /** Role `chat` only: the command it ran, qualified (ADR-0036). */
  readonly command?: string
  /** Role `chat` only: the `/blob/` images its text shows (ADR-0042). */
  readonly images?: readonly ImageRef[]
  /** Role `toolResult` only: the call it answers, and whether it failed. */
  readonly toolCallId?: string
  readonly isError?: boolean
  /**
   * Role `assistant` only: why pi's request ended. `aborted` is a Stop and
   * `error` a failure (S70); either carries `errorMessage`.
   */
  readonly stopReason?: string
  readonly errorMessage?: string
  /** Role `pinned` only: the cards a run read (ADR-0048). */
  readonly pinned?: PinnedView
  /** Role `task-pinned` only: the cards pinned to the task a run read (ADR-0116). */
  readonly taskPinned?: TaskPinnedView
  /** Role `canvas` only: the task's cards a run was told of (ADR-0116). */
  readonly canvas?: CanvasView
  /**
   * Roles `update` and `land`, and a `catch_up` tool result: the commits
   * merged into the lane (ADR-0072, ADR-0080).
   */
  readonly merged?: readonly CommitId[]
  /** An `ask_about_conflict` tool result the host took: the agent asked (ADR-0080). */
  readonly asked?: true
  /** Role `behind` only: the base's new work the thread was told of (ADR-0080). */
  readonly behind?: BehindView
  /**
   * Role `fact` only, for a stop's fact: the ask whose run was stopped, and
   * who stopped it (ADR-0126).
   */
  readonly stopped?: {
    readonly prompt: EntryId
    readonly by: WriterId
    /** A spent budget's message, when the budget stopped it (ADR-0128). */
    readonly budget?: EntryId
  }
  /** Role `fact` only, for a member's: who left the thread's members (ADR-0128). */
  readonly member?: { readonly gone: ThreadId }
  /** Role `chat` only: the other threads' agents it asks and invites (ADR-0128). */
  readonly asks?: readonly ThreadId[]
  readonly invites?: readonly ThreadId[]
  /** Role `relay` only: an ask from another thread (ADR-0128). */
  readonly relay?: RelayDetails
  /** Role `answer` only: an asked agent's answer (ADR-0128). */
  readonly answer?: AnswerDetails
  /** Role `heard` only: what an asked agent heard of the thread that asked. */
  readonly heard?: HeardDetails
}

export interface EntryLike {
  readonly id: EntryId
  readonly parentId: EntryId | null
  readonly type: string
  /** The thread whose commit wrote it (ADR-0125): the row's column. */
  readonly thread: ThreadId
  /** Absent on entries that carry no message, e.g. a compaction. */
  readonly message?: AgentMessageLike
  /**
   * A compaction only: the context entries its retained tail carries (the
   * newest of each kind), which the model reads after the summary; absent
   * when it carries none.
   */
  readonly carried?: ContextInView
  /** When it was written, in ms since the epoch: the row's column. */
  readonly timestamp?: number
}

export interface TranscriptMessage {
  readonly id: EntryId
  /** The thread its entry is in (ADR-0125). */
  readonly thread: ThreadId
  readonly role: string
  readonly text: string
  /** Role `chat` only: the speaker's display name as sent. */
  readonly author?: string
  /** Role `chat` only: whether it compelled the agent to reply. */
  readonly compelled?: boolean
  /** Role `chat` only: who sent it, so a reader can look up their current name. */
  readonly writer?: WriterId
  /** Role `chat` only: the send that wrote it. */
  readonly sendId?: string
  /** Role `chat` only: the other people who wrote in the card it was sent from. */
  readonly contributors?: readonly WriterId[]
  /** Role `chat` only: the command it ran, qualified (ADR-0036). */
  readonly command?: string
  /** Role `chat` only: the `/blob/` images its text shows (ADR-0042). */
  readonly images?: readonly ImageRef[]
  /** Role `assistant` only: the tools it called, each with its result once known. */
  readonly toolCalls?: readonly ToolCall[]
  /** Roles `update` and `land` only: the commits merged into the lane (ADR-0072). */
  readonly merged?: readonly CommitId[]
  /** Roles `relay`, `answer` and `heard` only: the thread it came from (ADR-0128). */
  readonly from?: ThreadId
}

/**
 * A tool call, as stored: what it is, not how it reads. Its words are
 * `@pinetrie/interface`'s (`callLabel`, ADR-0114).
 */
export interface ToolCall {
  readonly id: string
  /** The tool's name as the model called it: a `ToolId`, or a tool pine·trie does not register. */
  readonly name: string
  /** What it touched, whole: a path, a command, or a search's pattern and path (`subjectOf`). */
  readonly subject?: string
  /** Its result, when the result is on the same path. */
  readonly result?: ToolResult
}

/** A tool's result. */
export interface ToolResult {
  readonly text: string
  readonly isError: boolean
  /** The images it returned, stored as blobs. */
  readonly images: readonly ImageRef[]
}

/**
 * A text as a label: its first non-empty line, cut to `max` characters with
 * "…" when longer. Tabs, fork labels, the header's menus and a revision's
 * title use it.
 */
export function firstLine(text: string, max: number): string {
  const line =
    text
      .split("\n")
      .map(l => l.trim())
      .find(l => l !== "") ?? ""
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** Flatten pi's AgentMessage content into display text. */
export function messageText(
  message: AgentMessageLike | null | undefined,
): string {
  const content = message?.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter(
      (part): part is MessagePart & { text: string } =>
        part?.type === "text" && typeof part.text === "string",
    )
    .map(part => part.text)
    .join("")
}

const isDimension = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0

/**
 * An image part as the session stores it (ADR-0051), or undefined. A part
 * with its bytes inline is not one: no `/blob/` URL serves it. The session
 * keeps one from before images were blobs, or from a host with no store.
 */
export function storedImage(
  part: MessagePart | null | undefined,
): ImageRef | undefined {
  return part?.type === "image" &&
    part.data === undefined &&
    typeof part.sha256 === "string" &&
    isSha256(part.sha256) &&
    typeof part.mimeType === "string" &&
    isImageMime(part.mimeType) &&
    isDimension(part.width) &&
    isDimension(part.height)
    ? {
        sha256: part.sha256,
        mimeType: part.mimeType,
        width: part.width,
        height: part.height,
      }
    : undefined
}

/** The stored images in a message's content, in order (`storedImage`). */
export function messageImages(
  message: AgentMessageLike | null | undefined,
): ImageRef[] {
  const content = message?.content
  if (!Array.isArray(content)) return []
  return content.flatMap(part => storedImage(part) ?? [])
}

/**
 * One entry -> the message a reader sees, or `null` if it is not one.
 *
 * The one rule for which entries are messages, shared by every view so they
 * cannot disagree. Non-message entries, and roles other than user,
 * assistant, chat and the host's own (`LINE_ROLES`), are dropped,
 * `toolResult` included: a result belongs to its call, which `projectSpine`
 * pairs it with. An assistant message carries its tool
 * calls. A `chat` message is a human's, already decoded by the reader
 * (`readRenderableEntries` in `@pinetrie/reads`); core only admits the role, so it
 * needs no schema library.
 */
function renderableMessage(entry: EntryLike): TranscriptMessage | null {
  if (entry.type !== "message") return null
  const role = entry.message?.role ?? "unknown"
  if (role === "chat") {
    return {
      id: entry.id,
      thread: entry.thread,
      role,
      text: messageText(entry.message),
      author: entry.message?.author ?? "",
      compelled: entry.message?.compelled === true,
      ...(entry.message?.writer === undefined
        ? {}
        : { writer: entry.message.writer }),
      ...(entry.message?.sendId === undefined
        ? {}
        : { sendId: entry.message.sendId }),
      ...(entry.message?.contributors === undefined
        ? {}
        : { contributors: entry.message.contributors }),
      ...(entry.message?.command === undefined
        ? {}
        : { command: entry.message.command }),
      ...(entry.message?.images === undefined
        ? {}
        : { images: entry.message.images }),
    }
  }
  // An ask from another thread, and an asked agent's answer (ADR-0128), are
  // messages as a chat is, spoken by the asker and by the answering thread.
  if (role === "relay" || role === "answer") {
    const came = role === "relay" ? entry.message?.relay : entry.message?.answer
    const author =
      role === "relay"
        ? entry.message?.relay?.askerName
        : entry.message?.answer?.fromName
    return {
      id: entry.id,
      thread: entry.thread,
      role,
      text: messageText(entry.message),
      author: author ?? "",
      ...(came === undefined ? {} : { from: came.from }),
    }
  }
  // A one-line message (`LINE_ROLES`) shows as its short line: the reader
  // decodes it into its role with that line as its content.
  if (role !== "user" && role !== "assistant" && !LINE_ROLES.has(role))
    return null
  const message = {
    id: entry.id,
    thread: entry.thread,
    role,
    text: messageText(entry.message),
  }
  const merged = entry.message?.merged
  if ((role === "update" || role === "land") && merged !== undefined)
    return { ...message, merged }
  const heard = entry.message?.heard
  if (role === "heard" && heard !== undefined)
    return { ...message, from: heard.from }
  const calls = role === "assistant" ? toolCallsOf(entry.message) : []
  return calls.length === 0 ? message : { ...message, toolCalls: calls }
}

/**
 * The host's own messages, which a column shows as one line: a resolution's
 * prompt (`land`, ADR-0033), an update and a split's prompt (`update`,
 * `stack`, ADR-0105), a Resume's carry-on (`carry-on`, ADR-0082), and the
 * host's facts, what a command on the offer did (`fact`) and that the base
 * has new work (`behind`, ADR-0080), and what an asked agent heard of the
 * thread that asked (`heard`, ADR-0128).
 */
export const LINE_ROLES: ReadonlySet<string> = new Set([
  "land",
  "update",
  "stack",
  "carry-on",
  "fact",
  "behind",
  "heard",
])

/** The message a reader sees at `id`, or null (`renderableMessage`). */
export function messageAt(
  index: TreeIndex,
  id: EntryId,
): TranscriptMessage | null {
  const entry = index.entries[id]
  return entry === undefined ? null : renderableMessage(entry)
}

/** One call, before its result is paired with it. */
function callOf(id: string, name: string, args: unknown): ToolCall {
  const subject = subjectOf(name, args)
  return subject === undefined ? { id, name } : { id, name, subject }
}

/** The tool calls an assistant message makes, from its `toolCall` content parts; none for any other message. */
export function toolCallsOf(message: AgentMessageLike | undefined): ToolCall[] {
  const content = message?.content
  if (!Array.isArray(content)) return []
  return content.flatMap(part =>
    part?.type === "toolCall" &&
    typeof part.id === "string" &&
    typeof part.name === "string"
      ? [callOf(part.id, part.name, part.arguments)]
      : [],
  )
}

/** A `toolResult` entry -> the call it answers and what it said, or null. */
function toolResultOf(
  entry: EntryLike,
): ({ readonly callId: string } & ToolResult) | null {
  const m = entry.message
  if (entry.type !== "message" || m?.role !== "toolResult") return null
  if (typeof m.toolCallId !== "string") return null
  return {
    callId: m.toolCallId,
    text: messageText(m),
    isError: m.isError === true,
    images: messageImages(m),
  }
}

/**
 * The entries a turn ends with, newest first, from the lane's tip after it:
 * its tool results, and a host's fact steered in after them (role `behind`,
 * ADR-0080), up to the assistant message whose calls they follow.
 */
function turnTail(index: TreeIndex, tip: EntryId): EntryId[] {
  const tail: EntryId[] = []
  let at = tip
  for (;;) {
    const entry = index.entries[at]
    const parent = index.parentOf(at)
    if (
      entry === undefined ||
      parent === null ||
      (toolResultOf(entry) === null && entry.message?.role !== "behind")
    )
      return tail
    tail.push(at)
    at = parent
  }
}

/**
 * The entry a turn is recorded against, from the lane's tip after it: a tool
 * result belongs to the assistant message whose call it answers, which sits
 * above it with only that message's other results between, so the walk goes
 * up past results, and past a steered fact after them (ADR-0080). Anything
 * else is its own turn: a prompt, or a message that called no tools.
 */
export function turnEntry(index: TreeIndex, tip: EntryId): EntryId {
  const tail = turnTail(index, tip)
  const last = tail.at(-1)
  return last === undefined ? tip : (index.parentOf(last) ?? tip)
}

/**
 * Whether a turn merged into the lane: one of its results is a `catch_up`
 * that says what it merged (ADR-0080). The merge moved the lane's bookmark,
 * so the turn's record names it.
 */
export const turnMerged = (index: TreeIndex, tip: EntryId): boolean =>
  turnTail(index, tip).some(
    id => index.entries[id]?.message?.merged !== undefined,
  )

/**
 * The roles a run can start with: a person's message, pi's own, and a land,
 * stack or carry-on message, an ask relayed from another thread and the
 * answer that wakes its asker (ADR-0128). An update never starts one: it is
 * a fact in the thread. Nor does a cards entry (role `pinned`): it is
 * written with a run's prompt, as its parent.
 */
const PROMPT_ROLES: ReadonlySet<string> = new Set([
  "chat",
  "user",
  "land",
  "stack",
  "carry-on",
  "relay",
  "answer",
])

/** Whether a run can start with `entry` (`PROMPT_ROLES`). */
export const startsRun = (entry: EntryLike | undefined): boolean => {
  const role = entry?.message?.role
  return role !== undefined && PROMPT_ROLES.has(role)
}

/**
 * The prompt of the run that wrote `tip`: its nearest ancestor-or-self a run
 * can start with. A lane is never written while it runs (S21), so no person's
 * message sits between a run's prompt and its tip. `indexAsks` finds every
 * run's prompt at once.
 */
export function promptOf(
  index: TreeIndex,
  tip: EntryId | null,
): EntryId | null {
  for (const id of ancestry(index, tip).path)
    if (startsRun(index.entries[id])) return id
  return null
}

/**
 * The newest entry on `tip`'s path that `read` finds something in, read.
 * A compaction ends the walk with `atCompaction`'s answer: pi replaces
 * everything above it with its summary and its retained tail, so what the
 * model reads stops there. A read that outlives a summary passes `pass`.
 */
export function newestOnPath<T>(
  index: TreeIndex,
  tip: EntryId | null,
  read: (entry: EntryLike) => T | undefined,
  atCompaction: ((entry: EntryLike) => T | null) | "pass",
): T | null {
  for (const id of ancestry(index, tip).path) {
    const entry = index.entries[id]
    if (entry === undefined) continue
    if (entry.type === "compaction" && atCompaction !== "pass")
      return atCompaction(entry)
    const found = read(entry)
    if (found !== undefined) return found
  }
  return null
}

/**
 * The pinned cards the model reads on a run from `tip`: the newest cards
 * entry on the path, or the cards a compaction's retained tail carries.
 * pi builds a run's context by the same walk; the host plans a run's cards
 * entry from this, and the column shows what changed since from it, so the
 * two cannot disagree.
 */
export const pinnedInView = (
  index: TreeIndex,
  tip: EntryId | null,
): PinnedView | null =>
  newestOnPath(
    index,
    tip,
    e => e.message?.pinned,
    e => e.carried?.pinned ?? null,
  )

/** The cards pinned to the task the model reads on a run from `tip` (ADR-0116), as `pinnedInView` finds a thread's. */
export const taskPinnedInView = (
  index: TreeIndex,
  tip: EntryId | null,
): TaskPinnedView | null =>
  newestOnPath(
    index,
    tip,
    e => e.message?.taskPinned,
    e => e.carried?.taskPinned ?? null,
  )

/** The task's cards the model was last told of on a run from `tip` (ADR-0116), as `pinnedInView` finds pinned cards. */
export const canvasInView = (
  index: TreeIndex,
  tip: EntryId | null,
): CanvasView | null =>
  newestOnPath(
    index,
    tip,
    e => e.message?.canvas,
    e => e.carried?.canvas ?? null,
  )

/**
 * The base commits the thread at `tip` last heard of or merged (ADR-0080):
 * a behind entry's `to`, or what an update, a resolution or a `catch_up`
 * merged, the newest on the path. Null with none, or past a compaction: a
 * fact pi summarised away is told again.
 */
export const baseKnown = (
  index: TreeIndex,
  tip: EntryId | null,
): readonly CommitId[] | null =>
  newestOnPath(
    index,
    tip,
    e =>
      e.message?.behind === undefined
        ? e.message?.merged
        : [e.message.behind.to],
    () => null,
  )

/**
 * When the agent last asked the person about a conflict on `tip`'s path (an
 * `ask_about_conflict` the host took, ADR-0080), or null. An ask stays a
 * fact after pi summarises it, so a compaction does not end the walk.
 */
export const conflictAskedAt = (
  index: TreeIndex,
  tip: EntryId | null,
): number | null =>
  newestOnPath(
    index,
    tip,
    e => (e.message?.asked === true ? (e.timestamp ?? 0) : undefined),
    "pass",
  )

/**
 * The tool results among `ids`' entries, by the call each answers. A result
 * is its own entry but belongs to its call: counted as a message, it would
 * add a column row and a rail row per call.
 */
export function resultsOn(
  index: TreeIndex,
  ids: Iterable<EntryId>,
): ReadonlyMap<string, ToolResult> {
  const results = new Map<string, ToolResult>()
  for (const id of ids) {
    const entry = index.entries[id]
    const r = entry === undefined ? null : toolResultOf(entry)
    if (r === null) continue
    const { callId, ...result } = r
    results.set(callId, result)
  }
  return results
}

// ── the index ─────────────────────────────────────────────────────────────

export interface TreeIndex {
  readonly entries: Readonly<Record<EntryId, EntryLike>>
  /** Children of each entry, ascending by id (creation order, S9). */
  readonly childrenOf: ReadonlyMap<EntryId, readonly EntryId[]>
  /** An entry's parent id as stored; null for a root. */
  readonly parentOf: (id: EntryId) => EntryId | null
  /** Entries with no parent: one per thread started at the root. Ascending by id. */
  readonly roots: readonly EntryId[]
  /** Entries whose parent is absent from the set. Never dropped. Ascending. */
  readonly orphans: readonly EntryId[]
  /**
   * Chat entries by the send that wrote them: a sender that knows its send's
   * id before the entry exists finds its message here, exactly.
   */
  readonly bySend: ReadonlyMap<string, EntryId>
  /**
   * Each thread's first entry (ADR-0125): its entry whose parent is in
   * another thread, or absent. Its parent is the thread's fork. Often a
   * context entry no column draws: what a person reads first is
   * `firstMessageOf`'s. Two such entries keep the older.
   */
  readonly firstOf: ReadonlyMap<ThreadId, EntryId>
  /**
   * Each thread's end (ADR-0125): its entry with no child in its own thread.
   * Two such entries keep the newer, as `latestTip` does.
   */
  readonly endOf: ReadonlyMap<ThreadId, EntryId>
}

const ascending = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Index the tree once. Every list is sorted by id, never left in iteration
 * order, so two replicas holding the same entries build the same index.
 */
export function indexTree(
  entries: Readonly<Record<EntryId, EntryLike>>,
): TreeIndex {
  const childrenOf = new Map<EntryId, EntryId[]>()
  const roots: EntryId[] = []
  const orphans: EntryId[] = []
  const bySend = new Map<string, EntryId>()
  const firstOf = new Map<ThreadId, EntryId>()
  // Entries with a child in their own thread: every other entry ends one.
  const continued = new Set<EntryId>()
  for (const entry of Object.values(entries)) {
    const id = entry.id
    const send = entry.message?.sendId
    if (send !== undefined) bySend.set(send, id)
    const parentEntry =
      entry.parentId === null ? undefined : entries[entry.parentId]
    if (parentEntry !== undefined && parentEntry.thread === entry.thread)
      continued.add(parentEntry.id)
    else {
      const known = firstOf.get(entry.thread)
      if (known === undefined || id < known) firstOf.set(entry.thread, id)
    }
    const parent = entry.parentId
    if (parent === null || parent === undefined) roots.push(id)
    else if (entries[parent] === undefined) orphans.push(id)
    else {
      const siblings = childrenOf.get(parent)
      if (siblings === undefined) childrenOf.set(parent, [id])
      else siblings.push(id)
    }
  }
  for (const siblings of childrenOf.values()) siblings.sort(ascending)
  const endOf = new Map<ThreadId, EntryId>()
  for (const entry of Object.values(entries)) {
    if (continued.has(entry.id)) continue
    const known = endOf.get(entry.thread)
    if (known === undefined || entry.id > known)
      endOf.set(entry.thread, entry.id)
  }
  return {
    entries,
    childrenOf,
    parentOf: id => entries[id]?.parentId ?? null,
    roots: roots.sort(ascending),
    orphans: orphans.sort(ascending),
    bySend,
    firstOf,
    endOf,
  }
}

export interface Ancestry {
  /** `id`, then each ancestor present in the index, up to a root. */
  readonly path: readonly EntryId[]
  /** The id where the walk met itself, or null. Callers decide what a cycle means. */
  readonly cycleAt: EntryId | null
}

/** Walk up from `id`. Stops, rather than spinning, on a cycle. */
export function ancestry(index: TreeIndex, id: EntryId | null): Ancestry {
  const path: EntryId[] = []
  const seen = new Set<EntryId>()
  for (let cursor = id; cursor !== null; cursor = index.parentOf(cursor)) {
    if (index.entries[cursor] === undefined) break
    if (seen.has(cursor)) return { path, cycleAt: cursor }
    seen.add(cursor)
    path.push(cursor)
  }
  return { path, cycleAt: null }
}

/**
 * The root of `id`'s tree: the last entry of its ancestry. An orphan is its
 * own root, since `ancestry` stops where a parent is missing. Null for an id
 * the index lacks.
 */
export function rootOf(index: TreeIndex, id: EntryId): EntryId | null {
  return ancestry(index, id).path.at(-1) ?? null
}

/** The ids on the path to `tip`. */
export const pathIds = (
  index: TreeIndex,
  tip: EntryId | null,
): ReadonlySet<EntryId> => new Set(ancestry(index, tip).path)

/**
 * Who wrote `ids`' messages, in order of first message: ids are uuidv7, so
 * sorting them is creation order.
 */
export function writersOf(
  index: TreeIndex,
  ids: Iterable<EntryId>,
): readonly WriterId[] {
  const out: WriterId[] = []
  for (const id of [...ids].sort()) {
    const w = index.entries[id]?.message?.writer
    if (w !== undefined && !out.includes(w)) out.push(w)
  }
  return out
}

// ── the transcript: what the model reads ──────────────────────────────────

/**
 * The path to `tipId` as an ordered transcript, root first.
 *
 * Order comes from the `parentId` walk, NOT from seq (ADR-0013: "Nothing may
 * render by seq order"). A cycle throws: a transcript with a cycle in it has
 * no order to give.
 */
export function projectTranscript(
  index: TreeIndex,
  tipId: EntryId | null,
): TranscriptMessage[] {
  const { path, cycleAt } = ancestry(index, tipId)
  if (cycleAt !== null) throw new Error(`cycle in parentId chain at ${cycleAt}`)
  return path.toReversed().flatMap(id => {
    const entry = index.entries[id]
    const message = entry === undefined ? null : renderableMessage(entry)
    return message === null ? [] : [message]
  })
}

// ── the spine: a path, and what leaves it ─────────────────────────────────

/** A branch departing the spine at some node. */
export interface BranchSummary {
  /** The child entry that leaves the spine: a column opens here. */
  readonly rootId: EntryId
  /** Messages in the whole subtree, for its "⑂ n messages" button. */
  readonly messageCount: number
}

export interface SpineNode extends TranscriptMessage {
  /** Children of this node that are NOT the next node on the spine. */
  readonly branches: readonly BranchSummary[]
}

export interface SpineProjection {
  readonly spine: readonly SpineNode[]
  /** Ids whose parentId names an entry absent from the set. Never dropped. */
  readonly orphans: readonly EntryId[]
  /** Ids on a parentId cycle. Reported rather than spun on. */
  readonly cycles: readonly EntryId[]
}

/**
 * The path to `tipId`, plus the branches that leave it.
 *
 * `projectTranscript` answers "what will the model see". This answers "what
 * exists around that path": the same nodes, each carrying the children that
 * are NOT on it. A cycle is reported, not thrown: a renderer must still draw
 * the part of the tree that is sound.
 */
export function projectSpine(
  index: TreeIndex,
  tipId: EntryId | null,
): SpineProjection {
  const { path: upward, cycleAt } = ancestry(index, tipId)
  const path = upward.toReversed()
  const onSpine = new Set(path)
  // Only results on this path pair with its calls.
  const results = resultsOn(index, path)
  const spine: SpineNode[] = []
  for (const [i, id] of path.entries()) {
    const entry = index.entries[id]
    const found = entry === undefined ? null : renderableMessage(entry)
    if (found === null) continue
    const message =
      found.toolCalls === undefined
        ? found
        : {
            ...found,
            toolCalls: found.toolCalls.map(call => {
              const result = results.get(call.id)
              return result === undefined ? call : { ...call, result }
            }),
          }
    const next = path[i + 1]
    const branches = (index.childrenOf.get(id) ?? [])
      .filter(child => child !== next && !onSpine.has(child))
      .map(rootId => summarizeBranch(index, rootId))
    spine.push({ ...message, branches })
  }
  return {
    spine,
    orphans: index.orphans,
    cycles: cycleAt === null ? [] : [cycleAt],
  }
}

/** A branch's size: its messages. */
function summarizeBranch(index: TreeIndex, rootId: EntryId): BranchSummary {
  let messageCount = 0
  const stack = [rootId]
  const visited = new Set<EntryId>()
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (visited.has(id)) continue
    visited.add(id)
    // What the rail and columns show as a message, so a tool's result, which
    // belongs to its call, is not counted.
    const entry = index.entries[id]
    if (entry !== undefined && renderableMessage(entry) !== null)
      messageCount += 1
    stack.push(...(index.childrenOf.get(id) ?? []))
  }
  return { rootId, messageCount }
}

// ── following a thread ────────────────────────────────────────────────────

/**
 * The most recently advanced tip among `tips`, or null if none has one.
 *
 * Entry ids are uuidv7, so the greatest id is the newest (S9). Chosen by
 * comparing ids, never by position in `tips`: two clients reading the same
 * document in a different order must pick the same one.
 */
export function latestTip(tips: Iterable<EntryId | null>): EntryId | null {
  let latest: EntryId | null = null
  for (const tip of tips) {
    if (tip !== null && (latest === null || tip > latest)) latest = tip
  }
  return latest
}

// ── the rail: one root's tree ─────────────────────────────────────────────

export interface RailRow {
  readonly id: EntryId
  /**
   * Its branch: the rank of the branch's first message among every branch's
   * in the tree, by id. It picks the colour; `placeRail` picks the place.
   */
  readonly track: number
  /** The nearest ancestor with a row, or null at a root: the edge's other end. */
  readonly parentId: EntryId | null
  /** It begins a branch: a start, or a child in another thread than its parent row's. */
  readonly head: boolean
}

/**
 * One root's tree as rows: a row per message, depth-first from `root`,
 * children in id order. Tracks start at 0 in every tree.
 *
 * A branch is a thread (ADR-0125): a child in its parent row's thread
 * continues its track, and any other child, or a start under a root that is
 * no message, begins a branch, whose track is its first message's rank by id
 * among every branch's first message. Ids sort in creation order (S9), so
 * the trunk is 0 and a new branch takes the next number without changing any
 * other's. Non-message entries get no row; their children attach to the
 * nearest ancestor that has one.
 */
export function projectRail(
  index: TreeIndex,
  root: EntryId,
): readonly RailRow[] {
  const visible = (id: EntryId): boolean => {
    const entry = index.entries[id]
    return entry !== undefined && renderableMessage(entry) !== null
  }
  // Children as the rail sees them: through any non-message entry.
  const visibleChildren = (ids: readonly EntryId[]): EntryId[] => {
    const out: EntryId[] = []
    const stack = ids.toReversed()
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (visible(id)) out.push(id)
      else stack.push(...(index.childrenOf.get(id) ?? []).toReversed())
    }
    return out
  }

  // The tree depth-first, each message with its parent and whether it
  // begins a branch; then each branch's track, by its first message's id.
  type Visit = { id: EntryId; parentId: EntryId | null; head: boolean }
  const visits: Visit[] = []
  // A root that is no message starts its visible children side by side.
  const stack: Visit[] = visibleChildren([root])
    .toReversed()
    .map(id => ({ id, parentId: null, head: true }))
  const seen = new Set<EntryId>()
  for (let v = stack.pop(); v !== undefined; v = stack.pop()) {
    if (seen.has(v.id)) continue
    seen.add(v.id)
    visits.push(v)
    const thread = index.entries[v.id]?.thread
    for (const id of visibleChildren(
      index.childrenOf.get(v.id) ?? [],
    ).toReversed())
      stack.push({
        id,
        parentId: v.id,
        head: index.entries[id]?.thread !== thread,
      })
  }
  const rank = new Map(
    visits
      .filter(v => v.head)
      .map(v => v.id)
      .sort(ascending)
      .map((id, n) => [id, n]),
  )
  const trackOf = new Map<EntryId, number>()
  return visits.map(v => {
    const track =
      rank.get(v.id) ??
      (v.parentId === null ? undefined : trackOf.get(v.parentId)) ??
      0
    trackOf.set(v.id, track)
    return { ...v, track }
  })
}

// ── threads, lanes, and the agent ─────────────────────────────────────────

/** A lane as the reads see it. */
export interface LaneView {
  readonly name: ThreadId
  readonly tip: EntryId | null
  readonly running: boolean
  /** Cards queued for it (ADR-0048). */
  readonly waiting: number
  /** Who the agent is answering, or who queued the first card: for a conflict's "by". */
  readonly askedBy: WriterId | null
  /**
   * Who queued the last card in its queue: a card queued now waits behind
   * it. Null when nothing waits.
   */
  readonly lastWaiting: WriterId | null
  /** Who holds its queue (ADR-0048 step 7); null when it is not held. */
  readonly heldBy: WriterId | null
}

export type ThreadLane =
  | { readonly kind: "none" }
  | ({ readonly kind: "lane" } & LaneView)

/**
 * A lane is busy while it runs or has cards queued: the agent works there,
 * or will once its queue is released. A root with a busy lane is not
 * archived (`rootWork`), and a
 * stopped thread does not carry on behind cards waiting (ADR-0120,
 * ADR-0048).
 */
export const isBusy = (lane: LaneView): boolean =>
  lane.running || lane.waiting > 0

/**
 * Whether a new message to the lane waits in its queue: it is busy, or its
 * queue is held, so the message would jump the queue or skip the hold
 * (ADR-0048 step 7).
 */
export const sendWaits = (lane: LaneView): boolean =>
  isBusy(lane) || lane.heldBy !== null

/**
 * The thread `entry` is in (ADR-0125): its row's. Null only for an entry the
 * index lacks. Pure.
 */
export const threadAt = (index: TreeIndex, entry: EntryId): ThreadId | null =>
  index.entries[entry]?.thread ?? null

/**
 * A thread's end (ADR-0125): its entry with no child in its own thread
 * (`TreeIndex.endOf`). Null for a thread with no entry yet. Pure.
 */
export const threadEnd = (index: TreeIndex, thread: ThreadId): EntryId | null =>
  index.endOf.get(thread) ?? null

/**
 * What a person reads first of `thread`: its first entry a column draws,
 * down the thread from `firstOf`. A branch's first run writes its context
 * entries above its prompt, so its first entry is often one no column draws.
 * Null for a thread with no message yet. Pure.
 */
export function firstMessageOf(
  index: TreeIndex,
  thread: ThreadId,
): EntryId | null {
  const seen = new Set<EntryId>()
  for (
    let id = index.firstOf.get(thread);
    id !== undefined && !seen.has(id);
    id = (index.childrenOf.get(id) ?? []).find(
      c => index.entries[c]?.thread === thread,
    )
  ) {
    seen.add(id)
    if (messageAt(index, id) !== null) return id
  }
  return null
}

/** A thread's lane: the one named by its id, if it has one (ADR-0120). */
export const laneOf = (
  lanes: readonly LaneView[],
  thread: ThreadId,
): ThreadLane => {
  const lane = lanes.find(l => l.name === thread)
  return lane === undefined ? { kind: "none" } : { kind: "lane", ...lane }
}

/** Where a send goes, as the host decides it and the composer foresees it. */
export type ThreadSend =
  | {
      readonly kind: "thread"
      /** Where it lands: the thread's end, or the branch point. */
      readonly end: Position
      readonly lane: ThreadLane
      /** Another writer's compelled message on the thread since the sender saw it. */
      readonly race: { readonly by: WriterId } | null
    }
  /** The thread has no entry, or what the sender saw is not on it. */
  | { readonly kind: "unknown" }
  /** A branch names a thread that has started already. */
  | { readonly kind: "taken" }

/**
 * Which thread a send continues (ADR-0117). Pure; the host decides from it
 * and the composer labels from it, so the promise and the decision cannot
 * differ.
 *
 * - A `branch` starts its thread at `at`, with no lane and nothing to race;
 *   a thread that has started already is `taken`.
 * - An `end` send lands at its thread's end (`threadEnd`), in its lane if it
 *   has one. Before its first entry is written, a lane created for it holds
 *   its fork: there it lands.
 *
 * A race is judged along the thread's own path, from what the sender saw
 * down to its end: a compelled message in a sibling fork is someone else's
 * thread.
 */
export function threadOfSend(
  index: TreeIndex,
  lanes: readonly LaneView[],
  send: { readonly at: SendAt; readonly me: WriterId },
): ThreadSend {
  const { at } = send
  if (at.kind === "branch") {
    if (index.firstOf.has(at.thread) || lanes.some(l => l.name === at.thread))
      return { kind: "taken" }
    if (at.at !== null && index.entries[at.at] === undefined)
      return { kind: "unknown" }
    return {
      kind: "thread",
      end: at.at === null ? { kind: "root" } : atEntry(at.at),
      lane: { kind: "none" },
      race: null,
    }
  }
  const lane = laneOf(lanes, at.thread)
  const end =
    threadEnd(index, at.thread) ?? (lane.kind === "lane" ? lane.tip : null)
  if (end === null) return { kind: "unknown" }
  // A queued card's turn was decided by its queue: nothing races it.
  if (at.kind === "queue")
    return { kind: "thread", end: atEntry(end), lane, race: null }
  if (!pathIds(index, end).has(at.seen)) return { kind: "unknown" }
  return {
    kind: "thread",
    end: atEntry(end),
    lane,
    race: raceAlong(index, at.seen, end, send.me),
  }
}

/**
 * The newest compelled chat by someone other than `me` on the path from `at`
 * (exclusive) down to `end`. A plain remark and an agent reply are not a race:
 * a compelled message simply goes after them.
 */
function raceAlong(
  index: TreeIndex,
  at: EntryId,
  end: EntryId,
  me: WriterId,
): { readonly by: WriterId } | null {
  let newest: { id: EntryId; by: WriterId } | null = null
  for (const id of ancestry(index, end).path) {
    if (id === at) break
    const m = index.entries[id]?.message
    if (
      m?.role === "chat" &&
      m.compelled === true &&
      m.writer !== undefined &&
      m.writer !== me &&
      (newest === null || id > newest.id)
    )
      newest = { id, by: m.writer }
  }
  return newest === null ? null : { by: newest.by }
}

/** One lane the agent is replying on. */
export interface AgentRun {
  readonly lane: ThreadId
  /** The lane's tip: the message it is answering, then its reply. */
  readonly tip: EntryId
}

/**
 * Every lane the agent is replying on. Threads have their own lanes, so
 * several can run at once; an empty list is an idle agent.
 */
export function agentActivity(
  running: readonly { readonly lane: ThreadId; readonly tip: EntryId | null }[],
): readonly AgentRun[] {
  return running.flatMap(r =>
    r.tip === null ? [] : [{ lane: r.lane, tip: r.tip }],
  )
}
