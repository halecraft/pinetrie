// focus — a thread's focus: what it is doing now, in a few words, named by a
// model after each of its runs from its asks and their digests' headlines.

import { type EntryId, entryId, type ThreadId } from "@pinetrie/core"
import {
  type AskIndex,
  entryMessage,
  type TreeIndex,
  threadAsks,
} from "@pinetrie/threads"
import { Type } from "typebox"
import { recordDecoder, threadKey } from "./decode.ts"
import type { DigestRecord } from "./digest.ts"
import type { RecordSpec } from "./records.ts"
import { firstAndNewest, oneLine, transcriptLine } from "./request.ts"

const FocusSchema = Type.Object({
  focus: Type.String({ minLength: 1 }),
  ask: Type.String({ minLength: 1 }),
  at: Type.Number(),
})

/**
 * A thread's focus: what it is doing now, in a few words, named by a model
 * after each of its runs. A session record keyed by its thread.
 */
export interface FocusRecord {
  readonly thread: ThreadId
  /** At most `FOCUS_WORDS` words. */
  readonly focus: string
  /** The ask whose run's end named it: an older ask's focus never replaces it. */
  readonly ask: EntryId
  /** When it was written, in ms since the epoch. */
  readonly at: number
}

/** Each thread's focus, at its thread. */
export const FOCUS: RecordSpec<
  FocusRecord,
  ThreadId,
  "session",
  typeof FocusSchema
> = {
  namespace: "pinetrie.focus",
  home: "session",
  keyOf: r => r.thread,
  encode: ({ thread, ...contents }) => contents,
  decode: recordDecoder(FocusSchema, threadKey, (r, thread) => ({
    thread,
    focus: r.focus,
    ask: entryId(r.ask),
    at: r.at,
  })),
}

// ── the reply ─────────────────────────────────────────────────────────────

/** The most words a focus may have: the skill asks for eight. */
export const FOCUS_WORDS = 10

/** The reply that keeps the focus shown. */
const SAME = "same"

/** A focus reply, read. */
type FocusReply =
  | { readonly kind: "same" }
  | { readonly kind: "focus"; readonly focus: string }

/**
 * The model's reply: `same`, or a focus of one line and at most
 * `FOCUS_WORDS` words (`oneLine`). Null for any other reply: never cut.
 */
export function parseFocus(reply: string): FocusReply | null {
  const line = oneLine(reply, FOCUS_WORDS)
  if (line === null) return null
  return line.toLowerCase() === SAME
    ? { kind: "same" }
    : { kind: "focus", focus: line }
}

// ── the request ───────────────────────────────────────────────────────────

/**
 * How a focus request's text begins: the scripted model tells one by it. The
 * request and its skill call a focus a topic, the word their wording was
 * measured with; no person reads either.
 */
export const FOCUS_REQUEST_HEAD = "The thread's topic now:"

/** How much of an ask's message a request carries. */
const ASK_LENGTH = 300

/** The most asks after the first that a request lists. */
const NEWEST_ASKS = 29

/** One of a thread's asks as a focus request lists it. */
interface FocusAsk {
  /** The ask's message, as a transcript line. */
  readonly said: string
  /** Its digest's headline; null for none. */
  readonly headline: string | null
}

/** What a focus request is asked from (`planFocus`). */
interface FocusPlan {
  /** The focus shown now; null for none. */
  readonly focus: string | null
  /** The thread's asks, oldest first. */
  readonly asks: readonly FocusAsk[]
}

/**
 * The focus to ask for `thread` now, or null: none while digests are off,
 * since a focus reads its asks' headlines, or for a thread with no ask.
 * `settled` is the run that just ended, whose final digest is read from it,
 * since the root's may not hold it yet.
 */
export function planFocus(input: {
  readonly enabled: boolean
  readonly index: TreeIndex
  readonly asks: AskIndex
  readonly thread: ThreadId
  readonly digests: ReadonlyMap<EntryId, DigestRecord>
  readonly settled: {
    readonly ask: EntryId
    readonly digest: DigestRecord | null
  }
  readonly stored: FocusRecord | undefined
}): FocusPlan | null {
  if (!input.enabled) return null
  const { index, settled } = input
  const asks = threadAsks(index, input.asks, input.thread).flatMap(id => {
    const message = entryMessage(index, id)
    if (message === null) return []
    const digest =
      id === settled.ask ? settled.digest : (input.digests.get(id) ?? null)
    return [
      {
        said: transcriptLine(message).slice(0, ASK_LENGTH).replace(/\n/g, " "),
        headline: digest?.headline ?? null,
      },
    ]
  })
  return asks.length === 0 ? null : { focus: input.stored?.focus ?? null, asks }
}

/**
 * The request, in the shape its skill was measured with: the focus shown
 * now, then the thread's first ask always and its newest that fit `budget`,
 * each with what came of it when its digest says.
 */
export function focusRequest(input: {
  readonly skill: string
  readonly plan: FocusPlan
  readonly budget: number
}): { readonly system: string; readonly user: string } {
  const { focus, asks } = input.plan
  const head = `${FOCUS_REQUEST_HEAD} ${focus ?? "(none yet)"}\n\n`
  const label = "What was asked in the thread, oldest first:\n"
  const [first, ...rest] = asks.map(a =>
    a.headline === null ? a.said : `${a.said}\n  (came of it: ${a.headline})`,
  )
  const listed = firstAndNewest(
    first ?? "",
    rest.slice(-NEWEST_ASKS),
    input.budget - head.length - label.length,
  )
  return {
    system: input.skill.trim(),
    user: `${head}${label}${listed.first}${listed.newest}`,
  }
}

// ── the write ─────────────────────────────────────────────────────────────

/**
 * The focus to write for `ask`'s run, or null: none for a failed request, a
 * refused reply, `same`, the stored focus's own words, or when the stored
 * focus was named by a newer ask (entry ids sort by time). Only the words
 * are compared: `ask` and `at` differ on every run.
 */
export function focusToWrite(input: {
  readonly stored: FocusRecord | undefined
  /** The reply as `parseFocus` read it; null when the request failed or it was refused. */
  readonly reply: FocusReply | null
  readonly thread: ThreadId
  readonly ask: EntryId
  readonly at: number
}): FocusRecord | null {
  const { stored, reply } = input
  if (reply === null || reply.kind === "same") return null
  if (stored !== undefined && stored.ask > input.ask) return null
  if (stored?.focus === reply.focus) return null
  return {
    thread: input.thread,
    focus: reply.focus,
    ask: input.ask,
    at: input.at,
  }
}
