// run-end-report — how a thread's last run ended, for the people who follow it.

import {
  type EntryId,
  entryId,
  type RootId,
  type ThreadId,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import type { AskOutcome } from "@pinetrie/threads"
import { Type } from "typebox"
import { choiceSchema, decodeRecord, threadKey } from "./decode.ts"
import {
  type Answer,
  type AskLines,
  type DigestBody,
  type DigestPlan,
  type DigestRecord,
  digestToWrite,
  parseDigest,
} from "./digest.ts"
import { type RecordSpec, setRecord } from "./records.ts"
import { bareLine, oneLine } from "./request.ts"

const READER_URGENCIES = ["needs-you", "worth-a-read", "done"] as const

const Id = Type.String({ minLength: 1 })
const RunEndReportSchema = Type.Object({
  ask: Id,
  end: Id,
  report: Type.Union([
    Type.Object({ kind: Type.Literal("pending") }),
    Type.Object({
      kind: Type.Literal("model-said"),
      urgency: choiceSchema(READER_URGENCIES),
      reason: Type.Union([Type.String(), Type.Null()]),
    }),
    Type.Object({ kind: Type.Literal("failed"), error: Type.String() }),
    Type.Object({
      kind: Type.Literal("stopped"),
      by: Type.Union([Id, Type.Null()]),
    }),
    Type.Object({ kind: Type.Literal("unclassified") }),
  ]),
})

/** How urgently a model says a run's end asks the people in its thread to look. */
type ReaderUrgency = (typeof READER_URGENCIES)[number]

/**
 * How a thread's last run ended: what happened, never what it asks of whom.
 * Each client decides that for its person (`attentionLevel`).
 */
export type RunEndReport =
  /** The run has stopped running, and the model has not answered yet. */
  | { readonly kind: "pending" }
  /** The model's answer; `reason` is null for `done`. */
  | {
      readonly kind: "model-said"
      readonly urgency: ReaderUrgency
      readonly reason: string | null
    }
  | { readonly kind: "failed"; readonly error: string }
  /** `by` is null for a stop made before stops were recorded. */
  | { readonly kind: "stopped"; readonly by: WriterId | null }
  /** The request failed, its answer was no urgency line, or its host stopped. */
  | { readonly kind: "unclassified" }

/** A thread's last run's end report: a session record keyed by its lane. */
export interface RunEndReportRecord {
  readonly lane: ThreadId
  /** The run's prompt. */
  readonly ask: EntryId
  /**
   * The run's last entry, from its asks (`AskIndex.last`), never the lane's
   * tip: a queued card popped at the run's end can move the tip before this
   * is read.
   */
  readonly end: EntryId
  readonly report: RunEndReport
}

/** Each thread's last run's end report, at its lane. */
export const RUN_END_REPORT: RecordSpec<
  RunEndReportRecord,
  ThreadId,
  "session"
> = {
  namespace: "pinetrie.run-end-report",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(RunEndReportSchema, contents, threadKey(key), (r, lane) => ({
      lane,
      ask: entryId(r.ask),
      end: entryId(r.end),
      report:
        r.report.kind === "stopped"
          ? { kind: "stopped", by: r.report.by as WriterId | null }
          : r.report,
    })),
}

/**
 * Each of `reports` still pending for a lane `settles` names, as
 * `unclassified`: its request is gone, with a host that stopped or a canvas
 * archived since, so nothing will write the run's end report.
 */
export const unclassifiedPending = (
  reports: Iterable<RunEndReportRecord>,
  settles: (lane: ThreadId) => boolean,
): readonly RunEndReportRecord[] =>
  [...reports]
    .filter(r => r.report.kind === "pending" && settles(r.lane))
    .map(r => ({ ...r, report: { kind: "unclassified" } }))

// ── the reply ─────────────────────────────────────────────────────────────

/** The most words a reason may have. */
export const REASON_WORDS = 20

/** How the skill asks each urgency to be written. */
const URGENCY_WORDS: Readonly<Record<string, ReaderUrgency>> = {
  "needs you": "needs-you",
  "worth a read": "worth-a-read",
  done: "done",
}

/** What the model said of a run: an urgency line read. */
interface UrgencyLine {
  readonly urgency: ReaderUrgency
  /** Null for `done`, whose reason no one is shown. */
  readonly reason: string | null
}

/**
 * One urgency line: `needs you: <reason>`, `worth a read: <reason>`
 * or `done`, in any case. Null for any other line, a missing reason, or a
 * reason over `REASON_WORDS` words: never cut, as `parseDigest` never cuts.
 */
export function parseUrgencyLine(line: string): UrgencyLine | null {
  const bare = bareLine(line)
  const colon = bare.indexOf(":")
  const head = (colon < 0 ? bare : bare.slice(0, colon)).trim().toLowerCase()
  const urgency = URGENCY_WORDS[head]
  if (urgency === undefined) return null
  if (urgency === "done") return { urgency, reason: null }
  const reason = colon < 0 ? null : oneLine(bare.slice(colon + 1), REASON_WORDS)
  return reason === null ? null : { urgency, reason }
}

/** A run's final reply, read: each half null when it was refused or not asked for. */
export interface EndReply {
  readonly urgency: UrgencyLine | null
  readonly digest: DigestBody | null
}

/**
 * A run's final reply as `answer` asked for it: the urgency line
 * first, then the digest. Each half is refused on its own, so a good digest
 * survives a bad urgency line and the other way round. An urgency line alone must
 * be the reply's only line.
 */
export function parseEndReply(reply: string, answer: Answer): EndReply {
  if (answer === "digest") return { urgency: null, digest: parseDigest(reply) }
  const [first = "", ...rest] = reply
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")
  if (answer === "urgency")
    return {
      urgency: rest.length === 0 ? parseUrgencyLine(first) : null,
      digest: null,
    }
  return {
    urgency: parseUrgencyLine(first),
    digest: parseDigest(rest.join("\n")),
  }
}

// ── the decision ──────────────────────────────────────────────────────────

/** What to ask the model at a run's end, and from which lines. */
interface EndRequest {
  readonly answer: Answer
  readonly lines: AskLines
  /** The stored digest, as `digestText` words it, when a digest is asked for. */
  readonly previous: string | null
}

/** What a run's end does (`planRunEnded`). */
interface RunEndedPlan {
  /** Written now, from the facts; null when the model is asked for it. */
  readonly report: RunEndReport | null
  /** What to ask, or null for nothing. */
  readonly request: EndRequest | null
}

/**
 * A failed or stopped run's end report is its facts, and the model is
 * asked only for its digest, if one is due. An answered run's urgency is
 * the model's, asked with the digest when one is due (`digest`, from
 * `planDigest`). A run with no entry to read is unclassified. A run whose
 * stored report is no longer its own gets no report: the next run's end
 * has replaced it.
 */
export function planRunEnded(input: {
  /** The stored report is this run's (`pendingRunEndReport`). */
  readonly current: boolean
  readonly outcome: AskOutcome
  /** The run's lines (`askLines`); null for a run with no entry. */
  readonly lines: AskLines | null
  /** `planDigest`'s final plan, or null: a short ask, digests off, or written already. */
  readonly digest: DigestPlan | null
}): RunEndedPlan {
  const { outcome, digest } = input
  const digestOnly: EndRequest | null =
    digest === null
      ? null
      : { answer: "digest", lines: digest, previous: digest.previous }
  if (!input.current) return { report: null, request: digestOnly }
  switch (outcome.kind) {
    case "failed":
      return {
        report: { kind: "failed", error: outcome.error },
        request: digestOnly,
      }
    case "stopped":
      return {
        report: { kind: "stopped", by: outcome.by },
        request: digestOnly,
      }
    case "answered":
    case "running":
      if (digest !== null)
        return {
          report: null,
          request: {
            answer: "urgency-and-digest",
            lines: digest,
            previous: digest.previous,
          },
        }
      return input.lines === null
        ? { report: { kind: "unclassified" }, request: null }
        : {
            report: null,
            request: { answer: "urgency", lines: input.lines, previous: null },
          }
  }
}

/** What a run's end writes as it stops running, before the model is asked. */
export const pendingRunEndReport = (
  lane: ThreadId,
  ask: EntryId,
  end: EntryId,
): RunEndReportRecord => ({ lane, ask, end, report: { kind: "pending" } })

/**
 * What a run's final reply writes, in one write. The end report, when an
 * urgency was asked for: the model's, or `unclassified` when the request
 * failed or its line was refused; nothing when the stored report is another
 * run's, since the next run's end has replaced it. The digest, when asked
 * for, as `digestToWrite` decides for a final one; nothing when the request
 * failed.
 */
export function runEndedToWrite(input: {
  readonly root: RootId
  readonly lane: ThreadId
  readonly ask: EntryId
  readonly end: EntryId
  readonly answer: Answer
  readonly stored: {
    readonly report: RunEndReportRecord | undefined
    readonly digest: DigestRecord | undefined
  }
  /** The reply, read; null when the request failed. */
  readonly reply: EndReply | null
  readonly at: number
}): readonly ValueWrite[] {
  const { answer, reply, ask } = input
  const writes: ValueWrite[] = []
  if (answer !== "digest" && input.stored.report?.ask === ask) {
    const line = reply?.urgency ?? null
    writes.push(
      setRecord(RUN_END_REPORT, {
        lane: input.lane,
        ask,
        end: input.end,
        report:
          line === null
            ? { kind: "unclassified" }
            : {
                kind: "model-said",
                urgency: line.urgency,
                reason: line.reason,
              },
      }),
    )
  }
  if (answer !== "urgency" && reply !== null) {
    const write = digestToWrite({
      stored: input.stored.digest,
      asked: { final: true },
      body: reply.digest,
      prompt: ask,
      root: input.root,
      at: input.at,
    })
    if (write !== null) writes.push(write)
  }
  return writes
}
