// verdict — how a thread's last run ended, for the people who follow it
// (ADR-0077). The record is a host-written `pinetrie.verdict` value in the
// session, keyed by lane, so your inbox and the board read it across
// roots. It holds what happened; what that asks of each person is decided
// on their client. The host carries the plan out
// (`apps/pinetrie/host/digests.ts`): one request at a run's end, for the
// verdict and the final digest together.

import {
  type AskOutcome,
  type DigestBody,
  type DigestRecord,
  type EntryId,
  entryId,
  type RootId,
  type Said,
  type ThreadId,
  type ValueWrite,
  type Verdict,
  type VerdictRecord,
  type WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeAt, threadKey } from "./decode.ts"
import {
  type Answer,
  type AskLines,
  DIGEST,
  type DigestPlan,
  digestOf,
  digestToWrite,
} from "./digest.ts"
import { type RecordSpec, setRecord } from "./records.ts"
import { bareLine } from "./request.ts"

const Id = Type.String({ minLength: 1 })
const VerdictSchema = Type.Object({
  ask: Id,
  end: Id,
  verdict: Type.Union([
    Type.Object({ kind: Type.Literal("pending") }),
    Type.Object({
      kind: Type.Literal("said"),
      said: Type.Union([
        Type.Literal("needsYou"),
        Type.Literal("worthARead"),
        Type.Literal("done"),
      ]),
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

/** Each thread's last run's verdict, at its lane. */
export const VERDICT: RecordSpec<VerdictRecord, ThreadId, "session"> = {
  namespace: "pinetrie.verdict",
  home: "session",
  keyOf: r => r.lane,
  encode: ({ lane, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(VerdictSchema, contents, threadKey(key), (r, lane) => ({
      lane,
      ask: entryId(r.ask),
      end: entryId(r.end),
      verdict:
        r.verdict.kind === "stopped"
          ? { kind: "stopped", by: r.verdict.by as WriterId | null }
          : r.verdict,
    })),
}

// ── the reply ─────────────────────────────────────────────────────────────

/** The most words a reason may have. */
export const REASON_WORDS = 20

/** How the skill asks each verdict to be written. */
const SAID_WORDS: Readonly<Record<string, Said>> = {
  "needs you": "needsYou",
  "worth a read": "worthARead",
  done: "done",
}

/** What the model said of a run: a verdict line read. */
export interface SaidLine {
  readonly said: Said
  /** Null for `done`, whose reason no one is shown. */
  readonly reason: string | null
}

/**
 * Pure. One verdict line: `needs you: <reason>`, `worth a read: <reason>`
 * or `done`, in any case. Null for any other line, a missing reason, or a
 * reason over `REASON_WORDS` words: never cut, as `digestOf` never cuts.
 */
export function verdictOf(line: string): SaidLine | null {
  const bare = bareLine(line)
  const colon = bare.indexOf(":")
  const head = (colon < 0 ? bare : bare.slice(0, colon)).trim().toLowerCase()
  const said = SAID_WORDS[head]
  if (said === undefined) return null
  if (said === "done") return { said, reason: null }
  const reason = colon < 0 ? "" : bareLine(bare.slice(colon + 1))
  if (reason === "" || reason.split(/\s+/).length > REASON_WORDS) return null
  return { said, reason }
}

/** A run's final reply, read: each half null when it was refused or not asked for. */
export interface EndReply {
  readonly verdict: SaidLine | null
  readonly digest: DigestBody | null
}

/**
 * Pure. A run's final reply as `answer` asked for it: the verdict line
 * first, then the digest. Each half is refused on its own, so a good digest
 * survives a bad verdict line and the other way round. A verdict alone must
 * be the reply's only line.
 */
export function endReplyOf(reply: string, answer: Answer): EndReply {
  if (answer === "digest") return { verdict: null, digest: digestOf(reply) }
  const [first = "", ...rest] = reply
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")
  if (answer === "verdict")
    return {
      verdict: rest.length === 0 ? verdictOf(first) : null,
      digest: null,
    }
  return { verdict: verdictOf(first), digest: digestOf(rest.join("\n")) }
}

// ── the decision ──────────────────────────────────────────────────────────

/** What to ask the model at a run's end, and from which lines. */
export interface EndRequest {
  readonly answer: Answer
  readonly lines: AskLines
  /** The stored digest, as `digestText` words it, when a digest is asked for. */
  readonly previous: string | null
}

/** What a run's end does (`planRunEnded`). */
export interface RunEndedPlan {
  /** Written now, from the facts; null when the model is asked for it. */
  readonly verdict: Verdict | null
  /** What to ask, or null for nothing. */
  readonly request: EndRequest | null
}

/**
 * Pure. A failed or stopped run's verdict is its facts, and the model is
 * asked only for its digest, if one is due. An answered run's verdict is
 * the model's, asked with the digest when one is due (`digest`, from
 * `planDigest`). A run with no entry to read is unclassified. A run whose
 * stored verdict is no longer its own gets no verdict: the next run's end
 * has replaced it.
 */
export function planRunEnded(input: {
  /** The stored verdict is this run's (`pendingVerdict`). */
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
  if (!input.current) return { verdict: null, request: digestOnly }
  switch (outcome.kind) {
    case "failed":
      return {
        verdict: { kind: "failed", error: outcome.error },
        request: digestOnly,
      }
    case "stopped":
      return {
        verdict: { kind: "stopped", by: outcome.by },
        request: digestOnly,
      }
    case "answered":
    case "running":
      if (digest !== null)
        return {
          verdict: null,
          request: {
            answer: "verdict and digest",
            lines: digest,
            previous: digest.previous,
          },
        }
      return input.lines === null
        ? { verdict: { kind: "unclassified" }, request: null }
        : {
            verdict: null,
            request: { answer: "verdict", lines: input.lines, previous: null },
          }
  }
}

/** What a run's end writes as it stops running, before the model is asked. */
export const pendingVerdict = (
  lane: ThreadId,
  ask: EntryId,
  end: EntryId,
): VerdictRecord => ({ lane, ask, end, verdict: { kind: "pending" } })

/**
 * Pure. What a run's final reply writes, in one write. The verdict, when
 * asked for: the model's, or `unclassified` when the request failed or its
 * line was refused; nothing when the stored verdict is another run's, since
 * the next run's end has replaced it. The digest, when asked for, as
 * `digestToWrite` decides for a final one; nothing when the request failed.
 */
export function runEndedToWrite(input: {
  readonly root: RootId
  readonly lane: ThreadId
  readonly ask: EntryId
  readonly end: EntryId
  readonly answer: Answer
  readonly stored: {
    readonly verdict: VerdictRecord | undefined
    readonly digest: DigestRecord | undefined
  }
  /** The reply, read; null when the request failed. */
  readonly reply: EndReply | null
  readonly at: number
}): readonly ValueWrite[] {
  const { answer, reply, ask } = input
  const writes: ValueWrite[] = []
  if (answer !== "digest" && input.stored.verdict?.ask === ask) {
    const said = reply?.verdict ?? null
    writes.push(
      setRecord(VERDICT, {
        lane: input.lane,
        ask,
        end: input.end,
        verdict:
          said === null
            ? { kind: "unclassified" }
            : { kind: "said", said: said.said, reason: said.reason },
      }),
    )
  }
  if (answer !== "verdict" && reply !== null) {
    const record = digestToWrite({
      stored: input.stored.digest,
      asked: { final: true },
      body: reply.digest,
      prompt: ask,
      at: input.at,
    })
    if (record !== null) writes.push(setRecord(DIGEST, record, input.root))
  }
  return writes
}
