import { describe, expect, test } from "vitest"
import { planCapabilities } from "./capabilities.ts"
import { planStoreSize, type StoreSizeFacts } from "./store-size.ts"

const GiB = 1024 ** 3
const GROWS = planCapabilities("lane-vm")
const SETTINGS = { max: null, leaveFree: [{ bytes: 50 * GiB }] }
/** A 256 GiB disk with 10 GiB unallocated, on a roomy volume. */
const LOW: StoreSizeFacts = {
  size: 256 * GiB,
  allocated: 246 * GiB,
  volumeFree: 1000 * GiB,
  volumeSize: 2000 * GiB,
}

describe("planStoreSize", () => {
  test("a disk under its floor grows by the larger of a quarter and 64 GiB", () => {
    expect(planStoreSize(LOW, SETTINGS, GROWS)).toBe(256 * GiB + 64 * GiB)
    const big = { ...LOW, size: 1024 * GiB, allocated: 1014 * GiB }
    expect(planStoreSize(big, SETTINGS, GROWS)).toBe(1280 * GiB)
  })

  test("a disk with room above its floor does not grow", () => {
    expect(
      planStoreSize({ ...LOW, allocated: 100 * GiB }, SETTINGS, GROWS),
    ).toBeNull()
  })

  test("it grows to at most lanes.store.max", () => {
    expect(planStoreSize(LOW, { ...SETTINGS, max: 280 * GiB }, GROWS)).toBe(
      280 * GiB,
    )
  })

  test("it grows to at most what the volume gives while keeping lanes.store.leaveFree", () => {
    const tight = { ...LOW, volumeFree: 80 * GiB }
    expect(planStoreSize(tight, SETTINGS, GROWS)).toBe(
      246 * GiB + 80 * GiB - 50 * GiB,
    )
  })

  test("it never shrinks a disk", () => {
    expect(
      planStoreSize(LOW, { ...SETTINGS, max: 200 * GiB }, GROWS),
    ).toBeNull()
    expect(planStoreSize({ ...LOW, volumeFree: 0 }, SETTINGS, GROWS)).toBeNull()
  })

  test("a backend that cannot grow plans nothing", () => {
    expect(
      planStoreSize(LOW, SETTINGS, planCapabilities("docker-host")),
    ).toBeNull()
  })
})
