// pi/stream — pi's harness events as pinetrie's `StreamEvent`s. Nothing else
// of pi's events leaves this package.

import type { HarnessEvent } from "@earendil-works/pi-agent-core"
import { isThreadId } from "@pinetrie/core"
import type { StreamEvent } from "@pinetrie/threads"

/** The harness events a stream is made of. */
export const STREAM_SOURCES = [
  "message_update",
  "tool_start",
  "tool_update",
] as const

export type StreamSource = Extract<
  HarnessEvent,
  { type: (typeof STREAM_SOURCES)[number] }
>

/** A tool's partial result -> its text: the first text part, or "". */
function firstText(result: unknown): string {
  const content = (result as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return ""
  const part = content.find(
    (c): c is { type: "text"; text: string } =>
      (c as { type?: unknown })?.type === "text" &&
      typeof (c as { text?: unknown }).text === "string",
  )
  return part?.text ?? ""
}

/**
 * One harness event as a `StreamEvent`, or null: for an event on a lane that
 * is not a thread's, and for a message update that adds no text.
 */
export function harnessStreamEvent(event: StreamSource): StreamEvent | null {
  const lane = event.lane
  if (!isThreadId(lane)) return null
  switch (event.type) {
    case "message_update": {
      const inner = event.event
      if (inner.type !== "text_delta") return null
      const delta = typeof inner.delta === "string" ? inner.delta : ""
      return delta.length > 0 ? { kind: "text", lane, delta } : null
    }
    case "tool_start":
      return { kind: "tool-start", lane, callId: event.toolCallId }
    case "tool_update":
      return {
        kind: "tool-output",
        lane,
        callId: event.toolCallId,
        text: firstText(event.partialResult),
      }
  }
}
