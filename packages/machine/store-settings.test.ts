import { expect, test } from "vitest"
import {
  LEAVE_FREE_DEFAULT,
  leaveFreeBytes,
  minimumUnallocated,
} from "./store-settings.ts"

const GiB = 1024 ** 3

test("the default leaves 50 GiB of a small filesystem, and 10% of a large one", () => {
  const settings = { leaveFree: LEAVE_FREE_DEFAULT }
  expect(leaveFreeBytes(settings, 250 * GiB)).toBe(50 * GiB)
  expect(leaveFreeBytes(settings, 2000 * GiB)).toBe(200 * GiB)
})

test("the largest of every amount set holds", () => {
  const settings = { leaveFree: [{ percent: 5 }, { bytes: 20 * GiB }] }
  expect(leaveFreeBytes(settings, 100 * GiB)).toBe(20 * GiB)
  expect(leaveFreeBytes(settings, 1000 * GiB)).toBe(50 * GiB)
  expect(leaveFreeBytes({ leaveFree: [] }, 1000 * GiB)).toBe(0)
})

test("the store's minimum unallocated is 10% of it, and 8 GiB at least", () => {
  expect(minimumUnallocated(40 * GiB)).toBe(8 * GiB)
  expect(minimumUnallocated(400 * GiB)).toBe(40 * GiB)
})
