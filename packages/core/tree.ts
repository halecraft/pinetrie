// core/tree — every read of the conversation tree.
//
// The tree is read many ways (a transcript, a spine, columns, a rail, where a
// view should follow) but indexed once: `indexTree` builds the parent and child
// maps a view needs, and every view takes that index, so a column view that
// calls several of them does not rebuild it each time.
//
// Order is structural throughout: the `parentId` walk, and ids, which are
// uuidv7 and so sort by creation. Nothing here can see a seq.
//
// A tool's result is its own entry, but it belongs to its call: `projectSpine`
// pairs it with the call on the same path, and it is never a message itself.

import type { PointId } from "./bases.ts"
import {
  atEntry,
  type EntryId,
  type Position,
  type ThreadId,
  type WriterId,
} from "./ids.ts"
import { type ImageRef, isImageMime, isSha256 } from "./images.ts"
import type { SendAt } from "./intents.ts"
import type {
  AgentMessageLike,
  CanvasPinnedView,
  CanvasView,
  EntryLike,
  PinnedView,
  Role,
  ToolCall,
  ToolResult,
  TranscriptMessage,
} from "./messages.ts"
import { callIntent, callSubject } from "./tools.ts"

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

/** A message's text: its plain content, or its text parts joined. */
export function messageText(message: AgentMessageLike | undefined): string {
  const content = message?.content
  if (content === undefined) return ""
  if (typeof content === "string") return content
  return content
    .flatMap(part => (part.type === "text" ? [part.text] : []))
    .join("")
}

const isDimension = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0

/**
 * A stored part -> the image it holds as a blob, or undefined. A part with its
 * bytes inline is not one: no `/blob/` URL serves it. The session keeps one
 * from before images were blobs, or from a host with no store.
 */
export function storedImage(part: unknown): ImageRef | undefined {
  if (typeof part !== "object" || part === null) return undefined
  const p: {
    readonly type?: unknown
    readonly data?: unknown
    readonly sha256?: unknown
    readonly mimeType?: unknown
    readonly width?: unknown
    readonly height?: unknown
  } = part
  return p.type === "image" &&
    p.data === undefined &&
    typeof p.sha256 === "string" &&
    isSha256(p.sha256) &&
    typeof p.mimeType === "string" &&
    isImageMime(p.mimeType) &&
    isDimension(p.width) &&
    isDimension(p.height)
    ? {
        sha256: p.sha256,
        mimeType: p.mimeType,
        width: p.width,
        height: p.height,
      }
    : undefined
}

/**
 * The stored images in a stored message's content, in order, whatever its
 * role: what the blob sweep keeps, so a message the reads leave out loses
 * none of them.
 */
export function storedImages(message: unknown): ImageRef[] {
  if (typeof message !== "object" || message === null) return []
  const { content }: { readonly content?: unknown } = message
  return Array.isArray(content)
    ? content.flatMap(part => storedImage(part) ?? [])
    : []
}

/** The stored images in a message's content, in order. */
export function messageImages(
  message: AgentMessageLike | undefined,
): ImageRef[] {
  const content = message?.content
  if (content === undefined || typeof content === "string") return []
  return content.flatMap(part =>
    part.type === "image"
      ? [
          {
            sha256: part.sha256,
            mimeType: part.mimeType,
            width: part.width,
            height: part.height,
          },
        ]
      : [],
  )
}

/**
 * One entry -> the message a reader sees, or `null` if it is not one.
 *
 * The one rule for which entries are messages, shared by every view so they
 * cannot disagree. A person's message, an ask relayed from another thread and
 * its answer, pi's user and assistant messages and the host's one-line
 * messages (`isLineRole`) are; a tool's result is not, since it belongs to its
 * call, which `projectSpine` pairs it with, nor is a run's context entry, nor
 * pi's system message. An assistant message carries its tool calls.
 */
