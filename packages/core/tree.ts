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

import type { AskIndex } from "./asks.ts"
import { type ImageRef, isImageMime, isSha256 } from "./images.ts"
import {
  atEntry,
  type EntryId,
  type LaneName,
  type PlanMode,
  type Position,
  type RevisionRecord,
  type StopRecord,
  type WriterId,
} from "./index.ts"
import { subjectOf, toolLabel, wholeToolLabel } from "./tools.ts"

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
}

export interface EntryLike {
  readonly id: EntryId
  readonly parentId: EntryId | null
  readonly type: string
  /** Absent on entries that carry no message, e.g. a compaction. */
  readonly message?: AgentMessageLike
  /** When it was written, in ms since the epoch: the row's column. */
  readonly timestamp?: number
}

export interface TranscriptMessage {
  readonly id: EntryId
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
  readonly toolCalls?: readonly ToolCallView[]
}

/** A tool call as a reader sees it. */
export interface ToolCallView {
  readonly id: string
  readonly name: string
  readonly label: string
  /** `label` uncut, when it is cut (`wholeToolLabel`). */
  readonly wholeLabel?: string
  /** What it touched, whole: a path, a command, or a search's pattern and path (`subjectOf`). */
  readonly subject?: string
  /** Its result, when the result is on the same path. */
  readonly result?: ToolResultView
}

