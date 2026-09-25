// core — PURE. No I/O. Imports nothing but its own modules. Property-testable.
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

declare const agentIdBrand: unique symbol
/** An agent that can be compelled to reply. The host has exactly one for now. */
export type AgentId = string & { readonly [agentIdBrand]: true }
/** The host's agent, addressed as `@agent`. */
export const THE_AGENT = "agent" as AgentId

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

/**
 * Where a human message attaches: the sender's own tip, or an entry. Never an
 * explicit root, which the wire could not tell apart from "tip"; a writer
 * with no lane yet still reaches the root through "tip", as a first prompt does.
 */
export type ChatAt =
  | { readonly kind: "tip" }
  | { readonly kind: "entry"; readonly id: EntryId }
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
  /** A display name is empty or too long. */
  INVALID_NAME: "invalid_name",
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
/** What a reference points at. Spans are UTF-16 code units into `entryText`. */
export type ReferenceTarget =
  | { readonly kind: "entry"; readonly id: EntryId }
  | {
      readonly kind: "span"
      readonly id: EntryId
      readonly start: number
      readonly end: number
    }

export type Intent =
  /** A citation, attached where its author is reading (`at`). */
  | {
      readonly kind: "reference"
      readonly to: ReferenceTarget
      readonly at: ChatAt
    }
  /**
   * A human message. `at` is where its author is viewing; `mentions` are
   * parsed from `text` by `parseMentions`, once, at the codec.
   */
  | {
      readonly kind: "chat"
      readonly text: string
      readonly at: ChatAt
      readonly mentions: readonly Mention[]
    }
  /** Set the sender's display name: a label, never an identity. */
  | { readonly kind: "name"; readonly name: string }
  /** Set who is compelled by default in the thread rooted at `at`. */
  | {
      readonly kind: "thread"
      readonly at: EntryId
      readonly compels: Responder
    }
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
   * the author's turn runs: `at` may be the author's tip, and a tip that moves
   * mid-turn makes "where was this attached" ambiguous.
   */
  | { kind: "reference"; to: ReferenceTarget; at: ChatAt; next: TurnState }
  /**
   * A human message. Where it goes and whether the agent runs are decided by
   * `planChat` in `@pineta/marginalia`, which needs the agent's lane too.
   */
  | {
      kind: "chat"
      text: string
      at: ChatAt
      mentions: readonly Mention[]
      next: TurnState
    }
  | { kind: "name"; name: string; next: TurnState }
  | { kind: "thread"; at: EntryId; compels: Responder; next: TurnState }
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
      return { kind: "reference", to: intent.to, at: intent.at, next: state }
    case "chat":
      return {
        kind: "chat",
        text: intent.text,
        at: intent.at,
        mentions: intent.mentions,
        next: state,
      }
    case "name":
      return { kind: "name", name: intent.name, next: state }
    case "thread":
      return {
        kind: "thread",
        at: intent.at,
        compels: intent.compels,
        next: state,
      }
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

/**
 * An agent's lane. The `a-` prefix keeps it apart from every writer's `w-`
 * lane: a client chooses its own peer id, so a client calling itself "agent"
 * must not be able to drive the agent's lane.
 */
export const laneNameForAgent = (agent: AgentId): LaneName =>
  `a-${agent}` as LaneName

// --- obligation: collaborators and compelled responders ----------------------

/**
 * An `@` in a message. Mentioning the agent COMPELS it to reply; mentioning a
 * person only notifies them, because nobody can make a human answer.
 */
export type Mention =
  | { readonly kind: "agent"; readonly agent: AgentId }
  | { readonly kind: "person"; readonly name: string }

/**
 * Who must answer a message. Only an agent can be compelled, so this type has
 * no way to say "compel a person".
 */
export type Responder =
  | { readonly kind: "none" }
  | { readonly kind: "agent"; readonly agent: AgentId }

export const NOBODY: Responder = { kind: "none" }

/**
 * Every `@handle` in `text`, in order, without repeats. `@agent` is the agent;
 * any other handle is a person. A handle starts a word, so an e-mail address is
 * not a mention.
 */
export function parseMentions(text: string): Mention[] {
  const seen = new Set<string>()
  const out: Mention[] = []
  for (const [, handle] of text.matchAll(/(?<![\w@])@([A-Za-z0-9_-]+)/g)) {
    if (handle === undefined || seen.has(handle)) continue
    seen.add(handle)
    out.push(
      handle === THE_AGENT
        ? { kind: "agent", agent: THE_AGENT }
        : { kind: "person", name: handle },
    )
  }
  return out
}

/**
 * Who is compelled to answer: the agent if it is mentioned, otherwise the
 * thread's default. A mention can add an obligation but never remove one, so
 * in a working session a message that mentions only people still runs.
 */
export function compelledResponder(input: {
  readonly mentions: readonly Mention[]
  readonly threadDefault: Responder
}): Responder {
  const agent = input.mentions.find(m => m.kind === "agent")
  return agent === undefined
    ? input.threadDefault
    : { kind: "agent", agent: agent.agent }
}

/** A display name's longest form, in UTF-16 code units. */
export const MAX_NAME_LENGTH = 40

/** A display name as typed -> the stored one, or undefined if unusable. */
export function normalizeName(name: string): string | undefined {
  const n = name.trim()
  return n.length === 0 || n.length > MAX_NAME_LENGTH ? undefined : n
}

/**
 * Where a message attaches, as a position another lane can use. A writer's
 * `"tip"` means nothing to the agent's lane, so it is resolved against the
 * writer's lane first: no lane yet means the root, as for a first prompt.
 */
export function resolveTarget(lane: WriterLaneState, at: Target): Position {
  if (at.kind !== "tip") return at
  return lane.kind === "none" ? ROOT : lane.at
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

// ── the tree ──────────────────────────────────────────────────────────────

export * from "./tree.ts"
