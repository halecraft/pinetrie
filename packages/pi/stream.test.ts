// pi's harness events as `StreamEvent`s, mapped without a harness.

import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import { type StreamSource, streamEventOf } from "./stream.ts"

const lane = laneNameForThread("0190a0a0-0000-7000-8000-000000000001")
const event = (e: object) => e as StreamSource

test("a text delta, a tool's start and its output's first text", () => {
  expect(
    streamEventOf(
      event({
        type: "message_update",
        lane,
        event: { type: "text_delta", delta: "hi" },
      }),
    ),
  ).toEqual({ kind: "text", lane, delta: "hi" })
  expect(
    streamEventOf(event({ type: "tool_start", lane, toolCallId: "c1" })),
  ).toEqual({ kind: "toolStart", lane, callId: "c1" })
  expect(
    streamEventOf(
      event({
        type: "tool_update",
        lane,
        toolCallId: "c1",
        partialResult: {
          content: [
            { type: "image", data: "" },
            { type: "text", text: "out" },
          ],
        },
      }),
    ),
  ).toEqual({ kind: "toolOutput", lane, callId: "c1", text: "out" })
})

test("nothing for an empty delta, another update, or a lane that is not a thread's", () => {
  expect(
    streamEventOf(
      event({
        type: "message_update",
        lane,
        event: { type: "text_delta", delta: "" },
      }),
    ),
  ).toBeNull()
  expect(
    streamEventOf(
      event({ type: "message_update", lane, event: { type: "text_start" } }),
    ),
  ).toBeNull()
  expect(
    streamEventOf(event({ type: "tool_start", lane: "main", toolCallId: "c" })),
  ).toBeNull()
})
