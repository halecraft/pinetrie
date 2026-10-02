// digest — a model's short account of an ask's work (ADR-0056), when the
// user config turns digests on. The record is a host-written `pineta.digest`
// value keyed by the ask's prompt; no agent reads it, so it puts no tokens in
// any context. The host carries the plan out (`apps/pineta/host/digests.ts`).

import {
  type AskIndex,
  type EntryId,
  projectTranscript,
  type TreeIndex,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"
import {
  fitNewest,
  LEFT_OUT_NOTE,
  leftOut,
  transcriptLine,
  transcriptLines,
} from "./request.ts"

/** pi value namespace for digests. The key is the ask's prompt. */
export const DIGEST_NAMESPACE = "pineta.digest"

/** An ask's digest: replaced whole on each write, so a value, not a text (ADR-0014). */
export interface DigestRecord {
  readonly text: string
  /** When it was written, in ms since the epoch. */
  readonly at: number
  /** Written after its run ended: kept, and never replaced by a live one. */
  readonly final: boolean
}

const DigestSchema = Type.Object({
  text: Type.String(),
  at: Type.Number(),
  final: Type.Boolean(),
})

/** A digest -> the plain value stored in pi. */
export const encodeDigest = (r: DigestRecord) => ({ ...r })

export const decodeDigest = (value: unknown): DigestRecord | undefined =>
  decodeWith(DigestSchema, value, r => r)

/** Stored `pineta.digest` values -> each ask's digest, by its prompt. */
export function digestRecords(
  values: Iterable<{ readonly key: string; readonly value: unknown }>,
): ReadonlyMap<string, DigestRecord> {
  const out = new Map<string, DigestRecord>()
  for (const { key, value } of values) {
    const r = decodeDigest(value)
    if (r !== undefined) out.set(key, r)
  }
  return out
}

// ── the setting ───────────────────────────────────────────────────────────

const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined

/** The user config's `digests`: on only when `enabled` is `true`. Total. */
export const decodeDigestConfig = (json: unknown): boolean =>
  recordOf(recordOf(json)?.digests)?.enabled === true

// ── the decision ──────────────────────────────────────────────────────────

/** The least time between two live digests of one ask. */
export const DIGEST_EVERY = 60_000

/**
 * Pure. Whether to ask for an ask's digest now. It is asked on events, a
 * turn done and a run's end, never on a timer: those are when there is
 * something new to say. At the end, once, for the final one. While the run
 * lasts, only when nothing is asked already, someone has a column reading
 * the thread, and `DIGEST_EVERY` has passed since the last.
 */
export function digestDue(input: {
  readonly ended: boolean
  readonly stored: DigestRecord | undefined
  readonly inFlight: boolean
  readonly reading: boolean
  readonly now: number
}): boolean {
  const { stored } = input
  if (stored?.final === true) return false
  if (input.ended) return true
  return (
    !input.inFlight &&
    input.reading &&
    (stored === undefined || input.now - stored.at >= DIGEST_EVERY)
  )
}

/** A digest to ask for: whether it is the final one, and its request's parts. */
export interface DigestPlan {
  readonly final: boolean
  /** The ask's message, as a transcript line. */
  readonly said: string
  /** The run's messages, as transcript lines, oldest first. */
  readonly work: readonly string[]
  readonly previous: string | null
}

/**
 * Pure. The digest to ask for `ask` now, or null: none when its run has no
 * work yet or `digestDue` says no. The lines come from the ask's own entries,
 * walked up from its run's last entry, so they do not depend on where its
 * lane went after. `said` is worded from the prompt itself: `transcriptLines`
 * leaves out a land or stack message.
 */
export function planDigest(input: {
  readonly index: TreeIndex
  readonly asks: AskIndex
  readonly ask: EntryId
  readonly ended: boolean
  readonly stored: DigestRecord | undefined
  readonly inFlight: boolean
  readonly reading: boolean
  readonly now: number
}): DigestPlan | null {
  const { index, asks, ask, stored } = input
  const last = asks.last.get(ask)
  if (!asks.work.has(ask) || last === undefined) return null
  if (!digestDue(input)) return null
  const path = projectTranscript(index, last)
  const prompt = path.find(m => m.id === ask)
  return {
    final: input.ended,
    said: prompt === undefined ? "" : transcriptLine(prompt),
    work: transcriptLines(
      path.filter(m => asks.askOf.get(m.id as EntryId) === ask),
    ),
    previous: stored?.text ?? null,
  }
}

/**
 * Pure. Whether a digest that came back may be written. A live one asked
 * during the run can come back after the final one was written: it is
 * dropped, so the final one stays.
 */
export const digestStillWanted = (
  stored: DigestRecord | undefined,
  asked: { readonly final: boolean },
): boolean => asked.final || stored?.final !== true

/**
 * The request: the skill as the system text, then the ask, the run's
 * newest messages that fit `budget`, and the digest before this one. The
 * oldest work is cut first (`fitNewest`); the ask never is.
 */
export function digestRequest(input: {
  readonly skill: string
  /** The ask's message, as a transcript line. */
  readonly ask: string
  /** The run's messages, as transcript lines. */
  readonly work: readonly string[]
  readonly previous: string | null
  readonly budget: number
}): { readonly system: string; readonly user: string } {
  const head = `What was asked:\n${input.ask}\n\n`
  const tail =
    input.previous === null ? "" : `\nThe summary so far:\n${input.previous}\n`
  const room = Math.max(0, input.budget - head.length - tail.length)
  const { text, dropped } = fitNewest(input.work, room - LEFT_OUT_NOTE)
  return {
    system: input.skill.trim(),
    user: `${head}What the agent has done:\n${leftOut(dropped)}${text || "- (nothing yet)\n"}${tail}`,
  }
}

/**
 * Pure. Whether someone has a column reading an ask: a column's reported end
 * (presence's `reading`, ADR-0024) is the lane's tip, the ask's message, or
 * an entry of its work, so it follows the run.
 */
export function readsAsk(
  ends: Iterable<string>,
  asks: AskIndex,
  ask: EntryId,
  tip: string | null,
): boolean {
  for (const end of ends)
    if (end === tip || end === ask || asks.askOf.get(end as EntryId) === ask)
      return true
  return false
}
