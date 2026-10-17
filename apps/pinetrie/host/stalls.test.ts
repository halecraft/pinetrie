import { expect, test } from "vitest"
import { checkStalls, type DelayHistogram, stallToReport } from "./stalls.ts"

const ms = (n: number) => n * 1e6

/** A histogram whose `max` is set by the test, counting its resets. */
const histogram = (maxMs: number) => {
  const h = {
    max: ms(maxMs),
    resets: 0,
    reset() {
      h.resets++
      h.max = 0
    },
  } satisfies DelayHistogram & { resets: number }
  return h
}

test("a stall is the longest sample less the sampling interval", () => {
  expect(
    stallToReport({ maxNs: ms(2_820), resolutionMs: 20, thresholdMs: 500 }),
  ).toBe(2_800)
})

test("a stall under the threshold is not reported", () => {
  expect(
    stallToReport({ maxNs: ms(510), resolutionMs: 20, thresholdMs: 500 }),
  ).toBeNull()
})

test("a reported stall is logged once, and the histogram cleared", () => {
  const h = histogram(2_820)
  const lines: string[] = []
  checkStalls(h, l => lines.push(l))
  checkStalls(h, l => lines.push(l))
  expect(lines).toEqual([
    "[host] the event loop stalled for 2800 ms: anything the host awaited meanwhile, a command among them, was timed that much longer",
  ])
  expect(h.resets).toBe(1)
})

test("a check that finds no stall leaves the histogram as it is", () => {
  const h = histogram(25)
  checkStalls(h, () => {})
  expect(h.resets).toBe(0)
})
