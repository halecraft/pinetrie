// budget — the tokens agents may spend talking, keyed by the person's message
// that set them talking.

import type { EntryId, ThreadId, ValueWrite, WriterId } from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, entryKey } from "./decode.ts"
import { type RecordSpec, setRecord } from "./records.ts"

/** A budget, at the message that set it. */
export interface AllowanceRecord {
  /** The person's message that set it: the key. */
  readonly message: EntryId
  /** The thread that message is in, where its facts go. */
  readonly thread: ThreadId
  /** Whose message it was: a stop for its sake names them. */
  readonly by: WriterId
  /** Tokens agents may spend. */
  readonly limit: number
  /** Tokens spent, as of the last run's end, or of going over. */
  readonly spent: number
  /** Whether a request crossed `limit`: nothing more is spent from it. */
  readonly over: boolean
}

const AllowanceSchema = Type.Object({
  thread: Type.String({ minLength: 1 }),
  by: Type.String({ minLength: 1 }),
  limit: Type.Number({ minimum: 0 }),
  spent: Type.Number({ minimum: 0 }),
  over: Type.Boolean(),
})

/** Each budget, at the message that set it. */
export const ALLOWANCE: RecordSpec<AllowanceRecord, EntryId, "session"> = {
  namespace: "pinetrie.allowance",
  home: "session",
  keyOf: r => r.message,
  encode: ({ message, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(AllowanceSchema, contents, entryKey(key), (r, message) => ({
      message,
      thread: r.thread as ThreadId,
      by: r.by as WriterId,
      limit: r.limit,
      spent: r.spent,
      over: r.over,
    })),
}

/** The budget a person's message sets when no config names one. */
export const DEFAULT_ALLOWANCE = 200_000

export const newAllowance = (input: {
  readonly message: EntryId
  readonly thread: ThreadId
  readonly by: WriterId
  readonly limit: number
}): ValueWrite<"session"> =>
  setRecord(ALLOWANCE, { ...input, spent: 0, over: false })

/** One model request's tokens, as the provider reported them. */
export interface RequestTokens {
  /** What the request sent: input, cached or not. */
  readonly context: number
  /** What the model wrote, thinking included. */
  readonly output: number
}

/**
 * The tokens a run's request adds to the talk: its output, and the context
 * new since the run's previous request (tool results, a steered message).
 * Context a request only re-reads is not counted: every request re-reads
 * its lane's whole thread, so counting that spent a budget on a thread's
 * size before an asked agent could answer. A run's first request adds its
 * output alone: its prompt is an ask or an answer, already counted as the
 * output of the agent that wrote it. A compaction shrinks the context, and
 * adds nothing.
 */
export function addedTokens(
  previous: RequestTokens | null,
  now: RequestTokens,
): number {
  if (previous === null) return now.output
  return (
    now.output + Math.max(0, now.context - previous.context - previous.output)
  )
}

/** What one spend does: the new count, and the record to write when it went over. */
export interface Spend {
  readonly spent: number
  /** The record with `over`, the first time the count crosses `limit`; null otherwise. */
  readonly over: AllowanceRecord | null
}

/**
 * `tokens` more spent from `record`, whose live count is `spent`. The
 * record is rewritten only by the spend that crosses its limit.
 */
export function planSpend(
  record: AllowanceRecord,
  spent: number,
  tokens: number,
): Spend {
  const now = spent + Math.max(0, tokens)
  return {
    spent: now,
    over:
      !record.over && now >= record.limit
        ? { ...record, spent: now, over: true }
        : null,
  }
}

/** Whether a run spending `record` may make another model request. */
export const mayRequest = (record: AllowanceRecord | undefined): boolean =>
  record === undefined || !record.over
