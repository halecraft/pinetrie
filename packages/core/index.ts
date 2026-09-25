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

declare const laneNameBrand: unique symbol
/**
 * A lane name that carries writer identity (ADR-0011). Only
 * `laneNameForWriter()` can mint one, so `"main"` is not assignable.
 */
export type LaneName = string & { readonly [laneNameBrand]: true }

// --- command admission ------------------------------------------------------

/** Error codes the host may return. Kept here so both sides agree without I/O. */
export const ERR = {
  UNKNOWN_KIND: "unknown_kind",
  EMPTY_PROMPT: "empty_prompt",
  BUSY: "busy",
  NOT_READY: "not_ready",
  /** A branch named no parent to fork from. */
  NO_PARENT: "no_parent",
  /** pi refused the navigation: the target is not in this conversation. */
  UNKNOWN_TARGET: "unknown_target",
  /** pi refused the navigation as invalid, e.g. a cycle. */
  INVALID_NAVIGATION: "invalid_navigation",
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

export interface TurnState {
  readonly busy: boolean
  readonly ready: boolean
}

export interface InboundCommand {
  /** Set only for a branch: the entry to fork from. */
  readonly parentId?: string
  readonly id?: string
  readonly kind?: string
  readonly text?: string
}

export type CommandDecision =
  /**
   * A branch is a run with a different attachment point, so there is ONE run
   * decision rather than two. `parentId` null means "append at the lane tip";
   * a string means "navigate there first". Two command kinds in, one decision
   * out: the validation differs, the execution does not.
   */
  | {
      kind: "run"
      runId: string
      text: string
      parentId: string | null
      next: TurnState
    }
  | { kind: "reject"; code: ErrCode; message: string; next: TurnState }

/** Decide what to do with an inbound command. Pure: (state, command) -> decision. */
export function planCommand(
  state: TurnState,
  command: InboundCommand | null | undefined,
  runId: string,
): CommandDecision {
  const reject = (code: ErrCode, message: string): CommandDecision => ({
    kind: "reject",
    code,
    message,
    next: state,
  })

  if (command === null || command === undefined) {
    return reject(ERR.UNKNOWN_KIND, "no command")
  }
  const kind = command.kind
  if (kind !== "prompt" && kind !== "branch") {
    return reject(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(kind)}`)
  }
  if (!state.ready) {
    return reject(ERR.NOT_READY, "host is not ready")
  }
  const text = typeof command.text === "string" ? command.text.trim() : ""
  if (text.length === 0) {
    return reject(ERR.EMPTY_PROMPT, "prompt text is empty")
  }
  if (state.busy) {
    // The skeleton runs one turn at a time. Concurrency is out of scope.
    return reject(ERR.BUSY, "a turn is already running")
  }
  // Validated last, so a branch with an empty prompt is still reported as an
  // empty prompt rather than as a missing parent.
  const parentId = kind === "branch" ? (command.parentId ?? "").trim() : ""
  if (kind === "branch" && parentId.length === 0) {
    return reject(ERR.NO_PARENT, "a branch must name a parent entry")
  }

  return {
    kind: "run",
    runId,
    text,
    parentId: kind === "branch" ? parentId : null,
    next: { ...state, busy: true },
  }
}

/** Pure state transition for turn completion. */
export function turnFinished(state: TurnState): TurnState {
  return { ...state, busy: false }
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
 * Where it does NOT: LINE MESSAGES. `protocol/line.ts` declares Command and
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
