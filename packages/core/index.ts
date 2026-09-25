// core — PURE. No I/O. No imports. Property-testable.
//
// FC/IS (gather -> plan -> execute): everything here is `plan`. A decision is a
// VALUE; the shell in host/ performs it. This mirrors pi's own lane loop
// (pi-agent-core/dist/harness/runtime/lane.js:200):
//
//     const decision = await plan(this.state, mutator);
//     ... const commit = await mutator.commit(decision.writes, context);
//     this.state = decision.next;
//
// Nothing in this file may import pi, Kyneta, or a Node builtin.

// --- branded identifiers ----------------------------------------------------
//
// Several ADRs are constraints a type system can hold. Branding them moves the
// check from a runtime assertion in e2e/ to a compile error at the call site.
//
// A brand prevents MIX-UPS where a value is created and passed around. It does
// nothing about serialization, which is why a `LocalSeq` brand was deleted:
// its risk was a seq reaching the wire, and a branded number drops into any
// `number` field. These brands guard against swapped arguments, which is what
// brands are for.

declare const laneNameBrand: unique symbol
/**
 * A lane name that carries writer identity (ADR-0011). Only
 * `laneNameForWriter()` can mint one, so `"main"` is not assignable.
 */
export type LaneName = string & { readonly [laneNameBrand]: true }

declare const entryIdBrand: unique symbol
declare const runIdBrand: unique symbol
declare const referenceIdBrand: unique symbol
/**
 * Entry ids and run ids are both uuidv7 strings and cannot be told apart at
 * runtime. Navigation takes an entry id; `activeRuns` and `pendingText` are
 * keyed by run id. Passing one where the other belongs would otherwise
 * compile, run, and fail silently. Mint them only at the edges: the protocol
 * codec, the document readers, and the host's id generator.
 */
export type EntryId = string & { readonly [entryIdBrand]: true }
export type RunId = string & { readonly [runIdBrand]: true }
export const entryId = (id: string): EntryId => id as EntryId
export const runId = (id: string): RunId => id as RunId
/** A reference's id: the key of its stored value, so it must be unique (ADR-0016). */
export type ReferenceId = string & { readonly [referenceIdBrand]: true }
export const referenceId = (id: string): ReferenceId => id as ReferenceId

// --- positions --------------------------------------------------------------

/**
 * A point in the tree: the root, or a specific entry.
 *
 * pi's API spells this `string | null`, and the wire spells it `""`. Both are
 * converted to a `Position` at the edge they arrive from, so decision logic
 * never has to guess whether `null` means "the root" or "absent".
 */
export type Position =
  | { readonly kind: "root" }
  | { readonly kind: "entry"; readonly id: EntryId }

export const ROOT: Position = { kind: "root" }

/**
 * Where a turn attaches: the writer's own lane tip, or a named position.
 * `"tip"` is its own variant because pi reads `null` as the ROOT, so a
 * nullable "no position given" would be one refactor away from meaning root.
 */
export type Target = { readonly kind: "tip" } | Position
export const atEntry = (id: EntryId): Position => ({ kind: "entry", id })

export function samePosition(a: Position, b: Position): boolean {
  return a.kind === "root"
    ? b.kind === "root"
    : b.kind === "entry" && a.id === b.id
}

// --- command admission ------------------------------------------------------

