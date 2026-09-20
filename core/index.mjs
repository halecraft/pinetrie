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

// --- command admission ------------------------------------------------------

/** Error codes the host may return. Kept here so both sides agree without I/O. */
export const ERR = {
  UNKNOWN_KIND: "unknown_kind",
  EMPTY_PROMPT: "empty_prompt",
  BUSY: "busy",
  NOT_READY: "not_ready",
}

/**
 * Decide what to do with an inbound command. Pure: (state, command) -> decision.
 *
 * @param {{ busy: boolean, ready: boolean }} state
 * @param {{ id?: string, kind?: string, text?: string }} command
 * @returns {{ kind: "run", runId: string, text: string, next: object }
 *          | { kind: "reject", code: string, message: string, next: object }}
 */
export function planCommand(state, command, runId) {
  const reject = (code, message) => ({ kind: "reject", code, message, next: state })

  if (command?.kind !== "prompt") {
    return reject(ERR.UNKNOWN_KIND, `unsupported command kind: ${String(command?.kind)}`)
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
export function turnFinished(state) {
  return { ...state, busy: false }
}

// --- lane naming (ADR-0011) -------------------------------------------------

/**
 * The lane name carries WRITER identity. Never "main": a shared lane name makes
 * `pi.branch.tip`, `pi.lane.state` and `pi.lane.config` contended LWW registers,
 * and a clobber silently orphans a whole turn.
 */
export function laneNameForWriter(peerId) {
  if (typeof peerId !== "string" || peerId.length === 0) {
    throw new Error("laneNameForWriter: peerId must be a non-empty string")
  }
  if (peerId.includes("\u0000")) {
    // pi's assertValidBranchName rejects \u0000; fail here rather than there.
    throw new Error("laneNameForWriter: peerId must not contain \\u0000")
  }
  return `w-${peerId}`
}

// --- wire hygiene (ADR-0013) ------------------------------------------------

/**
 * `seq` is a derived, REPLICA-LOCAL arrival index. It is meaningless on another
 * replica and must never cross the wire as a durable identifier. Entry `id` is
 * the durable identifier.
 *
 * Returns the paths at which a `seq` key appears, so a test can assert none do.
 */
export function findSeqKeys(value, path = "$") {
  const hits = []
  if (value === null || typeof value !== "object") return hits
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findSeqKeys(v, `${path}[${i}]`)))
    return hits
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "seq") hits.push(`${path}.${k}`)
    hits.push(...findSeqKeys(v, `${path}.${k}`))
  }
  return hits
}

// --- transcript projection --------------------------------------------------

/**
 * Project raw session-doc entries into an ordered transcript for rendering.
 *
 * Order comes from the `parentId` walk, NOT from seq (ADR-0013: "Nothing may
 * render by seq order"). We walk from the tip back to the root and reverse.
 *
 * @param {Record<string, any>} entries  id -> entry
 * @param {string|null} tipId
 */
export function projectTranscript(entries, tipId) {
  const out = []
  let id = tipId
  const guard = new Set()
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
    .filter((e) => e.type === "message")
    .map((e) => ({
      id: e.id,
      role: e.message?.role ?? "unknown",
      text: messageText(e.message),
    }))
    .filter((m) => m.role === "user" || m.role === "assistant")
}

/** Flatten pi's AgentMessage content into display text. */
export function messageText(message) {
  const content = message?.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
}

// --- environment gate -------------------------------------------------------

/** Compare dotted numeric versions. -1 | 0 | 1 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b).split(".").map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export const LORO_FLOOR = "1.13.4"

/**
 * Deterministic build guards, preferred over a stopwatch (roadmap "Invariants").
 * `stepInPlace` is absent from the published @kyneta/schema 3.0.0, so its
 * presence proves we are on the fixed local build.
 */
export function checkEnvironment({ hasStepInPlace, loroVersion }) {
  const problems = []
  if (hasStepInPlace !== true) {
    problems.push("@kyneta/schema does not export stepInPlace — stale (published 3.0.0) build")
  }
  if (compareVersions(loroVersion, LORO_FLOOR) < 0) {
    problems.push(`loro-crdt ${loroVersion} is below the ${LORO_FLOOR} floor`)
  }
  return { ok: problems.length === 0, problems }
}
