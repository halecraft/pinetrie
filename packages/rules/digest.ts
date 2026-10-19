// digest — a model's headline and few points for a long ask's work.

import type { EntryId, RootId, ValueWrite } from "@pinetrie/core"
import {
  type AskIndex,
  isLongAsk,
  lastWord,
  projectTranscript,
  type TreeIndex,
} from "@pinetrie/threads"
import { Type } from "typebox"
import { decodeRecord, entryKey } from "./decode.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"
import {
  bareLine,
  fitNewest,
  LEFT_OUT_NOTE,
  leftOut,
  transcriptLine,
  transcriptLines,
  wordCount,
} from "./request.ts"

// A live digest stores no points, so one that holds them does not decode.
const DigestSchema = Type.Union([
  Type.Object(
    { headline: Type.String(), at: Type.Number(), final: Type.Literal(false) },
    { additionalProperties: false },
  ),
  Type.Object({
    headline: Type.String(),
    points: Type.Array(Type.String()),
    at: Type.Number(),
    final: Type.Literal(true),
  }),
])

/** What a digest says: a model's reply on an ask's work, as read. */
export interface DigestBody {
  /** One line of at most `HEADLINE_WORDS` words (`@pinetrie/rules`' `digest.ts`). */
  readonly headline: string
  /**
   * At most `MAX_POINTS` markdown lines, one point each; empty when the work
   * in between adds nothing to the ask's last word.
   */
  readonly points: readonly string[]
}

/**
 * An ask's digest: replaced whole on each write, so a value, not a text.
 * A live one, written while its run lasts, has no points: they change on
 * each write, and only a final digest's are worth drawing.
 */
export type DigestRecord =
  | {
      /** The ask's prompt: the digest's key. */
      readonly prompt: EntryId
      /** When it was written, in ms since the epoch. */
      readonly at: number
      readonly final: false
      readonly headline: string
    }
  | ({
      readonly prompt: EntryId
      readonly at: number
      /** Written after its run ended: kept, and never replaced by a live one. */
      readonly final: true
    } & DigestBody)