/** Error codes the host may return. Kept here so both sides agree without I/O. */
export const ERR = {
  UNKNOWN_KIND: "unknown_kind",
  EMPTY_PROMPT: "empty_prompt",
  BUSY: "busy",
  NOT_READY: "not_ready",
  /** A branch named no parent to fork from. */
  NO_PARENT: "no_parent",
  /** pi refused the target: it is not in this conversation. */
  UNKNOWN_TARGET: "unknown_target",
  /** pi refused the navigation as invalid. */
  INVALID_NAVIGATION: "invalid_navigation",
  /** pi refused for a reason with no more specific code here. */
  REFUSED: "refused",
  /** A reference needs an entry to attach at, and this writer has none. */
  NO_LANE: "no_lane",
  /** A span is empty, out of bounds, or on an entry with no text. */
  INVALID_SPAN: "invalid_span",
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

export interface TurnState {
  readonly busy: boolean
  readonly ready: boolean
}

/**
 * A command whose SHAPE is already known to be valid. The protocol codec
 * produces it; it owns every shape rule (a kind we know, non-empty text, a
 * named parent), so this type cannot express a malformed command.
 */
/** What a reference points at. Spans are UTF-16 code units into messageText. */
export type ReferenceTarget =
  | { readonly kind: "entry"; readonly id: EntryId }
  | {
      readonly kind: "span"
      readonly id: EntryId
      readonly start: number
      readonly end: number
    }

export type Intent =
  | { readonly kind: "reference"; readonly to: ReferenceTarget }
  | { readonly kind: "prompt"; readonly text: string }
  | { readonly kind: "branch"; readonly text: string; readonly from: EntryId }
  | { readonly kind: "navigate"; readonly to: Position }

export type CommandDecision =
  /**
   * A branch is a run with a different attachment point, so there is ONE run
   * decision. `from` says where the turn attaches: the lane's own tip for a
   * prompt, or a position for a branch. It replaces a `parentId` whose `null`
   * meant "the tip", which pi's `navigateTree(null)` reads as "the root".
   */
  | {
      kind: "run"
      runId: RunId
      text: string
      from: Target
      next: TurnState
    }
  /**
   * Moving the lane tip is NOT a run: no run id, no stream, no turn, and the
   * lane does not become busy.
   */
  | { kind: "navigate"; to: Position; next: TurnState }
  /**
   * A citation. Not a run and not a move: it writes one value. Refused while
   * the author's turn runs, because it is attached at the lane tip, and a tip
   * that moves mid-turn makes "where was this attached" ambiguous.
   */
  | { kind: "reference"; to: ReferenceTarget; next: TurnState }
  | { kind: "reject"; code: ErrCode; message: string; next: TurnState }

/**
 * Decide what to do with a well-formed intent, given ONE writer's turn state.
 *
 * Only state policy lives here: ready and busy. Shape rules belong to the
 * protocol codec. Each writer has their own `TurnState` (ADR-0011), so one
 * writer's running turn never makes another writer busy.
 */
export function planCommand(
  state: TurnState,
  intent: Intent,
  newRunId: RunId,
): CommandDecision {
  if (!state.ready) {
    return {
      kind: "reject",
      code: ERR.NOT_READY,
      message: "host is not ready",
      next: state,
    }
  }
  // A navigation is refused mid-turn too: moving the tip underneath a running
  // turn would decide where its entries land.
  if (state.busy) {
    return {
      kind: "reject",
      code: ERR.BUSY,
      message: "your turn is already running",
      next: state,
    }
  }
  switch (intent.kind) {
    case "navigate":
      return { kind: "navigate", to: intent.to, next: state }
    case "reference":
      return { kind: "reference", to: intent.to, next: state }
    case "prompt":
      return {
        kind: "run",
        runId: newRunId,
        text: intent.text,
        from: { kind: "tip" },
        next: { ...state, busy: true },
      }
    case "branch":
      return {
        kind: "run",
        runId: newRunId,
        text: intent.text,
        from: atEntry(intent.from),
        next: { ...state, busy: true },
      }
  }
}

/** Pure state transition for turn completion. */
export function turnFinished(state: TurnState): TurnState {
  return { ...state, busy: false }
}

// --- attaching a writer's lane ----------------------------------------------

/** Where this writer's lane is, including that it may not exist yet. */
export type WriterLaneState =
  | { readonly kind: "none" }
  | { readonly kind: "lane"; readonly at: Position }

/** What the shell must do so the writer's lane is at `target`. */
export type Attach =
  | { readonly kind: "create"; readonly at: Position }
  | { readonly kind: "navigate"; readonly to: Position }
  | { readonly kind: "stay" }

/**
 * Decide how to put a writer's lane at `target`.
 *
 * `"stay"` exists because pi refuses to navigate a lane to its current tip
 * (`InvalidNavigation`, reason `current_tip`). "Already there" is a value to
 * act on, not an error to catch. `create` and `navigate` are exclusive: a new
 * lane is created where it is wanted, never created and then moved.
 */
export function planAttach(lane: WriterLaneState, target: Target): Attach {
  if (target.kind === "tip") {
    // Your own tip: a writer with no lane yet starts one at the root, which
    // is what a brand-new session did before lanes were per writer.
    return lane.kind === "none"
      ? { kind: "create", at: ROOT }
      : { kind: "stay" }
  }
  switch (lane.kind) {
    case "none":
      return { kind: "create", at: target }
    case "lane":
      return samePosition(lane.at, target)
        ? { kind: "stay" }
        : { kind: "navigate", to: target }
  }
}

// --- lane naming (ADR-0011) -------------------------------------------------

/**
 * The lane name carries WRITER identity. Never "main": a shared lane name makes
 * `pi.branch.tip`, `pi.lane.state` and `pi.lane.config` contended LWW registers,
 * and a clobber silently orphans a whole turn.
 *
 * This is the ONLY way to produce a `LaneName`.
 */
export function laneNameForWriter(peerId: string): LaneName {
  if (typeof peerId !== "string" || peerId.length === 0) {
    throw new Error("laneNameForWriter: peerId must be a non-empty string")
  }
  if (peerId.includes("\u0000")) {
    // pi's assertValidBranchName rejects \u0000; fail here rather than there.
    throw new Error("laneNameForWriter: peerId must not contain \\u0000")
  }
  return `w-${peerId}` as LaneName
}

// --- wire hygiene (ADR-0013) ------------------------------------------------

/**
 * Returns the paths at which a `seq` key appears, so a test can assert none do.
 *
 * Where this does real work: STORED ENTRIES. The doc types them
 * `Schema.record(Schema.any())`, so any shape at all can be written and
 * nothing strips a stray key. Proven: writing `{ ...entry, seq: 99 }` makes
 * the e2e stored-seq check FAIL.
 *
 * Where it does NOT: LINE MESSAGES. `packages/protocol/line.ts` declares Command and
 * Reply as `Schema.struct({...})`, and Kyneta encodes only declared fields, so
 * an undeclared `seq` is dropped at the boundary. Proven: a reply sent as
 * `{ ...reply, seq: 1 }` arrives without it, and the e2e wire-seq check still
 * passes. That check is kept for the case the struct itself grows a `seq`, but
 * it is NOT what keeps seq off the wire — the struct is.
 *
 * A deleted `LocalSeq` brand used to be credited with this. It could never
 * have worked: brands constrain how a value is CREATED, while the risk for seq
 * is how it is SERIALIZED, and a branded number drops into any `number` field
 * with no error. Contrast `LaneName`, where creation IS the danger (ADR-0011)
 * and the brand therefore does real work.
 */
export function findSeqKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = []
  if (value === null || typeof value !== "object") return hits
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      hits.push(...findSeqKeys(v, `${path}[${i}]`))
    })
    return hits
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "seq") hits.push(`${path}.${k}`)
    hits.push(...findSeqKeys(v, `${path}.${k}`))
  }
  return hits
}

