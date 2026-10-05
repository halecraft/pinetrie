import { commitId, laneNameForThread, writerId } from "@pinetrie/core"
import type { PiSetup } from "@pinetrie/pi"
import type { RepoOwner } from "@pinetrie/repo"
import { expect, test } from "vitest"
import { basics, record } from "../fakes.ts"
import type { Offers } from "../offers/index.ts"
import type { LaneRegistry } from "./registry.ts"
import { createSplits, finishSplit } from "./split.ts"

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

test("a split's end that throws still moves the lane back to its tip", async () => {
  const lane = laneNameForThread("0123456789abcdef")
  const order: string[] = []
  const ports = record<Parameters<typeof finishSplit>[0]>({
    fetchLane: async () => {},
    stackTop: async () => commitId("cccc0000"),
    stackEnded: async () => {
      throw new Error("the stack's files differ")
    },
    backToTip: async () => {
      order.push("back")
    },
  })
  await expect(
    finishSplit(ports.port, lane, {
      start: [commitId("aaaa0000")],
      tip: commitId("bbbb0000"),
    }),
  ).rejects.toThrow("the stack's files differ")
  expect(order).toEqual(["back"])
})

test("a split whose skill read fails starts no container", async () => {
  const lane = laneNameForThread("0123456789abcdef")
  const started: string[] = []
  const piSetup = record<PiSetup>({
    skill: async () => {
      throw new Error("no skill")
    },
  })
  const splits = createSplits({
    basics: basics(),
    owner: record<RepoOwner>({}).port,
    registry: record<LaneRegistry>({ isOwn: () => true }).port,
    offers: record<Offers>({
      stackSpan: async () => ({
        start: [commitId("aaaa0000")],
        tip: commitId("bbbb0000"),
      }),
    }).port,
    piSetup: piSetup.port,
    beforeRun: l => {
      started.push(l)
    },
    fetchLane: async () => {},
  })
  await expect(
    splits.prepareSplit(lane, writerId("ada@example.com"), ""),
  ).rejects.toThrow("no skill")
  expect(started).toEqual([])
})
