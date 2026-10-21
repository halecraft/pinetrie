import path from "node:path"
import { expect, test } from "vitest"
import {
  countElapsedReadings,
  countFixedWaits,
  elapsedBreaches,
  elapsedReadingsIn,
  fixedWaitBreaches,
  fixedWaitsIn,
} from "./budget.ts"

test.each([
  ["await page.waitForTimeout(500)", 1],
  ["await sleep(100)", 1],
  ["await new Promise(r => setTimeout(r, 20))", 1],
  ['{ command: "sleep 2; echo waited" }', 1],
  ['{ command: "(sleep 77.1 &) ; sleep 77.1" }', 1],
  ['{ command: "sleep 78.2 & sleep 78.2" }', 1],
  ['{ command: "make && sleep 1 && echo" }', 1],
  ["await waitFor(() => ready(), 5_000)", 0],
  ["await twoFrames(page)", 0],
  ["const asleep = sleeping(3)", 0],
])("fixedWaitsIn(%j) is %d", (source, n) => {
  expect(fixedWaitsIn(source)).toBe(n)
})

test("a scenario with more fixed waits than its entry, or fewer, breaks the list", () => {
  expect(fixedWaitBreaches({ a: 1 }, { a: 1 })).toEqual([])
  expect(fixedWaitBreaches({ a: 2 }, { a: 1 })).toHaveLength(1)
  expect(fixedWaitBreaches({}, { a: 1 })).toHaveLength(1)
  expect(fixedWaitBreaches({ b: 1 }, {})).toHaveLength(1)
})

test("each scenario holds exactly the fixed waits FIXED_WAITS allows it", () => {
  const root = path.join(import.meta.dirname, "..")
  expect(fixedWaitBreaches(countFixedWaits(root))).toEqual([])
})

// Built from variables, so this file holds no reading of its own.
const clock = "Date"
const perf = "performance"
test.each([
  [`expect(${clock}.now() - started).toBeLessThan(1500)`, 1],
  [`const took = ${perf}.now() - t`, 1],
  [`while (!ready() && ${clock}.now() < until)`, 0],
  [`tick(doc, ${clock}.now() + 500)`, 0],
])("elapsedReadingsIn(%j) is %d", (source, n) => {
  expect(elapsedReadingsIn(source)).toBe(n)
})

test("no test or scenario reads elapsed time from a clock", async () => {
  const root = path.join(import.meta.dirname, "..")
  expect(elapsedBreaches(await countElapsedReadings(root))).toEqual([])
})