function renderableMessage(entry: EntryLike): TranscriptMessage | null {
  const m = entry.message
  if (entry.type !== "message" || m === undefined) return null
  const said = { id: entry.id, thread: entry.thread, text: messageText(m) }
  switch (m.role) {
    case "person":
      return {
        ...said,
        role: m.role,
        author: m.author,
        compelled: m.compelled,
        writer: m.writer,
        sendId: m.sendId,
        ...(m.contributors === undefined
          ? {}
          : { contributors: m.contributors }),
        ...(m.command === undefined ? {} : { command: m.command }),
        ...(m.images === undefined ? {} : { images: m.images }),
        ...(m.shared === undefined ? {} : { shared: m.shared }),
      }
    // An ask from another thread, and an asked agent's answer, are messages as
    // a person's is, spoken by the asker and by the answering thread.
    case "relay":
      return {
        ...said,
        role: m.role,
        author: m.relay.askerName,
        from: m.relay.from,
      }
    case "answer":
      return {
        ...said,
        role: m.role,
        author: m.answer.fromName,
        from: m.answer.from,
      }
    case "land":
    case "update":
      return { ...said, role: m.role, merged: m.merged }
    case "incoming":
      return { ...said, role: m.role, from: m.incoming.from }
    case "fact":
      return m.detail === undefined
        ? { ...said, role: m.role }
        : { ...said, role: m.role, detail: m.detail }
    case "assistant": {
      const calls = messageToolCalls(m)
      return calls.length === 0
        ? { ...said, role: m.role }
        : { ...said, role: m.role, toolCalls: calls }
    }
    case "user":
    case "stack":
    case "carry-on":
    case "behind":
      return { ...said, role: m.role }
    case "system":
    case "toolResult":
    case "pinned":
    case "canvas-pinned":
    case "canvas":
      return null
  }
}

/**
 * How each role reads. Every role is a key, so a new one does not compile
 * until it is placed.
 *
 * - `line`: the host's own message, which a column shows as one line, from
 *   pine·trie: a resolution's prompt (`land`), an update and a split's prompt
 *   (`update`, `stack`), a Resume's carry-on (`carry-on`), the host's facts
 *   (`fact`: what a command on the proposed changes did, a stop, a member
 *   gone, an allowance spent, a canvas change), that the base has new work
 *   (`behind`), and what an asked agent was told of the thread that asked
 *   (`incoming`).
 * - `prompt`: a run can start with it: a person's message, pi's own, a land,
 *   stack or carry-on message, an ask relayed from another thread and the
 *   answer that wakes its asker. An update never starts one: it is a fact in
 *   the thread. Nor does a cards entry (role `pinned`): it is written with a
 *   run's prompt, as its parent.
 */
const ROLE_READS = {
  person: { line: false, prompt: true },
  user: { line: false, prompt: true },
  system: { line: false, prompt: false },
  assistant: { line: false, prompt: false },
  toolResult: { line: false, prompt: false },
  land: { line: true, prompt: true },
  update: { line: true, prompt: false },
  stack: { line: true, prompt: true },
  "carry-on": { line: true, prompt: true },
  fact: { line: true, prompt: false },
  behind: { line: true, prompt: false },
  relay: { line: false, prompt: true },
  answer: { line: false, prompt: true },
  incoming: { line: true, prompt: false },
  pinned: { line: false, prompt: false },
  "canvas-pinned": { line: false, prompt: false },
  canvas: { line: false, prompt: false },
} as const satisfies Record<
  Role,
  { readonly line: boolean; readonly prompt: boolean }
>

/** Whether `role` is the host's own one-line message (`ROLE_READS`). */
export const isLineRole = (role: Role): boolean => ROLE_READS[role].line

/** The message a reader sees at `id`, or null (`renderableMessage`). */
export function entryMessage(
  index: TreeIndex,
  id: EntryId,
): TranscriptMessage | null {
  const entry = index.entries[id]
  return entry === undefined ? null : renderableMessage(entry)
}

/**
 * The message that stands for `id` where only messages are drawn: `id` when
 * it is one (`entryMessage`), else its nearest ancestor that is, as a tool's
 * result stands under its call. Null when none up to the root is.
 */
export function nearestMessage(index: TreeIndex, id: EntryId): EntryId | null {
  for (const at of ancestry(index, id).path)
    if (entryMessage(index, at) !== null) return at
  return null
}

