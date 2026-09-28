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

import {
  atEntry,
  type ChatMode,
  type EntryId,
  entryId,
  type LaneName,
  type Position,
  type WriterId,
} from "./index.ts"
import { toolLabel } from "./tools.ts"

// ── entries and messages ──────────────────────────────────────────────────

export interface MessagePart {
  readonly type?: string
  readonly text?: string
  /** A `toolCall` part: the call's id, the tool, and its arguments. */
  readonly id?: string
  readonly name?: string
  readonly arguments?: unknown
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
  /** Role `chat` only: a sent draft's other editors. */
  readonly contributors?: readonly WriterId[]
  /** Role `toolResult` only: the call it answers, and whether it failed. */
  readonly toolCallId?: string
  readonly isError?: boolean
}

export interface EntryLike {
  readonly id: string
  readonly parentId: string | null
  readonly type: string
  /** Absent on entries that carry no message, e.g. a compaction. */
  readonly message?: AgentMessageLike
}

export interface TranscriptMessage {
  readonly id: string
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
  /** Role `chat` only: a sent draft's other editors, in order of first edit. */
  readonly contributors?: readonly WriterId[]
  /** Role `assistant` only: the tools it called, each with its result once known. */
  readonly toolCalls?: readonly ToolCallView[]
}

/** A tool call as a reader sees it. */
export interface ToolCallView {
  readonly id: string
  readonly name: string
  readonly label: string
  /** Its result, when the result is on the same path. */
  readonly result?: { readonly text: string; readonly isError: boolean }
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
    }
  }
  // A land message (ADR-0033) shows as its short line: the reader decodes it
  // into role `land` with that line as its content.
  if (role !== "user" && role !== "assistant" && role !== "land") return null
  const message = { id: entry.id, role, text: messageText(entry.message) }
  const calls = role === "assistant" ? toolCallsOf(entry.message) : []
  return calls.length === 0 ? message : { ...message, toolCalls: calls }
}

/** An assistant message's tool calls, from its `toolCall` content parts. */
function toolCallsOf(message: AgentMessageLike | undefined): ToolCallView[] {
  const content = message?.content
  if (!Array.isArray(content)) return []
  return content.flatMap(part =>
    part?.type === "toolCall" &&
    typeof part.id === "string" &&
    typeof part.name === "string"
      ? [
          {
            id: part.id,
            name: part.name,
            label: toolLabel(part.name, part.arguments),
          },
        ]
      : [],
  )
}

/** A `toolResult` entry -> the call it answers and what it said, or null. */
function toolResultOf(entry: EntryLike): {
  readonly callId: string
  readonly text: string
  readonly isError: boolean
} | null {
  const m = entry.message
  if (entry.type !== "message" || m?.role !== "toolResult") return null
  if (typeof m.toolCallId !== "string") return null
  return {
    callId: m.toolCallId,
    text: messageText(m),
    isError: m.isError === true,
  }
}

/**
 * The entry a turn is recorded against, from the lane's tip after it: a tool
 * result belongs to the assistant message whose call it answers, which sits
 * above it with only that message's other results between, so the walk goes
 * up past results. Anything else is its own turn: a prompt, or a message that
 * called no tools.
 */
export function turnEntry(index: TreeIndex, tip: string): EntryId {
  let at = tip
  for (;;) {
    const entry = index.entries[at]
    const parent = index.parentOf(at)
    if (entry === undefined || toolResultOf(entry) === null || parent === null)
      return entryId(at)
    at = parent
  }
}

/** The roles a run can start with: a person's message, pi's own, or a land message. */
const PROMPT_ROLES: ReadonlySet<string> = new Set(["chat", "user", "land"])

/**
 * The prompt of the run that wrote `tip`: its nearest ancestor-or-self a run
 * can start with. A lane is never written while it runs (S21), so no person's
 * message sits between a run's prompt and its tip.
 */
export function promptOf(index: TreeIndex, tip: string | null): EntryId | null {
  for (const id of ancestry(index, tip).path) {
    const role = index.entries[id]?.message?.role
    if (role !== undefined && PROMPT_ROLES.has(role)) return entryId(id)
  }
  return null
}