/** A tool's result as a reader sees it. */
export interface ToolResultView {
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
 * cannot disagree. Non-message entries and roles other than user, assistant
 * and chat are dropped, `toolResult` included: a result belongs to its call,
 * which `projectSpine` pairs it with. An assistant message carries its tool
 * calls. A `chat` message is a human's, already decoded by the reader
 * (`readRenderableEntries` in `@pineta/reads`); core only admits the role, so it
 * needs no schema library.
 */
function renderableMessage(entry: EntryLike): TranscriptMessage | null {
  if (entry.type !== "message") return null
  const role = entry.message?.role ?? "unknown"
  if (role === "chat") {
    return {
      id: entry.id,
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
  // A land, update or stack message (ADR-0033, ADR-0038) shows as its short
  // line: the reader decodes it into its role with that line as its content.
  if (
    role !== "user" &&
    role !== "assistant" &&
    role !== "land" &&
    role !== "update" &&
    role !== "stack"
  )
    return null
  const message = { id: entry.id, role, text: messageText(entry.message) }
  const calls = role === "assistant" ? toolCallsOf(entry.message) : []
  return calls.length === 0 ? message : { ...message, toolCalls: calls }
}

/** The message a reader sees at `id`, or null (`renderableMessage`). */
export function messageAt(
  index: TreeIndex,
  id: EntryId,
): TranscriptMessage | null {
  const entry = index.entries[id]
  return entry === undefined ? null : renderableMessage(entry)
}

/** One call as a reader sees it, before its result is paired with it. */
function callView(id: string, name: string, args: unknown): ToolCallView {
  const wholeLabel = wholeToolLabel(name, args)
  const subject = subjectOf(name, args)
  return {
    id,
    name,
    label: toolLabel(name, args),
    ...(wholeLabel === undefined ? {} : { wholeLabel }),
    ...(subject === undefined ? {} : { subject }),
  }
}

/** An assistant message's tool calls, from its `toolCall` content parts. */
function toolCallsOf(message: AgentMessageLike | undefined): ToolCallView[] {
  const content = message?.content
  if (!Array.isArray(content)) return []
  return content.flatMap(part =>
    part?.type === "toolCall" &&
    typeof part.id === "string" &&
    typeof part.name === "string"
      ? [callView(part.id, part.name, part.arguments)]
      : [],
  )
}

/** A `toolResult` entry -> the call it answers and what it said, or null. */
function toolResultOf(
  entry: EntryLike,
): ({ readonly callId: string } & ToolResultView) | null {
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
 * The entry a turn is recorded against, from the lane's tip after it: a tool
 * result belongs to the assistant message whose call it answers, which sits
 * above it with only that message's other results between, so the walk goes
 * up past results. Anything else is its own turn: a prompt, or a message that
 * called no tools.
 */
export function turnEntry(index: TreeIndex, tip: EntryId): EntryId {
  let at = tip
  for (;;) {
    const entry = index.entries[at]
    const parent = index.parentOf(at)
    if (entry === undefined || toolResultOf(entry) === null || parent === null)
      return at
    at = parent
  }
}

/**
 * The roles a run can start with: a person's message, pi's own, a land message
 * or a stack message. An update never starts one: it is a fact in the thread.
 */
const PROMPT_ROLES: ReadonlySet<string> = new Set([
  "chat",
  "user",
  "land",
  "stack",
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
 * The tool results among `ids`' entries, by the call each answers. A result
 * is its own entry but belongs to its call: counted as a message, it would
 * add a column row and a rail row per call.
 */
function resultsOn(
  index: TreeIndex,
  ids: Iterable<EntryId>,
): ReadonlyMap<string, ToolResultView> {
  const results = new Map<string, ToolResultView>()
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
   * Chat entries by the send that wrote them. A fresh column knows its send's
   * id before the entry exists, so it finds its first message here, exactly.
   */
  readonly bySend: ReadonlyMap<string, EntryId>
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
  for (const entry of Object.values(entries)) {
    const id = entry.id
    const send = entry.message?.sendId
    if (send !== undefined) bySend.set(send, id)
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
  return {
    entries,
    childrenOf,
    parentOf: id => entries[id]?.parentId ?? null,
    roots: roots.sort(ascending),
    orphans: orphans.sort(ascending),
    bySend,
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

/**
 * What a reader sees: the newest leaf at or below `at`, or `at` itself.
 *
 * A reply to the thread, including the agent's, adds a leaf below `at`, so the
 * view moves on to it. A branch elsewhere is not below `at`, so the view never
 * jumps to it.
 *
 * Leaves, not lane tips: a conversation thread has no lane at all (ADR-0020),
 * so its end is its newest leaf, whoever wrote it. A thread that has a lane is
 * followed through the lane instead (`threadOf`, and a bound column), because
 * a conversation forked at the lane's tip is newer and is not its thread.
 */
export function followTip(index: TreeIndex, at: EntryId): EntryId {
  if (index.entries[at] === undefined) return at
  // Walk DOWN from `at`: the leaves below it are the only candidates, so there
  // is no need to walk up from every leaf in the tree to find them.
  const leaves: EntryId[] = []
  const seen = new Set<EntryId>([at])
  const stack = [...(index.childrenOf.get(at) ?? [])]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    const children = index.childrenOf.get(id) ?? []
    if (children.length === 0) leaves.push(id)
    else stack.push(...children)
  }
  return latestTip([at, ...leaves]) ?? at
}

// ── columns: open paths, side by side ─────────────────────────────────────

export interface ColumnSpec {
  /** The entry the column follows from; null only for a fresh column at the root. */
  readonly anchor: EntryId | null
  /**
   * The path ends at `anchor` (nothing, when null) and follows nothing below
   * it: a fresh column, which has nothing of its own yet, or a column bound to
   * a lane, whose anchor is the lane's tip and whose thread goes on only
   * through the lane.
   */
  readonly pinned?: boolean
}

export interface ColumnView {
  /** Where this column's path ends: its anchor if pinned or null, else `followTip`. */
  readonly tipId: EntryId | null
  /**
   * The deepest message this path shares with ANY column to its left, or null
   * when it shares none: the first column.
   * Against any column, not only the adjacent one: with the trunk, then a
   * branch off T1, then a branch off T2, the third column shares only T1 with
   * its neighbour but T2 with the trunk, and must start after T2.
   */
  readonly forkFrom: EntryId | null
  /** The path after `forkFrom` (all of it when `forkFrom` is null). */
  readonly nodes: readonly SpineNode[]
}

/**
 * The open columns' paths, each shown only past what the columns to its left
 * already show. A fresh branch, whose path is wholly shared, has no nodes and
 * forks from its anchor.
 */
export function projectColumns(
  index: TreeIndex,
  columns: readonly ColumnSpec[],
): ColumnView[] {
  const shown = new Set<EntryId>()
  return columns.map(column => {
    const tipId =
      column.pinned === true || column.anchor === null
        ? column.anchor
        : followTip(index, column.anchor)
    const { spine } = projectSpine(index, tipId)
    let cut = -1
    for (const [i, node] of spine.entries()) if (shown.has(node.id)) cut = i
    for (const node of spine) shown.add(node.id)
    return {
      tipId,
      forkFrom: cut < 0 ? null : (spine[cut]?.id ?? null),
      nodes: spine.slice(cut + 1),
    }
  })
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
  /** It begins a branch: a start, or any child but its parent's oldest. */
  readonly head: boolean
}

/**
 * One root's tree as rows: a row per message, depth-first from `root`,
 * children in id order. Tracks start at 0 in every tree.
 *
 * The oldest child continues its parent's track. A younger child, or a start
 * under a root that is no message, begins a branch, whose track is its first
 * message's rank by id among every branch's first message. Ids sort in
 * creation order (S9), so the trunk is 0 and a new branch takes the next
 * number without changing any other's. Non-message entries get no row; their
 * children attach to the nearest ancestor that has one.
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
    const children = visibleChildren(index.childrenOf.get(v.id) ?? [])
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const id = children[i]
      if (id !== undefined) stack.push({ id, parentId: v.id, head: i > 0 })
    }
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

interface RailItemBase {
  /** Its first row: its parent item's `slot + span`, or 0 at a start (`placeRail`). */
  readonly slot: number
  /** Rows it takes. */
  readonly span: number
  /** Its messages, top to bottom: each the only child of the one above. */
  readonly ids: readonly [EntryId, ...EntryId[]]
  /** Its branch (`RailRow.track`): the colour, not the place. */
  readonly track: number
  /** Where it is drawn across the rail, 0 at the left (`placeRail`). */
  readonly across: number
  /** The first message's parent, the last message of the item above: the edge into it. */
  readonly parentId: EntryId | null
}

/** A message the rail draws on its own. */
export interface RailDot extends RailItemBase {
  readonly kind: "dot"
  readonly span: 1
  readonly ids: readonly [EntryId]
}

/** A straight stretch of uneventful messages on one track, drawn as one capsule. */
export interface RailStretch extends RailItemBase {
  readonly kind: "stretch"
  readonly stats: WorkStats
  /**
   * The ask whose work it is, when it is all one long ask's work (ADR-0056);
   * null for short exchanges merged together.
   */
  readonly ask: EntryId | null
}

/**
 * What some messages hold: a stretch on the rail, or an ask's work in a
 * column. A long ask's stretch and its fold hold the same messages, so they
 * count the same.
 */
export interface WorkStats {
  /** Messages people wrote: every role but `assistant`. */
  readonly people: number
  /** Who wrote them, in order of first message. */
  readonly writers: readonly WriterId[]
  /** The agent's messages. */
  readonly agent: number
  /** Tool calls in its messages, and how many of them failed. */
  readonly calls: number
  readonly failed: number
  /** Paths its turns changed, from their revision records, sorted. */
  readonly files: readonly string[]
  /** Its first and last entries' timestamps, results included; 0 when unknown. */
  readonly first: number
  readonly last: number
}

export type RailItem = RailDot | RailStretch

/** The shortest stretch drawn as a capsule: two dots are no taller than one. */
export const MIN_STRETCH = 3

/** A stretch's rows: one, and one more per digit of its size (3–9 → 2, 10–99 → 3). */
export const stretchSpan = (size: number): number => 1 + String(size).length

/**
 * The rows drawn on their own whatever else holds: in `keep` (what the view
 * needs to see: rings, running tips, open columns' ends, your cards'
 * ends), the root's first message, a branch's first message, a fork, or a
 * thread end. The rail and the column both read it (`compactRail`,
 * `segmentPath`), so a fold never hides what the rail draws apart.
 */
export function railLandmarks(
  rows: readonly RailRow[],
  keep: ReadonlySet<EntryId>,
): ReadonlySet<EntryId> {
  const childRows = new Map<EntryId, number>()
  for (const r of rows)
    if (r.parentId !== null)
      childRows.set(r.parentId, (childRows.get(r.parentId) ?? 0) + 1)
  return new Set(
    rows
      .filter(
        r =>
          keep.has(r.id) ||
          // The root's first message, or a branch's.
          r.head ||
          childRows.get(r.id) !== 1,
      )
      .map(r => r.id),
  )
}

/** What the rail reads besides the rows: the asks, and the turns' revisions. */
export interface RailAsks {
  readonly asks: AskIndex
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
}

/**
 * What the rail draws: `projectRail`'s rows, with each straight stretch of
 * uneventful messages drawn as one capsule.
 *
 * A row is uneventful when it is not one of `railLandmarks`, and not the
 * prompt of a long ask: one whose run holds `MIN_STRETCH` agent messages
 * or more (ADR-0056). A stretch never crosses a long ask's edge, so a long
 * ask is a dot and a capsule of its own, while short exchanges still merge.
 * So a stretch holds no structure, and the compacted rail has every branch
 * the full one has.
 * An uneventful row's only child is the next row in depth-first order, so a
 * stretch is a run of consecutive rows. The items come back placed
 * (`placeRail`), in the rows' order.
 */
export function compactRail(
  index: TreeIndex,
  rows: readonly RailRow[],
  keep: ReadonlySet<EntryId>,
  { asks, revisions }: RailAsks,
): readonly RailItem[] {
  const landmarks = railLandmarks(rows, keep)
  const long = new Set<EntryId>(
    [...asks.work].flatMap(([prompt, work]) =>
      work.length >= MIN_STRETCH ? [prompt] : [],
    ),
  )
  const uneventful = (r: RailRow): boolean =>
    !landmarks.has(r.id) && !long.has(r.id)
  /** The long ask a row works for, or null: a stretch keeps to one. */
  const longAsk = (id: EntryId | undefined): EntryId | null => {
    const prompt = id === undefined ? undefined : asks.askOf.get(id)
    return prompt !== undefined && long.has(prompt) ? prompt : null
  }

  const items: Unplaced[] = []
  const dot = (r: RailRow) => {
    items.push({ kind: "dot", span: 1, ids: [r.id], ...edge(r) })
  }
  /** Row `j` carries on the stretch that row `j - 1` is in. */
  const continues = (j: number): boolean => {
    const r = rows[j]
    const before = rows[j - 1]
    return (
      r !== undefined &&
      uneventful(r) &&
      r.parentId === before?.id &&
      longAsk(r.id) === longAsk(before.id)
    )
  }
  for (let i = 0; i < rows.length; ) {
    const start = rows[i]
    if (start === undefined) break
    if (!uneventful(start)) {
      dot(start)
      i += 1
      continue
    }
    let end = i + 1
    while (continues(end)) end += 1
    const stretch = rows.slice(i, end)
    const [first, ...more] = stretch
    if (first === undefined || stretch.length < MIN_STRETCH)
      stretch.forEach(dot)
    else {
      const span = stretchSpan(stretch.length)
      const ids: readonly [EntryId, ...EntryId[]] = [
        first.id,
        ...more.map(r => r.id),
      ]
      items.push({
        kind: "stretch",
        span,
        ids,
        ...edge(first),
        stats: workStats(index, ids, rows[end]?.id, revisions),
        ask: longAsk(first.id),
      })
    }
    i = end
  }
  return placeRail(items)
}

const edge = (r: RailRow) => ({ track: r.track, parentId: r.parentId })

/** A rail item before `placeRail` says where it is drawn. */
type Unplaced =
  | Omit<RailDot, "slot" | "across">
  | Omit<RailStretch, "slot" | "across">

/**
 * Where each item is drawn: `items` in depth-first order, each after the item
 * holding its parent.
 *
 * Rows go by depth, not by order: an item's slot is its parent item's
 * `slot + span`, so a branch starts on the row under its fork, beside the
 * older subtree rather than below it.
 *
 * A branch (the items of one track) takes the rows from its fork's last row
 * to its own last row, and the lowest place across whose last branch ended
 * above them, branches taken by their first row. Like booking rooms, each
 * branch takes the leftmost one free for its whole stay, so the rail is no
 * wider than the most branches on any one row. The fork's row is in the
 * range, so a branch never shares its parent's place, and the bend into it
 * never lands on another branch's dot.
 */
function placeRail(items: readonly Unplaced[]): readonly RailItem[] {
  const slots: number[] = []
  const itemAt = new Map<EntryId, number>()
  const parentOf = (it: Unplaced): number | undefined =>
    it.parentId === null ? undefined : itemAt.get(it.parentId)
  /** The last row item `k` takes. */
  const lastRow = (k: number): number =>
    (slots[k] ?? 0) + (items[k]?.span ?? 1) - 1
  const branches = new Map<number, { from: number; to: number }>()
  for (const [k, it] of items.entries()) {
    const p = parentOf(it)
    const slot = p === undefined ? 0 : lastRow(p) + 1
    slots.push(slot)
    for (const id of it.ids) itemAt.set(id, k)
    const was = branches.get(it.track)
    branches.set(it.track, {
      from: was?.from ?? (p === undefined ? slot : lastRow(p)),
      to: Math.max(was?.to ?? 0, lastRow(k)),
    })
  }
  const ends: number[] = []
  const acrossOf = new Map<number, number>()
  const order = [...branches].sort(
    ([ta, a], [tb, b]) => a.from - b.from || ta - tb,
  )
  for (const [track, { from, to }] of order) {
    let across = 0
    while ((ends[across] ?? -1) >= from) across += 1
    ends[across] = to
    acrossOf.set(track, across)
  }
  return items.map((it, k) => ({
    ...it,
    slot: slots[k] ?? 0,
    across: acrossOf.get(it.track) ?? 0,
  }))
}

/**
 * What `ids`' messages hold, consecutive on one path. Their tool results are
 * between them: below each, up to the next one, or `after` for the last.
 */
export function workStats(
  index: TreeIndex,
  ids: readonly EntryId[],
  after: EntryId | undefined,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): WorkStats {
  const between: EntryId[] = []
  for (const [k, id] of ids.entries()) {
    const next = ids[k + 1] ?? after
    if (next === undefined) continue
    for (
      let at = index.parentOf(next);
      at !== null && at !== id;
      at = index.parentOf(at)
    )
      between.push(at)
  }
  return statsOf(index, ids, between, revisions)
}

/**
 * What `messages` hold, with `others`, the entries among them that are no
 * message (tool results), for their failures and their times. Files are the
 * paths the messages' turns' revision records name.
 */
export function statsOf(
  index: TreeIndex,
  messages: readonly EntryId[],
  others: readonly EntryId[],
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): WorkStats {
  let people = 0
  const calls: ToolCallView[] = []
  const files = new Set<string>()
  const times: number[] = []
  for (const id of [...messages, ...others]) {
    const t = index.entries[id]?.timestamp
    if (t !== undefined) times.push(t)
  }
  for (const id of messages) {
    const message = messageAt(index, id)
    if (message?.role !== "assistant") people += 1
    calls.push(...(message?.toolCalls ?? []))
    for (const p of revisions.get(id)?.paths ?? []) files.add(p)
  }
  const results = resultsOn(index, others)
  return {
    people,
    writers: writersOf(index, messages),
    agent: messages.length - people,
    calls: calls.length,
    failed: calls.filter(c => results.get(c.id)?.isError === true).length,
    files: [...files].sort(),
    first: times.length === 0 ? 0 : Math.min(...times),
    last: times.length === 0 ? 0 : Math.max(...times),
  }
}

// ── threads, lanes, and the agent ─────────────────────────────────────────

/** A lane as the reads see it. */
export interface LaneView {
  readonly name: LaneName
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
}

export type ThreadLane =
  | { readonly kind: "none" }
  | ({ readonly kind: "lane" } & LaneView)

/**
 * A lane is busy while it runs or has cards queued: a new message then
 * waits behind them, or it would jump the queue (ADR-0020, ADR-0048).
 */
export const isBusy = (lane: LaneView): boolean =>
  lane.running || lane.waiting > 0

/** Which thread a send continues, as the host and the composer both decide it. */
export type ThreadOf =
  | {
      readonly kind: "thread"
      /** Where a `reply` lands: the thread's end, or `at` for a `branch`. */
      readonly end: Position
      readonly lane: ThreadLane
      /** Another writer's compelled message on the thread since `at`. */
      readonly race: { readonly by: WriterId } | null
    }
  /** `at`, or the named lane, is not in this tree, or `at` is not on the lane. */
  | { readonly kind: "unknown" }
  /** Two lanes end where the sender is: which one they meant cannot be told. */
  | { readonly kind: "ambiguous" }

/**
 * Which thread a send continues. Pure; the host decides from it and the
 * composer labels from it, so the promise and the decision cannot differ.
 *
 * - A `branch` starts a thread at `at`, with no lane and nothing to race.
 * - A send naming its lane continues that lane: its tip is the end, wherever
 *   the newest leaf below `at` is (ADR-0021: a conversation forked at the
 *   lane's tip is newer, and is another thread).
 * - Otherwise the thread is the newest leaf below `at` (`followTip`), and its
 *   lane is the one ending there, if exactly one does.
 *
 * A race is judged along the thread's own path, from `at` down to its end: a
 * compelled message in a sibling fork is someone else's thread.
 */
export function threadOf(
  index: TreeIndex,
  lanes: readonly LaneView[],
  send: {
    readonly at: Position
    readonly mode: PlanMode
    readonly lane: LaneName | null
    readonly me: WriterId
  },
): ThreadOf {
  const { at } = send
  if (at.kind === "entry" && index.entries[at.id] === undefined)
    return { kind: "unknown" }
  if (send.mode === "branch")
    return { kind: "thread", end: at, lane: { kind: "none" }, race: null }
  if (at.kind === "root") return { kind: "unknown" }

  let end: EntryId
  let lane: LaneView | undefined
  if (send.lane !== null) {
    // Named, the lane is the thread: never looked up again by its tip, which
    // a lane just branched there may share for a moment.
    lane = lanes.find(l => l.name === send.lane)
    if (lane?.tip == null || !pathIds(index, lane.tip).has(at.id))
      return { kind: "unknown" }
    end = lane.tip
  } else {
    // A lane's tip is its thread's end (ADR-0020), so the end names the
    // thread's lane with no stored mapping. Two lanes share a tip for a moment
    // after a compelled branch at a lane's tip, until the new one's prompt
    // commits: then the end names neither.
    end = followTip(index, at.id)
    const ending = lanes.filter(l => l.tip === end)
    if (ending.length > 1) return { kind: "ambiguous" }
    lane = ending[0]
  }
  return {
    kind: "thread",
    end: atEntry(end),
    lane: lane === undefined ? { kind: "none" } : { kind: "lane", ...lane },
    race: raceAlong(index, at.id, end, send.me),
  }
}

/** What stopping a thread's lane does (`planStop`). */
export type StopPlan =
  | {
      readonly kind: "abort"
      /** Who stopped the ask; null when it is recorded already. */
      readonly record: StopRecord | null
    }
  | { readonly kind: "idle" }
  | { readonly kind: "unknown" }

/**
 * What stopping a thread's lane does: abort its running turn, recording who
 * stopped its ask (ADR-0056), unless someone's stop is recorded already, so
 * the first press is the one named; nothing when it is idle (stopping is
 * idempotent); refused for a lane that does not exist. Pure.
 */
export function planStop(
  lanes: readonly LaneView[],
  lane: LaneName,
  facts: {
    readonly index: TreeIndex
    readonly stops: ReadonlyMap<EntryId, StopRecord>
    readonly by: WriterId
    readonly now: number
  },
): StopPlan {
  const found = lanes.find(l => l.name === lane)
  if (found === undefined) return { kind: "unknown" }
  if (!found.running) return { kind: "idle" }
  const prompt = promptOf(facts.index, found.tip)
  return {
    kind: "abort",
    record:
      prompt === null || facts.stops.has(prompt)
        ? null
        : { prompt, by: facts.by, at: facts.now },
  }
}

/**
 * Whether a message with no mention asks the agent: in a thread with a lane,
 * or from a Start Agent column. A branch is a new thread, with no lane of its
 * own yet, so only a Start Agent column makes it ask (ADR-0021). A branch from
 * agent work asks through the `@agent ` its composer starts with.
 */
export const agentByDefault = (send: {
  readonly mode: PlanMode
  readonly lane: ThreadLane
  readonly asksAgent: boolean
}): boolean =>
  (send.mode !== "branch" && send.lane.kind === "lane") || send.asksAgent

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
  readonly lane: LaneName
  /** The lane's tip: the message it is answering, then its reply. */
  readonly tip: EntryId
}

/**
 * Every lane the agent is replying on. Threads have their own lanes, so
 * several can run at once; an empty list is an idle agent.
 */
export function agentActivity(
  running: readonly { readonly lane: LaneName; readonly tip: EntryId | null }[],
): readonly AgentRun[] {
  return running.flatMap(r =>
    r.tip === null ? [] : [{ lane: r.lane, tip: r.tip }],
  )
}

/** A column with no messages of its own yet: a fresh branch. */
export const PENDING_TRACK = -1

export interface BranchColors {
  /** Per column: the rail track of its last message, or PENDING_TRACK. */
  readonly track: readonly number[]
  /** Fork dots: at each `forkFrom` message, the tracks of the columns forking there. */
  readonly forks: ReadonlyMap<EntryId, readonly number[]>
}

/**
 * Each column's colour, and the dots it puts where it forks. Colour, not drawn
 * lines, links a branch to its parent, so sibling branches never cross. A
 * column takes the track of its last message, which is where its path ends in
 * the rail; the renderer maps a track to one fixed palette, so the rail, the
 * column's header and its fork dot always agree.
 */
export function branchColors(
  rail: readonly RailRow[],
  columns: readonly ColumnView[],
): BranchColors {
  const trackOf = new Map(rail.map(r => [r.id, r.track]))
  const track = columns.map(c => {
    const last = c.nodes.at(-1)?.id
    return last === undefined
      ? PENDING_TRACK
      : (trackOf.get(last) ?? PENDING_TRACK)
  })
  const forks = new Map<EntryId, number[]>()
  for (const [i, c] of columns.entries()) {
    if (c.forkFrom === null) continue
    const t = track[i] ?? PENDING_TRACK
    const at = forks.get(c.forkFrom)
    if (at === undefined) forks.set(c.forkFrom, [t])
    else at.push(t)
  }
  return { track, forks }
}