/** One call, before its result is paired with it. */
function callOf(id: string, name: string, args: unknown): ToolCall {
  const subject = callSubject(name, args)
  const intent = callIntent(args)
  return {
    id,
    name,
    ...(subject === undefined ? {} : { subject }),
    ...(intent === undefined ? {} : { intent }),
  }
}

/** The tool calls an assistant message makes, from its `toolCall` content parts; none for any other message. */
export function messageToolCalls(
  message: AgentMessageLike | undefined,
): ToolCall[] {
  if (message?.role !== "assistant" || typeof message.content === "string")
    return []
  return message.content.flatMap(part =>
    part.type === "toolCall"
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
  return {
    callId: m.toolCallId,
    text: messageText(m),
    isError: m.isError,
    images: messageImages(m),
  }
}

/**
 * The entries a turn ends with, newest first, from the lane's tip after it: its
 * tool results, and a host's fact steered in after them (role `behind`), up to
 * the assistant message whose calls they follow.
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
 * above it with only that message's other results between, so the walk goes up
 * past results, and past a steered fact after them. Anything else is its own
 * turn: a prompt, or a message that called no tools.
 */
export function turnEntry(index: TreeIndex, tip: EntryId): EntryId {
  const tail = turnTail(index, tip)
  const last = tail.at(-1)
  return last === undefined ? tip : (index.parentOf(last) ?? tip)
}

/**
 * The base states a message says were merged into the lane: an update's, a
 * resolution's, or a `catch_up` result's; undefined for any other message.
 */
export function messageMerged(
  message: AgentMessageLike | undefined,
): readonly PointId[] | undefined {
  switch (message?.role) {
    case "update":
    case "land":
    case "toolResult":
      return message.merged
    default:
      return undefined
  }
}

/**
 * Whether a turn merged into the lane: one of its results is a `catch_up` that
 * says what it merged. The merge moved the lane's bookmark, so the turn's
 * record names it.
 */
export const turnMerged = (index: TreeIndex, tip: EntryId): boolean =>
  turnTail(index, tip).some(id => {
    const m = index.entries[id]?.message
    return m?.role === "toolResult" && m.merged !== undefined
  })

/** Whether a run can start with `entry` (`ROLE_READS`). */
export const startsRun = (entry: EntryLike | undefined): boolean => {
  const role = entry?.message?.role
  return role !== undefined && ROLE_READS[role].prompt
}

/**
 * The prompt of the run that wrote `tip`: its nearest ancestor-or-self a run
 * can start with. A lane is never written while it runs, so no person's message
 * sits between a run's prompt and its tip. `indexAsks` finds every run's prompt
 * at once.
 */
export function runPrompt(
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
    e => (e.message?.role === "pinned" ? e.message.pinned : undefined),
    e => e.carried?.pinned ?? null,
  )

/** The cards pinned to the canvas the model reads on a run from `tip`, as `pinnedInView` finds a thread's. */
export const canvasPinnedInView = (
  index: TreeIndex,
  tip: EntryId | null,
): CanvasPinnedView | null =>
  newestOnPath(
    index,
    tip,
    e =>
      e.message?.role === "canvas-pinned" ? e.message.canvasPinned : undefined,
    e => e.carried?.canvasPinned ?? null,
  )

/** The canvas's cards the model was last told of on a run from `tip`, as `pinnedInView` finds pinned cards. */
export const canvasInView = (
  index: TreeIndex,
  tip: EntryId | null,
): CanvasView | null =>
  newestOnPath(
    index,
    tip,
    e => (e.message?.role === "canvas" ? e.message.canvas : undefined),
    e => e.carried?.canvas ?? null,
  )

/**
 * The base states the thread at `tip` last heard of or merged: a behind
 * entry's `to`, or what an update, a resolution or a `catch_up` merged, the
 * newest on the path. Null with none, or past a compaction: a fact pi
 * summarised away is told again.
 */
export const baseKnown = (
  index: TreeIndex,
  tip: EntryId | null,
): readonly PointId[] | null =>
  newestOnPath(
    index,
    tip,
    e =>
      e.message?.role === "behind"
        ? [e.message.behind.to]
        : messageMerged(e.message),
    () => null,
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
  /** Children of each entry, ascending by id (creation order). */
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
   * Each thread's first entry: its entry whose parent is in another thread, or
   * absent. Its parent is the thread's fork. Often a context entry no column
   * draws: what a person reads first is `threadFirstMessage`'s. Two such entries
   * keep the older.
   */
  readonly firstOf: ReadonlyMap<ThreadId, EntryId>
  /**
   * Each thread's end: its entry with no child in its own thread. Two such
   * entries keep the newer by id (uuidv7), never by the order they are read
   * in, so every client picks the same one.
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
    const send =
      entry.message?.role === "person" ? entry.message.sendId : undefined
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
export function treeRoot(index: TreeIndex, id: EntryId): EntryId | null {
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
export function messageWriters(
  index: TreeIndex,
  ids: Iterable<EntryId>,
): readonly WriterId[] {
  const out: WriterId[] = []
  for (const id of [...ids].sort()) {
    const m = index.entries[id]?.message
    const w = m?.role === "person" ? m.writer : undefined
    if (w !== undefined && !out.includes(w)) out.push(w)
  }
  return out
}

// ── the transcript: what the model reads ──────────────────────────────────

/**
 * The path to `tipId` as an ordered transcript, root first.
 *
 * Order comes from the `parentId` walk, never from seq, which is local to a
 * replica. A cycle throws: a transcript with a cycle in it has no order to
 * give.
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

export type SpineNode = TranscriptMessage & {
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
      found.role !== "assistant" || found.toolCalls === undefined
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
 * A branch is a thread: a child in its parent row's thread continues its track,
 * and any other child, or a start under a root that is no message, begins a
 * branch, whose track is its first message's rank by id among every branch's
 * first message. Ids sort in creation order, so the trunk is 0 and a new branch
 * takes the next number without changing any other's. Non-message entries get
 * no row; their children attach to the nearest ancestor that has one.
 */
export function projectRail(
  index: TreeIndex,
  root: EntryId,
): readonly RailRow[] {
  const visible = (id: EntryId): boolean => entryMessage(index, id) !== null
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
  /** Cards queued for it. */
  readonly waiting: number
  /** Who the agent is answering, or who queued the first card: for a conflict's "by". */
  readonly askedBy: WriterId | null
  /**
   * Who queued the last card in its queue: a card queued now waits behind
   * it. Null when nothing waits.
   */
  readonly lastWaiting: WriterId | null
  /** Who holds its queue; null when it is not held. */
  readonly heldBy: WriterId | null
}

export type ThreadLane =
  | { readonly kind: "none" }
  | ({ readonly kind: "lane" } & LaneView)

/**
 * A lane is busy while it runs or has cards queued: the agent works there, or
 * will once its queue is released. A task with a busy lane is not archived
 * (`threadsWork`), and a stopped thread does not carry on behind cards waiting.
 */
export const isBusy = (lane: LaneView): boolean =>
  lane.running || lane.waiting > 0

/**
 * Whether a new message to the lane waits in its queue: it is busy, or its
 * queue is held, so the message would jump the queue or skip the hold.
 */
export const sendWaits = (lane: LaneView): boolean =>
  isBusy(lane) || lane.heldBy !== null

/**
 * The thread `entry` is in: its row's. Null only for an entry the index lacks.
 */
export const entryThread = (
  index: TreeIndex,
  entry: EntryId,
): ThreadId | null => index.entries[entry]?.thread ?? null

/**
 * A thread's end: its entry with no child in its own thread
 * (`TreeIndex.endOf`). Null for a thread with no entry yet.
 */
export const threadEnd = (index: TreeIndex, thread: ThreadId): EntryId | null =>
  index.endOf.get(thread) ?? null

/**
 * What a person reads first of `thread`: its first entry a column draws, down
 * the thread from `firstOf`. A branch's first run writes its context entries
 * above its prompt, so its first entry is often one no column draws. Null for a
 * thread with no message yet.
 */
export function threadFirstMessage(
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
    if (entryMessage(index, id) !== null) return id
  }
  return null
}

/** A thread's lane: the one named by its id, if it has one. */
export const threadLane = (
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
 * Which thread a send continues. The host decides from it and the composer
 * labels from it, so the promise and the decision cannot differ.
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
  const lane = threadLane(lanes, at.thread)
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
      m?.role === "person" &&
      m.compelled &&
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
