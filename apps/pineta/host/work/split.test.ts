import { commitId, laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import { record } from "../fakes.ts"
import { finishSplit } from "./split.ts"

test("a split's end fetches the stack before stackEnded, then moves the lane back to its own tip", async () => {
  const lane = laneNameForThread("0123456789abcdef")
  const [start, tip, top] = [
    commitId("aaaa0000"),
    commitId("bbbb0000"),
    commitId("cccc0000"),
  ]
  const order: string[] = []
  const ports = record<Parameters<typeof finishSplit>[0]>({
    fetchLane: async (_l, have, stack) => {
      order.push(`fetch ${have.join(",")} ${stack === true ? "stack" : "tip"}`)
    },
    stackTop: async () => {
      order.push("top")
      return top
    },
    stackEnded: async (_l, s) => {
      order.push(`ended ${s.top}`)
      return null
    },
    backToTip: async () => {
      order.push("back")
    },
  })
  expect(
    await finishSplit(ports.port, lane, { start: [start], tip }),
  ).toBeNull()
  expect(order).toEqual([
    `fetch ${tip},${start} stack`,
    "top",
    `ended ${top}`,
    "back",
  ])
})
