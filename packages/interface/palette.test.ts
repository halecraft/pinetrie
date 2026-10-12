import { newRootId, newTaskId } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { PENDING_TRACK } from "./column-paths.ts"
import { rootSeed, SLOTS, STRIDE, taskSlot, trackSlot } from "./palette.ts"

const size = SLOTS
const seeds = Array.from({ length: size }, (_, i) => i)
/** How far apart two slots are, round the palette either way. */
const apart = (a: number, b: number) =>
  Math.min((a - b + size) % size, (b - a + size) % size)

describe("rootSeed", () => {
  test("minted roots start on every slot, not all on one", () => {
    const used = new Set(
      Array.from({ length: 200 }, () => rootSeed(newRootId())),
    )
    expect(used.size).toBe(size)
  })

  test("a task's slot is seeded by its id, the same on every device", () => {
    const task = newTaskId()
    expect(taskSlot(task)).toBe(taskSlot(task))
    expect(taskSlot(task)).not.toBe("pending")
  })
})

describe("trackSlot", () => {
  test.each(
    seeds,
  )("from seed %i, the first tracks take every slot once", seed => {
    const slots = Array.from({ length: size }, (_, t) => trackSlot(seed, t))
    expect(slots[0]).toBe(seed)
    expect(new Set(slots).size).toBe(size)
  })

  test.each(
    seeds,
  )("from seed %i, neighbouring tracks are a quarter of the palette apart or more", seed => {
    for (let t = 0; t < 2 * size; t += 1) {
      const a = trackSlot(seed, t)
      const b = trackSlot(seed, t + 1)
      if (typeof a !== "number" || typeof b !== "number")
        throw new Error("a track has no slot")
      expect(apart(a, b)).toBeGreaterThanOrEqual(size / 4)
    }
  })

  test("a fresh branch is pending, whatever the seed", () => {
    expect(trackSlot(5, PENDING_TRACK)).toBe("pending")
  })

  test("the stride is coprime with the palette", () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    expect(gcd(STRIDE, size)).toBe(1)
  })
})