// --- transcript projection --------------------------------------------------

export interface MessagePart {
  readonly type?: string
  readonly text?: string
}

export interface AgentMessageLike {
  readonly role?: string
  readonly content?: string | readonly MessagePart[]
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
}

/**
 * Project raw session-doc entries into an ordered transcript for rendering.
 *
 * Order comes from the `parentId` walk, NOT from seq (ADR-0013: "Nothing may
 * render by seq order"). We walk from the tip back to the root and reverse.
 * Note the signature cannot even accept a seq — ordering is structural.
 */
export function projectTranscript(
  entries: Readonly<Record<string, EntryLike>>,
  tipId: string | null,
): TranscriptMessage[] {
  const out: EntryLike[] = []
  let id: string | null = tipId
  const guard = new Set<string>()
  while (id != null) {
    const entry = entries[id]
    if (entry === undefined) break
    if (guard.has(id)) throw new Error(`cycle in parentId chain at ${id}`)
    guard.add(id)
    out.push(entry)
    id = entry.parentId ?? null
  }
  out.reverse()
  return out
    .map(renderableMessage)
    .filter((m): m is TranscriptMessage => m !== null)
}

/**
 * One entry -> the message a reader sees, or `null` if it is not one.
 *
 * Shared by `projectTranscript` and `projectSpine` so the two cannot disagree
 * about which entries are messages. Non-message entries and roles other than
 * user/assistant are dropped.
 */
