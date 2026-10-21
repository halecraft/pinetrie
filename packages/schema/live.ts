// schema/live — what is streaming now, `pinetrie:live`: its schema, the
// stream row's codec, its one writer and its readers.

import {
  type BoundSchema,
  batch,
  type DocRef,
  json,
  Schema,
} from "@kyneta/schema"
import {
  entryId,
  isThreadId,
  type RunId,
  runId,
  statementIndex,
  type ThreadId,
} from "@pinetrie/core"
import {
  type LiveOp,
  type Stream,
  type StreamId,
  type StreamRecord,
  streamId,
  type TextEdit,
} from "@pinetrie/threads"

/**
 * What is streaming now, written only by the host. No restarted
 * host needs it, since a starting host clears it, so it is a document of its
 * own: compacting it rewrites only what is running.
 *
 * `streams` holds one row per stream, keyed by a fresh uuidv7, and
 * `streamText` its text, written as edits: a whole-value string costs
 * O(n^2) and stores every snapshot. `activeRuns` maps a lane to
 * the run it is streaming; a lane with no key is idle.
 */
export const LiveDoc = json.bind(
  Schema.struct({
    streams: Schema.record(
      Schema.struct.json({
        lane: Schema.string(),
        kind: Schema.string("reply", "tool"),
        /** A tool's call; null for a reply. */
        callId: Schema.string().nullable(),
        /** The lane's tip when a reply opened; null for a tool, or a lane with none. */
        under: Schema.string().nullable(),
        /** A tool stream's statement; null for a reply, or a call's whole output. */
        statement: Schema.number().nullable(),
      }),
    ),
    streamText: Schema.record(Schema.text()),
    activeRuns: Schema.record(Schema.string()),
  }),
)

/** A live handle on what is streaming now. */
export type LiveDocHandle =
  typeof LiveDoc extends BoundSchema<infer S, infer N> ? DocRef<S, N> : never

type StoredStream = ReturnType<LiveDocHandle["streams"]>[string]

const encodeStream = (s: StreamRecord): StoredStream =>
  s.kind === "reply"
    ? {
        lane: s.lane,
        kind: "reply",
        callId: null,
        under: s.under,
        statement: null,
      }
    : {
        lane: s.lane,
        kind: "tool",
        callId: s.callId,
        under: null,
        statement: s.statement ?? null,
      }

/**
 * A stored row, read; undefined for one whose lane is no thread's. Only the
 * host writes streams, and a starting host closes every one (`planClear`).
 */
function decodeStream(id: string, s: StoredStream): StreamRecord | undefined {
  if (!isThreadId(s.lane)) return undefined
  if (s.kind === "tool") {
    const record = {
      id: streamId(id),
      lane: s.lane,
      kind: "tool",
      callId: s.callId ?? "",
    } as const
    if (s.statement === null) return record
    // A statement that is no ordinal is dropped, never read as the call's
    // whole output.
    const statement = statementIndex(s.statement)
    return statement === null ? undefined : { ...record, statement }
  }
  return {
    id: streamId(id),
    lane: s.lane,
    kind: "reply",
    under: s.under === null ? null : entryId(s.under),
  }
}

/** Apply `edits` to a Kyneta text: the one place text receives edits. */
export function applyTextEdits(
  ref: {
    insert(at: number, s: string): void
    delete(at: number, n: number): void
  },
  edits: readonly TextEdit[],
): void {
  for (const e of edits) {
    if (e.remove > 0) ref.delete(e.at, e.remove)
    if (e.insert.length > 0) ref.insert(e.at, e.insert)
  }
}

/** The one writer of `pinetrie:live`: `ops`, in one batch. */
export function applyLiveOps(
  live: LiveDocHandle,
  ops: readonly LiveOp[],
): void {
  if (ops.length === 0) return
  batch(live, d => {
    for (const op of ops) {
      switch (op.kind) {
        case "open":
          d.streams.set(op.stream.id, encodeStream(op.stream))
          d.streamText.set(op.stream.id, "")
          break
        case "edit": {
          const ref = d.streamText.at(op.id)
          if (ref !== undefined) applyTextEdits(ref, op.edits)
          break
        }
        case "close":
          d.streams.delete(op.id)
          d.streamText.delete(op.id)
          break
        case "begin":
          d.activeRuns.set(op.lane, op.run)
          break
        case "end":
          d.activeRuns.delete(op.lane)
          break
      }
    }
  })
}

/** The run a lane is running, or undefined when the lane is idle. */
export function readActiveRun(
  live: LiveDocHandle,
  lane: ThreadId,
): RunId | undefined {
  const run = live.activeRuns.get(lane)
  return typeof run === "string" ? runId(run) : undefined
}

/** Every lane with a run, as stored; a key that is no lane is left out. */
export const readActiveLanes = (live: LiveDocHandle): readonly ThreadId[] =>
  Object.keys(live.activeRuns()).filter(isThreadId)

/**
 * Every stream's record, or only `lane`'s, in id order, without reading any
 * text: a `useTracked` over it does not re-run on a delta.
 */
export function readStreamRecords(
  live: LiveDocHandle,
  lane?: ThreadId,
): readonly StreamRecord[] {
  return Object.entries(live.streams())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([id, row]) => {
      const s = decodeStream(id, row)
      return s === undefined || (lane !== undefined && s.lane !== lane)
        ? []
        : [s]
    })
}

/** Every stream id stored, with a record or only a text. */
export const readStreamIds = (live: LiveDocHandle): readonly StreamId[] =>
  [
    ...new Set([
      ...Object.keys(live.streams()),
      ...Object.keys(live.streamText()),
    ]),
  ].map(streamId)

/** What a stream has written so far; "" once it is gone. */
export const readStreamText = (live: LiveDocHandle, id: StreamId): string =>
  live.streamText.at(id)?.() ?? ""

/** Every stream, or only `lane`'s, with its text. */
export function readStreams(
  live: LiveDocHandle,
  lane?: ThreadId,
): readonly Stream[] {
  return readStreamRecords(live, lane).map(s => ({
    ...s,
    text: readStreamText(live, s.id),
  }))
}
