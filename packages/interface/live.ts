// interface/live — which streams a column draws, read in one moment.
//
// A stream is drawn until the entry that replaces it is on screen, and goes in
// the same render. A reply is drawn while it is its lane's current reply
// (`isCurrentReply`, the host's own rule): its entry moves the lane's tip. A
// tool's stream is drawn by its call's row, which stops drawing it once the row
// has a result.

import type { AgentRun, StreamId, StreamRecord, ToolCall } from "@pinetrie/core"
import { isCurrentReply } from "@pinetrie/rules"

export interface LiveWork {
  /** Each running lane's current reply: at most one per lane. */
  readonly replies: ReadonlyMap<string, StreamRecord>
  /** Each tool stream of a running lane, its id by its call's id. */
  readonly tools: ReadonlyMap<string, StreamId>
}

export function liveWork(
  streams: readonly StreamRecord[],
  running: readonly AgentRun[],
): LiveWork {
  const tips = new Map(running.map(r => [r.lane as string, r.tip]))
  const replies = new Map<string, StreamRecord>()
  const tools = new Map<string, StreamId>()
  for (const s of streams) {
    const tip = tips.get(s.lane)
    if (tip === undefined) continue
    if (s.kind === "tool") tools.set(s.callId, s.id)
    else if (isCurrentReply(s, tip)) replies.set(s.lane, s)
  }
  return { replies, tools }
}

/**
 * A message's own running calls' streams, by call id: plain data, so a message
 * compared by value (`sameMessageProps`) redraws only when one of its own
 * calls starts or stops streaming.
 */
export function callStreams(
  calls: readonly ToolCall[] | undefined,
  tools: LiveWork["tools"],
): Readonly<Record<string, StreamId>> {
  const out: Record<string, StreamId> = {}
  for (const call of calls ?? []) {
    const stream = tools.get(call.id)
    if (stream !== undefined) out[call.id] = stream
  }
  return out
}