function renderableMessage(entry: EntryLike): TranscriptMessage | null {
  if (entry.type !== "message") return null
  const role = entry.message?.role ?? "unknown"
  if (role !== "user" && role !== "assistant") return null
  return { id: entry.id, role, text: messageText(entry.message) }
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

// --- environment gate -------------------------------------------------------

/** Compare dotted numeric versions. -1 | 0 | 1 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = String(a)
    .split(".")
    .map(n => Number.parseInt(n, 10) || 0)
  const pb = String(b)
    .split(".")
    .map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export const LORO_FLOOR = "1.13.4"

export interface EnvironmentReport {
  readonly ok: boolean
  readonly problems: readonly string[]
}

/**
 * Deterministic build guards, preferred over a stopwatch (roadmap "Invariants").
 * `stepInPlace` is absent from the published @kyneta/schema 3.0.0, so its
 * presence proves we are on the fixed local build.
 */
export function checkEnvironment({
  hasStepInPlace,
  loroVersion,
}: {
  hasStepInPlace: boolean
  loroVersion: string
}): EnvironmentReport {
  const problems: string[] = []
  if (hasStepInPlace !== true) {
    problems.push(
      "@kyneta/schema does not export stepInPlace — stale (published 3.0.0) build",
    )
  }
  if (compareVersions(loroVersion, LORO_FLOOR) < 0) {
    problems.push(`loro-crdt ${loroVersion} is below the ${LORO_FLOOR} floor`)
  }
  return { ok: problems.length === 0, problems }
}

// ── arrival ordering (ADR-0013) ───────────────────────────────────────────

export interface EntryOrdering {
  /** Ids in the order they should receive their arrival seq. */
  readonly ordered: readonly string[]
  /**
   * Candidates whose parent edge could not be satisfied from the already-
   * sequenced set or from this batch — a cycle, or an edge pointing outside
   * both. Returned rather than thrown so the caller can decide: the storage
   * adapter retries once with a full scan before giving up, because causal
   * delivery should make this impossible and a silent drop would be worse
   * than either.
   */
  readonly unresolved: readonly string[]
}

/**
 * Order a batch of newly-arrived entries: parents before children, with the
 * smallest id winning any tie.
 *
 * This is the derivation behind the arrival seq, and it is pure so the claim
 * ADR-0013 actually rests on can be *tested* rather than asserted: the result
 * must not depend on the order the candidates arrive in. Two replicas seeing
 * the same delta in different orders must assign the same sequence, or stable
 * cursors silently skip entries.
 *
 * `parentOf` returns `null`/`undefined` for a root, for an entry absent from
 * the document, or for a parent already sequenced — all of which make the
 * candidate immediately ready.
 */
export function orderNewEntries(
  candidates: Iterable<string>,
  parentOf: (id: string) => string | null | undefined,
): EntryOrdering {
  const pending = new Set(candidates)
  const children = new Map<string, string[]>()
  const queue: string[] = []

  for (const id of pending) {
    const parent = parentOf(id)
    if (parent === null || parent === undefined || !pending.has(parent)) {
      queue.push(id)
      continue
    }
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [id])
    else siblings.push(id)
  }

  // Kahn, popping the smallest available id each round. Sorting the frontier
  // — not the input — is what makes the result permutation-invariant.
  const ordered: string[] = []
  while (queue.length > 0) {
    queue.sort()
    const id = queue.shift()
    if (id === undefined || !pending.has(id)) continue
    pending.delete(id)
    ordered.push(id)
    for (const child of children.get(id) ?? []) queue.push(child)
  }

  return { ordered, unresolved: [...pending] }
}

// ── the spine (roadmap step 1) ────────────────────────────────────────────