/**
 * The tool results among `ids`' entries, by the call each answers. A result
 * is its own entry but belongs to its call: counted as a message, it would
 * add a column row and a rail row per call.
 */
function resultsOn(
  index: TreeIndex,
  ids: Iterable<string>,
): ReadonlyMap<string, { readonly text: string; readonly isError: boolean }> {
  const results = new Map<string, { text: string; isError: boolean }>()
  for (const id of ids) {
    const entry = index.entries[id]
    const r = entry === undefined ? null : toolResultOf(entry)
    if (r !== null) results.set(r.callId, { text: r.text, isError: r.isError })
  }
  return results
}

// ── the index ─────────────────────────────────────────────────────────────

export interface TreeIndex {
  readonly entries: Readonly<Record<string, EntryLike>>
  /** Children of each entry, ascending by id (creation order, S9). */
  readonly childrenOf: ReadonlyMap<string, readonly string[]>
  /** An entry's parent id as stored; null for a root. */
  readonly parentOf: (id: string) => string | null
  /** Entries with no parent: one per thread started at the root. Ascending by id. */
  readonly roots: readonly string[]
  /** Entries whose parent is absent from the set. Never dropped. Ascending. */
  readonly orphans: readonly string[]
  /**
   * Chat entries by the send that wrote them. A fresh column knows its send's
   * id before the entry exists, so it finds its first message here, exactly.
   */
  readonly bySend: ReadonlyMap<string, string>
}

const ascending = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Index the tree once. Every list is sorted by id, never left in iteration
 * order, so two replicas holding the same entries build the same index.
 */
export function indexTree(
  entries: Readonly<Record<string, EntryLike>>,
): TreeIndex {
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  const orphans: string[] = []
  const bySend = new Map<string, string>()
  for (const [id, entry] of Object.entries(entries)) {
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
  readonly path: readonly string[]
  /** The id where the walk met itself, or null. Callers decide what a cycle means. */
  readonly cycleAt: string | null
}

/** Walk up from `id`. Stops, rather than spinning, on a cycle. */
export function ancestry(index: TreeIndex, id: string | null): Ancestry {
  const path: string[] = []
  const seen = new Set<string>()
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
export function rootOf(index: TreeIndex, id: string): string | null {
  return ancestry(index, id).path.at(-1) ?? null
}

/** The ids on the path to `tip`. */
export const pathIds = (
  index: TreeIndex,
  tip: string | null,
): ReadonlySet<string> => new Set(ancestry(index, tip).path)

/**
 * Who wrote `ids`' messages, in order of first message: ids are uuidv7, so
 * sorting them is creation order.
 */
export function writersOf(
  index: TreeIndex,
  ids: Iterable<string>,
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
  tipId: string | null,
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
  readonly rootId: string
  /** Messages in the whole subtree, for its "⑂ n messages" button. */
  readonly messageCount: number
  /** Of those, the ones that are notes' messages (ADR-0025): "· 1 note". */
  readonly noteCount: number
}

const NO_NOTES: ReadonlySet<string> = new Set()

export interface SpineNode extends TranscriptMessage {
  /** Children of this node that are NOT the next node on the spine. */
  readonly branches: readonly BranchSummary[]
}

export interface SpineProjection {
  readonly spine: readonly SpineNode[]
  /** Ids whose parentId names an entry absent from the set. Never dropped. */
  readonly orphans: readonly string[]
  /** Ids on a parentId cycle. Reported rather than spun on. */
  readonly cycles: readonly string[]
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
  tipId: string | null,
  /** The entries that are notes' messages, which a branch's summary counts. */
  notes: ReadonlySet<string> = NO_NOTES,
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
      .map(rootId => summarizeBranch(index, rootId, notes))
    spine.push({ ...message, branches })
  }
  return {
    spine,
    orphans: index.orphans,
    cycles: cycleAt === null ? [] : [cycleAt],
  }
}

/** A branch's size: its messages, and how many of them are notes'. */
function summarizeBranch(
  index: TreeIndex,
  rootId: string,
  notes: ReadonlySet<string>,
): BranchSummary {
  let messageCount = 0
  let noteCount = 0
  const stack = [rootId]
  const visited = new Set<string>()
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (visited.has(id)) continue
    visited.add(id)
    // What the rail and columns show as a message, so a tool's result, which
    // belongs to its call, is not counted.
    const entry = index.entries[id]
    if (entry !== undefined && renderableMessage(entry) !== null) {
      messageCount += 1
      if (notes.has(id)) noteCount += 1
    }
    stack.push(...(index.childrenOf.get(id) ?? []))
  }
  return { rootId, messageCount, noteCount }
}

