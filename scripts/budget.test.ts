import path from "node:path"
import { expect, test } from "vitest"
import { budgetBreaches, countLayers } from "./budget.ts"

test.each([
  [{ unit: 900, acceptance: 30, browser: 5 }, 0],
  [{ unit: 900, acceptance: 31, browser: 5 }, 1],
  [{ unit: 900, acceptance: 30, browser: 6 }, 1],
  [{ unit: 0, acceptance: 1, browser: 2 }, 2],
])("budgetBreaches(%o) finds %d breaches", (counts, n) => {
  expect(budgetBreaches(counts)).toHaveLength(n)
})

test("the repository keeps to its budget", async () => {
  const counts = await countLayers(path.join(import.meta.dirname, ".."))
  expect(counts.unit).toBeGreaterThan(500)
  expect(budgetBreaches(counts)).toEqual([])
})