/** Each ask's digest, at its prompt's entry id. */
export const DIGEST: RecordSpec<DigestRecord, EntryId, "root"> = {
  namespace: "pinetrie.digest",
  home: "root",
  keyOf: r => r.prompt,
  encode: ({ prompt, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(DigestSchema, contents, entryKey(key), (r, prompt) =>
      r.final
        ? {
            prompt,
            headline: r.headline,
            points: r.points,
            at: r.at,
            final: true,
          }
        : { prompt, headline: r.headline, at: r.at, final: false },
    ),
}

// ── the reply ─────────────────────────────────────────────────────────────

/** The most words a headline may have: the skill asks for twelve. */
export const HEADLINE_WORDS = 14
/** The most points a digest may have. */
export const MAX_POINTS = 4
/** The most words one point may have: the skill asks for thirty. */
export const POINT_WORDS = 40

// What the skill once asked for when the last word said it all. A reply of
// it alone is no headline: it would be drawn as one.
const NOTHING_TO_ADD = "nothing to add"

const BULLET = /^[-*] +/

/**
 * The model's reply as a digest: its first line the headline
 * (`bareLine`, leading `#`s dropped), every other line a `- ` or `* ` point,
 * and no points when the work adds nothing to the last word. Null for a
 * reply in any other shape, `nothing to add` among them, or with a
 * headline, a point or a list too long.
 * It never cuts a reply, since a cut list says something the model did not.
 */
export function parseDigest(reply: string): DigestBody | null {
  if (bareLine(reply).toLowerCase() === NOTHING_TO_ADD) return null
  const [first, ...rest] = reply
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")
  if (first === undefined || BULLET.test(first)) return null
  const headline = bareLine(first.replace(/^#+\s*/, ""))
  if (headline === "" || wordCount(headline) > HEADLINE_WORDS) return null
  if (rest.length > MAX_POINTS || !rest.every(l => BULLET.test(l))) return null
  const points = rest.map(l => l.replace(BULLET, "").trim())
  if (points.some(p => p === "" || wordCount(p) > POINT_WORDS)) return null
  return { headline, points }
}

/** Points as a markdown list, one `- point` line each. */
export const pointsText = (points: readonly string[]): string =>
  points.map(p => `- ${p}`).join("\n")

/**
 * A digest in the shape the model is asked to answer in, so
 * `parseDigest(digestText(b))` is `b`: the request's summary so far, and the
 * rail's tooltip. A live digest is its headline alone.
 */
export const digestText = (digest: DigestBody | DigestRecord): string =>
  "points" in digest
    ? [digest.headline, pointsText(digest.points)]
        .filter(t => t !== "")
        .join("\n")
    : digest.headline

// ── the setting ───────────────────────────────────────────────────────────

// ── the decision ──────────────────────────────────────────────────────────

/** The least time between two live digests of one ask. */
export const DIGEST_EVERY = 60_000

/**
 * Whether to ask for an ask's digest now. It is asked on events, a
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

/** An ask's run, as a request reads it. */
export interface AskLines {
  /** The ask's message, as a transcript line. */
  readonly said: string
  /** The run's messages but `shown`, as transcript lines, oldest first. */
  readonly work: readonly string[]
  /** The run's last word (`lastWord`), which the reader sees after the fold. */
  readonly shown: string | null
}

/**
 * `ask`'s run as transcript lines, or null for a run with no entry.
 * The lines come from the ask's own entries, walked up from its run's last
 * entry, so they do not depend on where its lane went after. `said` is
 * worded from the prompt itself: `transcriptLines` leaves out a land or
 * stack message.
 */
export function askLines(
  index: TreeIndex,
  asks: AskIndex,
  ask: EntryId,
): AskLines | null {
  const last = asks.last.get(ask)
  if (last === undefined) return null
  const path = projectTranscript(index, last)
  const prompt = path.find(m => m.id === ask)
  const word = lastWord(index, asks, ask)
  const shown = path.find(m => m.id === word)
  return {
    said: prompt === undefined ? "" : transcriptLine(prompt),
    work: transcriptLines(
      path.filter(m => asks.askOf.get(m.id) === ask && m.id !== word),
    ),
    shown: shown === undefined ? null : transcriptLine(shown),
  }
}

/** A digest to ask for: whether it is the final one, and its request's parts. */
export interface DigestPlan extends AskLines {
  readonly final: boolean
  /** The stored digest, as `digestText` words it. */
  readonly previous: string | null
}

/**
 * The digest to ask for `ask` now, or null: none for a short ask
 * (`isLongAsk`) or when `digestDue` says no. Its lines are `askLines`.
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
  if (!isLongAsk(asks, ask) || !digestDue(input)) return null
  const lines = askLines(index, asks, ask)
  if (lines === null) return null
  return {
    ...lines,
    final: input.ended,
    previous: stored === undefined ? null : digestText(stored),
  }
}

/**
 * The write for a reply that came back, or null for none. A live one can
 * come back after the final one was written: it is dropped, so the final one
 * stays. A live one is written without its points. A refused live one leaves
 * the last good digest. A refused final one deletes the stored one, since a
 * live headline says what the run was doing, which is no longer true once it
 * has ended.
 */
export function digestToWrite(input: {
  readonly stored: DigestRecord | undefined
  readonly asked: { readonly final: boolean }
  /** The reply as `parseDigest` read it; null when refused. */
  readonly body: DigestBody | null
  readonly prompt: EntryId
  readonly root: RootId
  readonly at: number
}): ValueWrite | null {
  const { final } = input.asked
  const { body, prompt, root, at } = input
  if (!final && input.stored?.final === true) return null
  if (body === null)
    return final && input.stored !== undefined
      ? deleteRecord(DIGEST, prompt, root)
      : null
  return setRecord(
    DIGEST,
    final
      ? { prompt, ...body, at, final }
      : { prompt, headline: body.headline, at, final },
    root,
  )
}

/**
 * What a request asks the model to answer with. At a run's end it is asked
 * for the urgency line too, first, then the digest when there is one
 * to ask for.
 */
export type Answer = "digest" | "urgency" | "urgency-and-digest"

/** The closing line of a request for the urgency line alone. */
export const URGENCY_ALONE = "Answer with the urgency line alone."
/** The closing line of a request for the urgency line and the digest. */
export const URGENCY_THEN_DIGEST =
  "Answer with the urgency line, then the summary."

/** The request's closing line for `answer`; none for a digest alone, whose skill says it. */
const answerLine = (answer: Answer): string =>
  answer === "digest"
    ? ""
    : `\n${answer === "urgency" ? URGENCY_ALONE : URGENCY_THEN_DIGEST}\n`

/**
 * The request: the skill as the system text, then the ask, the run's
 * newest messages that fit `budget`, the last word the reader sees after
 * them, the digest before this one, and what to answer with. The oldest
 * work is cut first (`fitNewest`); the ask and the last word never are.
 */
export function digestRequest(input: {
  readonly answer: Answer
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
    answerLine(input.answer),
  ].join("")
  const room = Math.max(0, input.budget - head.length - tail.length)
  const { text, dropped } = fitNewest(input.work, room - LEFT_OUT_NOTE)
  return {
    system: input.skill.trim(),
    user: `${head}What the agent has done:\n${leftOut(dropped)}${text || "- (nothing yet)\n"}${tail}`,
  }
}

/**
 * Whether someone has a column reading an ask: a column's reported end
 * (presence's `reading`) is the lane's tip, the ask's message, or
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
