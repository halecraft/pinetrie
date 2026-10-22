import { expect, test } from "vitest"
import {
  checkStalls,
  type DelayHistogram,
  type Stall,
  stallToReport,
  stallWords,
} from "./stalls.ts"

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

/** The lines a log listener would write. */
const logging = (lines: string[]) => [(s: Stall) => lines.push(stallWords(s))]

test("a reported stall is logged once, and the histogram cleared", () => {
  const h = histogram(2_820)
  const lines: string[] = []
  checkStalls(h, logging(lines), 2_900)
  checkStalls(h, logging(lines), 0)
  expect(lines).toEqual([
    "[host] the event loop stalled for 2800 ms, 2800 ms of it on the CPU: anything the host awaited meanwhile, a command among them, was timed that much longer",
  ])
  expect(h.resets).toBe(1)
})

test("a check that finds no stall leaves the histogram as it is", () => {
  const h = histogram(25)
  checkStalls(h, [() => {}], 900)
  expect(h.resets).toBe(0)
})

test("a stall spent off the CPU is told as a pause, not as work", () => {
  const lines: string[] = []
  checkStalls(histogram(1_042_066), logging(lines), 3)
  expect(lines).toEqual([
    "[host] the host was paused for 1042046 ms, 3 ms of it on the CPU: the machine slept, or a synchronous call waited",
  ])
})

test("every listener hears each stall, and the histogram is cleared once", () => {
  const h = histogram(1_520)
  const heard: [string, number][] = []
  checkStalls(
    h,
    [s => heard.push(["log", s.ms]), s => heard.push(["machine", s.ms])],
    100,
  )
  expect(heard).toEqual([
    ["log", 1_500],
    ["machine", 1_500],
  ])
  expect(h.resets).toBe(1)
})
