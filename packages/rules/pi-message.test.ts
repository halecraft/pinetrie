import { describe, expect, test } from "vitest"
import { renderableMessage } from "./message.ts"

const SHA = "a".repeat(64)

describe("renderableMessage: pi's own messages", () => {
  test("an assistant message keeps its text, calls and stored images, and none of its thinking", () => {
    expect(
      renderableMessage({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "Looking." },
          {
            type: "toolCall",
            id: "c1",
            name: "read",
            arguments: { path: "a" },
          },
          { type: "image", data: "iVBOR", mimeType: "image/png" },
          {
            type: "image",
            sha256: SHA,
            mimeType: "image/png",
            width: 2,
            height: 1,
          },
        ],
        stopReason: "toolUse",
        api: "x",
        timestamp: 1,
      }),
    ).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Looking." },
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
        {
          type: "image",
          sha256: SHA,
          mimeType: "image/png",
          width: 2,
          height: 1,
        },
      ],
      stopReason: "toolUse",
    })
  })

  test("a user, a system and a tool's result message keep their roles", () => {
    expect(renderableMessage({ role: "user", content: "hi" })).toEqual({
      role: "user",
      content: "hi",
    })
    expect(renderableMessage({ role: "system", content: "rules" })).toEqual({
      role: "system",
      content: "rules",
    })
    expect(
      renderableMessage({
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: 1,
      }),
    ).toEqual({
      role: "toolResult",
      content: [{ type: "text", text: "ok" }],
      toolCallId: "c1",
      isError: false,
    })
  })

  test.each<[string, unknown]>([
    ["a role pi does not write", { role: "bashExecution", command: "ls" }],
    [
      "a custom message no decoder takes",
      { role: "custom", customType: "pinetrie.older", content: "x" },
    ],
    ["a tool's result answering no call", { role: "toolResult", content: [] }],
    ["no message", undefined],
  ])("%s is no message", (_, stored) => {
    expect(renderableMessage(stored)).toBeUndefined()
  })
})
