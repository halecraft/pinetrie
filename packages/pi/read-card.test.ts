import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context"
import { threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { readCardTool } from "./read-card.ts"
import { threadContext } from "./thread-context.ts"

test("read_card's result is the host's words, then its image, which the model sees", async () => {
  const lane = threadIdFor("reads")
  const asked: unknown[] = []
  const tool = readCardTool(async (l, card, version) => {
    asked.push([l, card, version])
    return { text: "an image", image: { data: "AAAA", mimeType: "image/png" } }
  })
  const result = await tool.execute(
    "call",
    { card: "i-1", version: 2 },
    undefined,
    undefined,
    undefined,
    threadContext(lane, BACKGROUND_CONTEXT),
  )
  expect(asked).toEqual([[lane, "i-1", 2]])
  expect(result.content).toEqual([
    { type: "text", text: "an image" },
    { type: "image", data: "AAAA", mimeType: "image/png" },
  ])
})
