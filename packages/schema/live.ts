// schema/live — what is streaming now, `pinetrie:live` (ADR-0014, ADR-0063):
// its schema, the stream row's codec, its one writer and its readers. What a
// stream event does is planned in `@pinetrie/rules` (`packages/rules/live.ts`).

import { batch, createDoc, json, Schema } from "@kyneta/schema"
import {
  entryId,
  isThreadId,
  type LiveOp,
  type RunId,
  runId,
  type Stream,
  type StreamId,
  type StreamRecord,
  streamId,
  type TextEdit,
  type ThreadId,
} from "@pinetrie/core"

/**
 * What is streaming now (ADR-0063), written only by the host. No restarted
 * host needs it, since a starting host clears it, so it is a document of its
 * own: compacting it rewrites only what is running.
 *
 * `streams` holds one row per stream, keyed by a fresh uuidv7 (ADR-0016), and
 * `streamText` its text, written as edits (ADR-0014): a whole-value string
 * costs O(n^2) and stores every snapshot (S22). `activeRuns` maps a lane to
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
      }),
    ),
    streamText: Schema.record(Schema.text()),
    activeRuns: Schema.record(Schema.string()),
  }),
)

export const newLiveDoc = () => createDoc(LiveDoc)

/** A live handle on what is streaming now. */
export type LiveDocHandle = ReturnType<typeof newLiveDoc>

type StoredStream = ReturnType<LiveDocHandle["streams"]>[string]

const encodeStream = (s: StreamRecord): StoredStream =>
  s.kind === "reply"
    ? { lane: s.lane, kind: "reply", callId: null, under: s.under }
    : { lane: s.lane, kind: "tool", callId: s.callId, under: null }

/**
 * A stored row, read; undefined for one whose lane is no thread's. Only the
 * host writes streams, and a starting host closes every one (`planClear`).
 */
function decodeStream(id: string, s: StoredStream): StreamRecord | undefined {
  if (!isThreadId(s.lane)) return undefined
  return s.kind === "tool"
    ? { id: streamId(id), lane: s.lane, kind: "tool", callId: s.callId ?? "" }
    : {
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
 * text: a `useTracked` over it does not re-run on a delta (S55).
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
