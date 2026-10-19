// live — what each stream event, and a run's start and end, do to
// `pinetrie:live`, as `LiveOp`s `applyLiveOps` (@pinetrie/schema) writes.

import type { EntryId, RunId, ThreadId } from "@pinetrie/core"
import {
  type LiveOp,
  type Stream,
  type StreamEvent,
  type StreamId,
  type StreamRecord,
  streamId,
  tailEdit,
} from "@pinetrie/threads"

/**
 * Whether `s` is its lane's reply being written now: the lane's tip has not
 * moved since it opened. The reply's own entry moves the tip, in the commit
 * that writes it, so the entry and the end of this are one change. The
 * host appends to this reply, and the reader draws it.
 */
export const isCurrentReply = (s: StreamRecord, tip: EntryId | null): boolean =>
  s.kind === "reply" && s.under === tip

/** Close each stream given: the one way a stream is deleted. */
const closeStreams = (
  streams: readonly { readonly id: StreamId }[],
): LiveOp[] => streams.map(s => ({ kind: "close", id: s.id }))

/**
 * What one stream event does to the document.
 *
 * A reply stream opens on its message's first text, `under` the lane's tip,
 * and takes the message's text while it is current (`isCurrentReply`).
 * Nothing happens when a message or a tool ends: a stream stays until its
 * entry is written, so a reader never sees neither. Streams go when they can
 * no longer be drawn: a new reply closes its lane's streams, whose entries
 * are written before its request; a tool closes its lane's replies that
 * are no longer current. A tool's output arrives as whole snapshots of a view
 * that keeps only the tail, written as `tailEdit`s. An event for a lane that
 * is not running changes nothing.
 */
export function planStream(input: {
  readonly event: StreamEvent
  /** The event's lane's streams, with their text. */
  readonly streams: readonly Stream[]
  /** The event's lane's tip. */
  readonly tip: EntryId | null
  readonly running: boolean
  readonly newId: () => string
}): readonly LiveOp[] {
  const { event, tip, running } = input
  if (!running) return []
  const mine = input.streams.filter(s => s.lane === event.lane)
  switch (event.kind) {
    case "text": {
      if (event.delta.length === 0) return []
      const reply = mine.find(s => isCurrentReply(s, tip))
      if (reply !== undefined)
        return [
          {
            kind: "edit",
            id: reply.id,
            edits: [{ at: reply.text.length, remove: 0, insert: event.delta }],
          },
        ]
      const id = streamId(input.newId())
      return [
        ...closeStreams(mine),
        {
          kind: "open",
          stream: { id, lane: event.lane, kind: "reply", under: tip },
        },
        {
          kind: "edit",
          id,
          edits: [{ at: 0, remove: 0, insert: event.delta }],
        },
      ]
    }
    case "tool-start":
      return [
        ...closeStreams(
          mine.filter(s => s.kind === "reply" && !isCurrentReply(s, tip)),
        ),
        {
          kind: "open",
          stream: {
            id: streamId(input.newId()),
            lane: event.lane,
            kind: "tool",
            callId: event.callId,
          },
        },
      ]
    case "tool-output": {
      const tool = mine.find(
        s => s.kind === "tool" && s.callId === event.callId,
      )
      if (tool === undefined) return []
      const edits = tailEdit(tool.text, event.text)
      return edits.length === 0 ? [] : [{ kind: "edit", id: tool.id, edits }]
    }
  }
}

/**
 * A run ended. Its lane's streams close with its key: every entry of the run
 * is written by now, and a stopped run's may never come. A run that is
 * no longer the lane's (`running` is another, or none) changes nothing.
 */
export function planEndRun(input: {
  readonly lane: ThreadId
  readonly run: RunId
  /** The run the lane is running, as stored. */
  readonly running: RunId | undefined
  readonly streams: readonly StreamRecord[]
}): readonly LiveOp[] {
  if (input.running !== input.run) return []
  return [
    ...closeStreams(input.streams.filter(s => s.lane === input.lane)),
    { kind: "end", lane: input.lane },
  ]
}

/**
 * Nothing streams across a process: close every stream, and end every
 * running lane. A starting host does this before it drains any lane.
 */
export function planClear(input: {
  /** Every stream id stored, with a record or only a text. */
  readonly streams: readonly StreamId[]
  readonly running: readonly ThreadId[]
}): readonly LiveOp[] {
  return [
    ...closeStreams(input.streams.map(id => ({ id }))),
    ...input.running.map(lane => ({ kind: "end", lane }) as const),
  ]
}
