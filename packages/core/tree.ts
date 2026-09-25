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

import {
  atEntry,
  entryId,
  type LaneName,
  type Position,
  ROOT,
  type WriterId,
} from "./index.ts"

// ── entries and messages ──────────────────────────────────────────────────

export interface MessagePart {
  readonly type?: string
  readonly text?: string
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
 * and chat are dropped. A `chat` message is a human's, already decoded by the
 * reader (`readRenderableEntries` in `packages/client`); core only admits the
 * role, so it needs no schema library.
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
    }
  }
  if (role !== "user" && role !== "assistant") return null
  return { id: entry.id, role, text: messageText(entry.message) }
}

// ── the index ─────────────────────────────────────────────────────────────

export interface TreeIndex {
  readonly entries: Readonly<Record<string, EntryLike>>
  /** Children of each entry, ascending by id (creation order, S9). */
  readonly childrenOf: ReadonlyMap<string, readonly string[]>
  /** An entry's parent id as stored; null for a root. */
  readonly parentOf: (id: string) => string | null
  /** Entries with no parent: one per fresh conversation. Ascending by id. */
  readonly roots: readonly string[]
  /** Entries whose parent is absent from the set. Never dropped. Ascending. */
  readonly orphans: readonly string[]
  /** Entries with no children. Ascending by id. */
  readonly leaves: readonly string[]
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
  for (const [id, entry] of Object.entries(entries)) {
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
    leaves: Object.keys(entries)
      .filter(id => !childrenOf.has(id))
      .sort(ascending),
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

/** The ids on the path to `tip`. */
export const pathIds = (
  index: TreeIndex,
  tip: string | null,
): ReadonlySet<string> => new Set(ancestry(index, tip).path)

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
}

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
): SpineProjection {
  const { path: upward, cycleAt } = ancestry(index, tipId)
  const path = upward.toReversed()
  const onSpine = new Set(path)
  const spine: SpineNode[] = []
  for (const [i, id] of path.entries()) {
    const entry = index.entries[id]
    const message = entry === undefined ? null : renderableMessage(entry)
    if (message === null) continue
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

function summarizeBranch(index: TreeIndex, rootId: string): BranchSummary {
  let messageCount = 0
  const stack = [rootId]
  const visited = new Set<string>()
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (visited.has(id)) continue
    visited.add(id)
    if (index.entries[id]?.type === "message") messageCount += 1
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
 * jumps to it. `at` null is the root, below which everything lies.
 *
 * Leaves, not lane tips: a conversation thread has no lane at all (ADR-0020),
 * so a thread's end is its newest leaf, whoever wrote it.
 *
 * `exclude` is for a fresh branch: children of `at` that already existed when
 * it opened. Only leaves reached through a NEW child count, so the column stays
 * at `at` until the branch's first message exists, then follows it.
 */
export function followTip(
  index: TreeIndex,
  at: string | null,
  exclude?: readonly string[],
): string | null {
  if (at === null) return latestTip(index.leaves)
  if (index.entries[at] === undefined) return at
  // Walk DOWN from `at`: the leaves below it are the only candidates, so there
  // is no need to walk up from every leaf in the tree to find them.
  const skip = new Set(exclude)
  const leaves: string[] = []
  const seen = new Set<string>([at])
  const stack = (index.childrenOf.get(at) ?? []).filter(c => !skip.has(c))
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    const children = index.childrenOf.get(id) ?? []
    if (children.length === 0) leaves.push(id)
    else stack.push(...children)
  }
  return latestTip([at, ...leaves])
}

// ── columns: open paths, side by side ─────────────────────────────────────

export interface ColumnSpec {
  /** The entry the column follows from; null follows the newest leaf overall. */
  readonly anchor: string | null
  /** A fresh branch's pre-existing children of `anchor` (see `followTip`). */
  readonly exclude?: readonly string[]
}

export interface ColumnView {
  /** Where this column's path ends: `followTip(anchor, exclude)`. */
  readonly tipId: string | null
  /**
   * The deepest message this path shares with ANY column to its left, or null
   * when it shares none: the first column, or a column on another root.
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
): ColumnView[] {
  const shown = new Set<string>()
  return columns.map(column => {
    const tipId = followTip(index, column.anchor, column.exclude)
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

// ── the rail: the whole tree's shape ──────────────────────────────────────

export interface RailRow {
  readonly id: string
  /** Which vertical track the dot sits on. */
  readonly track: number
  /** The nearest ancestor with a row, or null at a root: the edge's other end. */
  readonly parentId: string | null
  /** That ancestor's track, or null at a root. */
  readonly parentTrack: number | null
}

/**
 * The tree as git-graph rows: a dot per message, depth-first from each root in
 * id order, children in id order.
 *
 * The oldest child continues its parent's track; each younger child takes the
 * lowest track free at the parent's row, reserved there because its edge runs
 * down past the older subtree. A track frees where its chain ends. Intuition: a
 * branch is a new rail, the continuation is not. Non-message entries get no
 * row; their children attach to the nearest ancestor that has one.
 */
export function projectRail(index: TreeIndex): readonly RailRow[] {
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
  const starts = visibleChildren(
    [...index.roots, ...index.orphans].sort(ascending),
  )
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
    // A root claims its track when it is reached, after earlier trees freed theirs.
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

// ── threads, lanes, and the agent ─────────────────────────────────────────

/**
 * Where a message sent at `at` lands: at the root, a new conversation, so the
 * root itself; otherwise the end of the thread below `at` (`followTip`). The
 * root is never followed: that would join whatever thread happens to be newest.
 */
export function threadEnd(index: TreeIndex, at: Position): Position {
  if (at.kind === "root") return ROOT
  const end = followTip(index, at.id)
  return end === null ? at : atEntry(entryId(end))
}

/**
 * Whether another writer took the slot below `at`: the newest compelled
 * message below it by someone other than `me`. A plain remark and an agent
 * reply are not a race: a compelled message simply goes after them. Pure.
 */
export function raceSince(
  index: TreeIndex,
  at: Position,
  me: WriterId,
): { readonly by: WriterId } | null {
  if (at.kind === "root") return null
  let newest: { id: string; by: WriterId } | null = null
  const seen = new Set<string>([at.id])
  const stack = [...(index.childrenOf.get(at.id) ?? [])]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    const m = index.entries[id]?.message
    if (
      m?.role === "chat" &&
      m.compelled === true &&
      m.writer !== undefined &&
      m.writer !== me &&
      (newest === null || id > newest.id)
    )
      newest = { id, by: m.writer }
    stack.push(...(index.childrenOf.get(id) ?? []))
  }
  return newest === null ? null : { by: newest.by }
}

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
 * The lane whose tip is `end`. A lane's tip is always its thread's end
 * (ADR-0020), so the end names the thread's lane with no stored mapping. The
 * root never has a thread lane: a message there starts a new conversation.
 */
export function threadLaneAt(
  lanes: readonly LaneView[],
  end: Position,
): ThreadLane {
  if (end.kind === "root") return { kind: "none" }
  const lane = lanes.find(l => l.tip === end.id)
  return lane === undefined ? { kind: "none" } : { kind: "lane", ...lane }
}

/** One lane the agent is replying on: where, and what it reads. */
export interface AgentRun {
  readonly lane: LaneName
  /** The lane's tip: the message it is answering, then its reply. */
  readonly tip: string
  /** What it reads: the path to `tip`. */
  readonly path: ReadonlySet<string>
}

/**
 * Every lane the agent is replying on. Threads have their own lanes, so
 * several can run at once; an empty list is an idle agent.
 */
export function agentActivity(
  index: TreeIndex,
  running: readonly { readonly lane: LaneName; readonly tip: string | null }[],
): readonly AgentRun[] {
  return running.flatMap(r =>
    r.tip === null
      ? []
      : [{ lane: r.lane, tip: r.tip, path: pathIds(index, r.tip) }],
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
