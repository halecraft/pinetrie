// digest — a model's headline and few points for a long ask's work
// (ADR-0056, ADR-0075), unless the user config turns digests off. The record
// is a host-written `pineta.digest` value keyed by the ask's prompt; no agent
// reads it, so it puts no tokens in any context. The host carries the plan
// out (`apps/pineta/host/digests.ts`).

import {
  type AskIndex,
  type EntryId,
  isLongAsk,
  lastWord,
  projectTranscript,
  type TreeIndex,
} from "@pineta/core"
import { Type } from "typebox"
import { recordOf } from "./config.ts"
import { decodeAt, entryKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"
import {
  bareLine,
  fitNewest,
  LEFT_OUT_NOTE,
  leftOut,
  transcriptLine,
  transcriptLines,
} from "./request.ts"

/** What a digest says (ADR-0075). */
export interface DigestBody {
  /**
   * One line of at most `HEADLINE_WORDS` words; null when the model found
   * nothing the reader does not see already.
   */
  readonly headline: string | null
  /** At most `MAX_POINTS` markdown lines, one point each; empty when `headline` is null. */
  readonly points: readonly string[]
}

/** An ask's digest: replaced whole on each write, so a value, not a text (ADR-0014). */
export interface DigestRecord extends DigestBody {
  /** The ask's prompt: the digest's key. */
  readonly prompt: EntryId
  /** When it was written, in ms since the epoch. */
  readonly at: number
  /** Written after its run ended: kept, and never replaced by a live one. */
  readonly final: boolean
}

const DigestSchema = Type.Object({
  headline: Type.Union([Type.String(), Type.Null()]),
  points: Type.Array(Type.String()),
  at: Type.Number(),
  final: Type.Boolean(),
})

/** Each ask's digest, at its prompt's entry id. */
export const DIGEST: RecordSpec<DigestRecord, EntryId, "root"> = {
  namespace: "pineta.digest",
  home: "root",
  keyOf: r => r.prompt,
  encode: ({ prompt, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(DigestSchema, contents, entryKey(key), (r, prompt) => ({
      prompt,
      headline: r.headline,
      points: r.points,
      at: r.at,
      final: r.final,
    })),
}

// ── the reply ─────────────────────────────────────────────────────────────

/** The most words a headline may have: the skill asks for twelve. */
export const HEADLINE_WORDS = 14
/** The most points a digest may have. */
export const MAX_POINTS = 4
/** The most words one point may have. */
export const POINT_WORDS = 40
/** The whole reply that says the reader sees everything worth saying already. */
export const NOTHING_TO_ADD = "nothing to add"

const NO_DIGEST: DigestBody = { headline: null, points: [] }

const words = (text: string): number => text.split(/\s+/).length
const BULLET = /^[-*] +/

/**
 * Pure. The model's reply as a digest: its first line the headline
 * (`bareLine`, leading `#`s dropped), every other line a `- ` or `* ` point,
 * or `nothing to add` alone for none. Null for a reply in any other shape,
 * or with a headline, a point or a list too long: the stored digest stays.
 * It never cuts a reply, since a cut list says something the model did not.
 */
export function digestOf(reply: string): DigestBody | null {
  if (bareLine(reply).toLowerCase() === NOTHING_TO_ADD) return NO_DIGEST
  const [first, ...rest] = reply
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")
  if (first === undefined || BULLET.test(first)) return null
  const headline = bareLine(first.replace(/^#+\s*/, ""))
  if (headline === "" || words(headline) > HEADLINE_WORDS) return null
  if (rest.length > MAX_POINTS || !rest.every(l => BULLET.test(l))) return null
  const points = rest.map(l => l.replace(BULLET, "").trim())
  if (points.some(p => p === "" || words(p) > POINT_WORDS)) return null
  return { headline, points }
}

/** Pure. Points as a markdown list, one `- point` line each. */
export const pointsText = (points: readonly string[]): string =>
  points.map(p => `- ${p}`).join("\n")

/**
 * Pure. A digest in the shape the model is asked to answer in, so
 * `digestOf(digestText(b))` is `b`: the request's summary so far, and the
 * rail's tooltip.
 */
export const digestText = (body: DigestBody): string =>
  body.headline === null
    ? NOTHING_TO_ADD
    : [body.headline, pointsText(body.points)].filter(t => t !== "").join("\n")

// ── the setting ───────────────────────────────────────────────────────────

/** The user config's `digests`: on unless `enabled` is `false` (ADR-0071). Total. */
export const decodeDigestConfig = (json: unknown): boolean =>
  recordOf(recordOf(json)?.digests)?.enabled !== false

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
  /** The run's messages but `shown`, as transcript lines, oldest first. */
  readonly work: readonly string[]
  /** The run's last word (`lastWord`), which the reader sees after the fold. */
  readonly shown: string | null
  /** The stored digest, as `digestText` words it. */
  readonly previous: string | null
}

/**
 * Pure. The digest to ask for `ask` now, or null: none for a short ask
 * (`isLongAsk`) or when `digestDue` says no. The lines come from the ask's
 * own entries, walked up from its run's last entry, so they do not depend on
 * where its lane went after. `said` is worded from the prompt itself:
 * `transcriptLines` leaves out a land or stack message.
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
  if (!isLongAsk(asks, ask) || last === undefined) return null
  if (!digestDue(input)) return null
  const path = projectTranscript(index, last)
  const prompt = path.find(m => m.id === ask)
  const word = lastWord(index, asks, ask)
  const shown = path.find(m => m.id === word)
  return {
    final: input.ended,
    said: prompt === undefined ? "" : transcriptLine(prompt),
    work: transcriptLines(
      path.filter(m => asks.askOf.get(m.id) === ask && m.id !== word),
    ),
    shown: shown === undefined ? null : transcriptLine(shown),
    previous: stored === undefined ? null : digestText(stored),
  }
}

/**
 * Pure. The record to write for a reply that came back, or null for none.
 * A live one can come back after the final one was written: it is dropped,
 * so the final one stays. A refused live one leaves the last good digest. A
 * refused final one writes an empty final digest, since a live headline says
 * what the run was doing, which is no longer true once it has ended.
 */
export function digestToWrite(input: {
  readonly stored: DigestRecord | undefined
  readonly asked: { readonly final: boolean }
  /** The reply as `digestOf` read it; null when refused. */
  readonly body: DigestBody | null
  readonly prompt: EntryId
  readonly at: number
}): DigestRecord | null {
  const { final } = input.asked
  if (!final && input.stored?.final === true) return null
  const body = input.body ?? (final ? NO_DIGEST : null)
  if (body === null) return null
  return { prompt: input.prompt, ...body, at: input.at, final }
}

/**
 * The request: the skill as the system text, then the ask, the run's
 * newest messages that fit `budget`, the last word the reader sees after
 * them, and the digest before this one. The oldest work is cut first
 * (`fitNewest`); the ask and the last word never are.
 */
export function digestRequest(input: {
  readonly skill: string
  /** The ask's message, as a transcript line. */
  readonly ask: string
  /** The run's messages but `shown`, as transcript lines. */
  readonly work: readonly string[]
  /** The run's last word, as a transcript line. */
  readonly shown: string | null
  readonly previous: string | null
  readonly budget: number
}): { readonly system: string; readonly user: string } {
  const head = `What was asked:\n${input.ask}\n\n`
  const tail = [
    input.shown === null
      ? ""
      : `\nWhat the reader sees after the work:\n${input.shown}\n`,
    input.previous === null ? "" : `\nThe summary so far:\n${input.previous}\n`,
  ].join("")
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
  ends: Iterable<EntryId>,
  asks: AskIndex,
  ask: EntryId,
  tip: EntryId | null,
): boolean {
  for (const end of ends)
    if (end === tip || end === ask || asks.askOf.get(end) === ask) return true
  return false
}