/** A branch departing the spine at some node. */
export interface BranchSummary {
  /** The child entry that leaves the spine. */
  readonly rootId: string
  /** Deepest descendant, so "read" can re-root the spine there. */
  readonly tipId: string
  /** Messages in the whole subtree, for the collapsed summary line. */
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
 * The tip path, plus the branches that leave it.
 *
 * `projectTranscript` answers "what will the model see" and returns the path
 * alone. This answers "what exists around that path": the same nodes, each
 * carrying the children that are NOT on it. The difference between the two is
 * the product — an Aside is an entry that exists without being in context.
 *
 * Deliberately not a generic tree. Almost every node has one child, so an
 * n-ary tree would be an intermediate structure the UI discards; the UI renders
 * a linear spine with branches hanging off it. Build the shape you render.
 */
export function projectSpine(
  entries: Readonly<Record<string, EntryLike>>,
  tipId: string | null,
): SpineProjection {
  const childrenOf = new Map<string, string[]>()
  const orphans: string[] = []
  for (const [id, entry] of Object.entries(entries)) {
    const parent = entry.parentId
    if (parent === null || parent === undefined) continue
    if (entries[parent] === undefined) {
      orphans.push(id)
      continue
    }
    const siblings = childrenOf.get(parent)
    if (siblings === undefined) childrenOf.set(parent, [id])
    else siblings.push(id)
  }

  // Walk tip -> root, the same direction and cycle rule as projectTranscript,
  // but reporting a cycle instead of throwing: a renderer must still draw the
  // part of the tree that is sound.
  const path: string[] = []
  const cycles: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = tipId
  while (cursor !== null) {
    const entry: EntryLike | undefined = entries[cursor]
    if (entry === undefined) break
    if (seen.has(cursor)) {
      cycles.push(cursor)
      break
    }
    seen.add(cursor)
    path.push(cursor)
    cursor = entry.parentId ?? null
  }
  path.reverse()

  const onSpine = new Set(path)
  const spine: SpineNode[] = []
  for (const [index, id] of path.entries()) {
    const entry = entries[id]
    if (entry === undefined) continue
    const message = renderableMessage(entry)
    if (message === null) continue
    const next = path[index + 1]
    const branches = (childrenOf.get(id) ?? [])
      .filter(child => child !== next && !onSpine.has(child))
      // Ascending id is ascending creation time (uuidv7, S9). Sorting the
      // ids — not relying on iteration order — is what makes two replicas
      // draw the same picture.
      .sort()
      .map(rootId => summarizeBranch(entries, childrenOf, rootId))
    spine.push({ ...message, branches })
  }

  return { spine, orphans, cycles }
}

/** Walk a branch subtree once: count its messages, find its deepest node. */
function summarizeBranch(
  entries: Readonly<Record<string, EntryLike>>,
  childrenOf: ReadonlyMap<string, readonly string[]>,
  rootId: string,
): BranchSummary {
  let messageCount = 0
  let tipId = rootId
  let deepest = -1
  const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === undefined || visited.has(node.id)) continue
    visited.add(node.id)
    if (entries[node.id]?.type === "message") messageCount += 1
    // Deepest wins; ascending id breaks a tie, so "read" is deterministic.
    if (node.depth > deepest || (node.depth === deepest && node.id < tipId)) {
      deepest = node.depth
      tipId = node.id
    }
    for (const child of childrenOf.get(node.id) ?? [])
      stack.push({ id: child, depth: node.depth + 1 })
  }
  return { rootId, tipId, messageCount }
}

// ── the default view ──────────────────────────────────────────────────────

/**
 * The most recently advanced tip among `tips`, or null if none has one.
 *
 * A window that joins a live session has no lane of its own, so it views the
 * lane whose tip is newest. Entry ids are uuidv7, so the greatest id is the
 * newest (S9). Chosen by comparing ids, never by position in `tips`: two
 * clients reading the same document in a different order must pick the same
 * lane, or one of them branches from a stale point without noticing.
 */
export function latestTip(tips: Iterable<string | null>): string | null {
  let latest: string | null = null
  for (const tip of tips) {
    if (tip !== null && (latest === null || tip > latest)) latest = tip
  }
  return latest
}