// ── following a thread ────────────────────────────────────────────────────

/**
 * The most recently advanced tip among `tips`, or null if none has one.
 *
 * Entry ids are uuidv7, so the greatest id is the newest (S9). Chosen by
 * comparing ids, never by position in `tips`: two clients reading the same
 * document in a different order must pick the same one.
 */
export function latestTip(tips: Iterable<string | null>): string | null {
  let latest: string | null = null
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
export function followTip(index: TreeIndex, at: string): string {
  if (index.entries[at] === undefined) return at
  // Walk DOWN from `at`: the leaves below it are the only candidates, so there
  // is no need to walk up from every leaf in the tree to find them.
  const leaves: string[] = []
  const seen = new Set<string>([at])
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
  readonly anchor: string | null
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
  readonly tipId: string | null
  /**
   * The deepest message this path shares with ANY column to its left, or null
   * when it shares none: the first column.
   * Against any column, not only the adjacent one: with the trunk, then a
   * branch off T1, then a branch off T2, the third column shares only T1 with
   * its neighbour but T2 with the trunk, and must start after T2.
   */
  readonly forkFrom: string | null
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
  /** The entries that are notes' messages (`projectSpine`). */
  notes: ReadonlySet<string> = NO_NOTES,
): ColumnView[] {
  const shown = new Set<string>()
  return columns.map(column => {
    const tipId =
      column.pinned === true || column.anchor === null
        ? column.anchor
        : followTip(index, column.anchor)
    const { spine } = projectSpine(index, tipId, notes)
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
  readonly id: string
  /** Which vertical track the row sits on. */
  readonly track: number
  /** The nearest ancestor with a row, or null at a root: the edge's other end. */
  readonly parentId: string | null
  /** That ancestor's track, or null at a root. */
  readonly parentTrack: number | null
}

/**
 * One root's tree as git-graph rows: a row per message, depth-first from
 * `root`, children in id order. Tracks start at 0 in every tree.
 *
 * The oldest child continues its parent's track; each younger child takes the
 * lowest track free at the parent's row, reserved there because its edge runs
 * down past the older subtree. A track frees where its chain ends. Intuition: a
 * branch is a new rail, the continuation is not. Non-message entries get no
 * row; their children attach to the nearest ancestor that has one.
 */
export function projectRail(
  index: TreeIndex,
  root: string,
): readonly RailRow[] {
  const visible = (id: string): boolean => {
    const entry = index.entries[id]
    return entry !== undefined && renderableMessage(entry) !== null
  }
  // Children as the rail sees them: through any non-message entry.
  const visibleChildren = (ids: readonly string[]): string[] => {
    const out: string[] = []
    const stack = ids.toReversed()
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (visible(id)) out.push(id)
      else stack.push(...(index.childrenOf.get(id) ?? []).toReversed())
    }
    return out
  }

  const busy = new Set<number>()
  const claim = (): number => {
    let t = 0
    while (busy.has(t)) t += 1
    busy.add(t)
    return t
  }

  const rows: RailRow[] = []
  // A root that is no message starts its visible children side by side.
  const starts = visibleChildren([root])
  type Visit = {
    id: string
    track: number
    parentId: string | null
    parentTrack: number | null
  }
  const stack: Visit[] = starts
    .toReversed()
    .map(id => ({ id, track: -1, parentId: null, parentTrack: null }))
  const seen = new Set<string>()
  for (let v = stack.pop(); v !== undefined; v = stack.pop()) {
    if (seen.has(v.id)) continue
    seen.add(v.id)
    // A start claims its track when it is reached, after earlier starts freed theirs.
    const track = v.track < 0 ? claim() : v.track
    rows.push({
      id: v.id,
      track,
      parentId: v.parentId,
      parentTrack: v.parentTrack,
    })
    const children = visibleChildren(index.childrenOf.get(v.id) ?? [])
    if (children.length === 0) {
      busy.delete(track)
      continue
    }
    const tracks = children.map((_, i) => (i === 0 ? track : claim()))
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const id = children[i]
      const t = tracks[i]
      if (id !== undefined && t !== undefined)
        stack.push({ id, track: t, parentId: v.id, parentTrack: track })
    }
  }
  return rows
}

interface RailItemBase {
  /** Its first row slot. Each item's is the previous item's `slot + span`. */
  readonly slot: number
  /** Rows it takes. */
  readonly span: number
  /** Its messages, top to bottom: each the only child of the one above. */
  readonly ids: readonly [string, ...string[]]
  readonly track: number
  /** The first message's parent and that parent's track: the edge into it. */
  readonly parentId: string | null
  readonly parentTrack: number | null
}

/** A message the rail draws on its own. */
export interface RailDot extends RailItemBase {
  readonly kind: "dot"
  readonly span: 1
  readonly ids: readonly [string]
}

/** A straight stretch of uneventful messages on one track, drawn as one capsule. */
export interface RailRun extends RailItemBase {
  readonly kind: "run"
  readonly stats: RunStats
}

/** What a run holds. The agent's messages are `ids.length - people`. */
export interface RunStats {
  /** Messages people wrote: every role but `assistant`. */
  readonly people: number
  /** Who wrote them, in order of first message. */
  readonly writers: readonly WriterId[]
  /** Tool calls in its messages, and how many of them failed. */
  readonly calls: number
  readonly failed: number
}

export type RailItem = RailDot | RailRun

/** The shortest stretch drawn as a run: two dots are no taller than a capsule. */
const MIN_RUN = 3

/** A run's rows: one, and one more per digit of its size (3–9 → 2, 10–99 → 3). */
export const runSpan = (size: number): number => 1 + String(size).length

/**
 * What the rail draws: `projectRail`'s rows, with each straight stretch of
 * uneventful messages drawn as one run.
 *
 * A row is uneventful when it is none of: in `keep` (what the view needs to
 * see: notes, rings, running tips, open columns' ends), the root's first
 * message, a branch's first message, a fork, or a thread end. So a run holds
 * no structure, and the compacted rail has every branch the full one has.
 * An uneventful row's only child is the next row in depth-first order, so a
 * run is a stretch of consecutive rows.
 */
export function compactRail(
  index: TreeIndex,
  rows: readonly RailRow[],
  keep: ReadonlySet<string>,
): readonly RailItem[] {
  const childRows = new Map<string, number>()
  for (const r of rows)
    if (r.parentId !== null)
      childRows.set(r.parentId, (childRows.get(r.parentId) ?? 0) + 1)
  const uneventful = (r: RailRow): boolean =>
    !keep.has(r.id) &&
    r.parentId !== null &&
    // Off its parent's track means a branch's first message: only a younger
    // child is, since the oldest keeps its parent's track (`projectRail`).
    r.track === r.parentTrack &&
    childRows.get(r.id) === 1

  const items: RailItem[] = []
  let slot = 0
  const dot = (r: RailRow) => {
    items.push({ kind: "dot", slot, span: 1, ids: [r.id], ...edge(r) })
    slot += 1
  }
  /** Row `j` carries on the stretch that row `j - 1` is in. */
  const continues = (j: number): boolean => {
    const r = rows[j]
    return r !== undefined && uneventful(r) && r.parentId === rows[j - 1]?.id
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
    if (first === undefined || stretch.length < MIN_RUN) stretch.forEach(dot)
    else {
      const span = runSpan(stretch.length)
      items.push({
        kind: "run",
        slot,
        span,
        ids: [first.id, ...more.map(r => r.id)],
        ...edge(first),
        stats: runStats(index, stretch, rows[end]?.id),
      })
      slot += span
    }
    i = end
  }
  return items
}

const edge = (r: RailRow) => ({
  track: r.track,
  parentId: r.parentId,
  parentTrack: r.parentTrack,
})

/**
 * A run's stats. Its tool results are between its messages: below each
 * member, up to the row after it, which is the next member or `after`.
 */
function runStats(
  index: TreeIndex,
  members: readonly RailRow[],
  after: string | undefined,
): RunStats {
  const between: string[] = []
  let people = 0
  const calls: ToolCallView[] = []
  for (const [k, m] of members.entries()) {
    const entry = index.entries[m.id]
    const message = entry === undefined ? null : renderableMessage(entry)
    if (message?.role !== "assistant") people += 1
    calls.push(...(message?.toolCalls ?? []))
    const next = members[k + 1]?.id ?? after
    if (next === undefined) continue
    for (
      let id = index.parentOf(next);
      id !== null && id !== m.id;
      id = index.parentOf(id)
    )
      between.push(id)
  }
  const results = resultsOn(index, between)
  return {
    people,
    writers: writersOf(
      index,
      members.map(m => m.id),
    ),
    calls: calls.length,
    failed: calls.filter(c => results.get(c.id)?.isError === true).length,
  }
}

// ── threads, lanes, and the agent ─────────────────────────────────────────

/** A lane as the reads see it. */
export interface LaneView {
  readonly name: LaneName
  readonly tip: string | null
  readonly running: boolean
  /** Messages waiting in its outbox. */
  readonly waiting: number
  /** Who the agent is answering, or who waits first: for a conflict's "by". */
  readonly askedBy: WriterId | null
}

export type ThreadLane =
  | { readonly kind: "none" }
  | ({ readonly kind: "lane" } & LaneView)

/**
 * A lane is busy while it runs or has messages waiting: a new message then
 * waits behind them, or it would jump the queue (ADR-0020).
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
    readonly mode: ChatMode
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

  let end: string
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
    end: atEntry(entryId(end)),
    lane: lane === undefined ? { kind: "none" } : { kind: "lane", ...lane },
    race: raceAlong(index, at.id, end, send.me),
  }
}

/**
 * What stopping a thread's lane does: abort its running turn; nothing when it
 * is idle (stopping is idempotent); refused for a lane that does not exist.
 * Pure.
 */
export function planStop(
  lanes: readonly LaneView[],
  lane: LaneName,
): "abort" | "idle" | "unknown" {
  const found = lanes.find(l => l.name === lane)
  return found === undefined ? "unknown" : found.running ? "abort" : "idle"
}

/**
 * Whether a message with no mention asks the agent: in a thread with a lane,
 * or from a Start Agent column. A branch is a new thread, with no lane of its
 * own yet, so only a Start Agent column makes it ask (ADR-0021).
 */
export const agentByDefault = (send: {
  readonly mode: ChatMode
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
  end: string,
  me: WriterId,
): { readonly by: WriterId } | null {
  let newest: { id: string; by: WriterId } | null = null
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
  readonly tip: string
}

/**
 * Every lane the agent is replying on. Threads have their own lanes, so
 * several can run at once; an empty list is an idle agent.
 */
export function agentActivity(
  running: readonly { readonly lane: LaneName; readonly tip: string | null }[],
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
  readonly forks: ReadonlyMap<string, readonly number[]>
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
  const forks = new Map<string, number[]>()
  for (const [i, c] of columns.entries()) {
    if (c.forkFrom === null) continue
    const t = track[i] ?? PENDING_TRACK
    const at = forks.get(c.forkFrom)
    if (at === undefined) forks.set(c.forkFrom, [t])
    else at.push(t)
  }
  return { track, forks }
}
