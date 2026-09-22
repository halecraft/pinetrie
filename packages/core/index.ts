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
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

export interface TurnState {
  readonly busy: boolean
  readonly ready: boolean
}

export interface InboundCommand {
  readonly id?: string
  readonly kind?: string
  readonly text?: string
}

export type CommandDecision =
  | { kind: "run"; runId: string; text: string; next: TurnState }
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

  if (command?.kind !== "prompt") {
    return reject(
      ERR.UNKNOWN_KIND,
      `unsupported command kind: ${String(command?.kind)}`,
    )
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
  return { kind: "run", runId, text, next: { ...state, busy: true } }
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
  readonly parentId?: string | null
  readonly type?: string
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
    .filter(e => e.type === "message")
    .map(e => ({
      id: e.id,
      role: e.message?.role ?? "unknown",
      text: messageText(e.message),
    }))
    .filter(m => m.role === "user" || m.role === "assistant")
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
