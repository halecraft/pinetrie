import { expect, test } from "vitest"
import { createStepTimes } from "./step-times.ts"

/** A clock the test moves, and a part that takes `ms` of it. */
function clocked() {
  let t = 0
  const times = createStepTimes(() => t)
  const takes = (ms: number) => async () => {
    t += ms
  }
  return { times, takes }
}

test("a part's time leaves out the parts inside it", async () => {
  const { times, takes } = clocked()
  await times.part("outer", async () => {
    await takes(5)()
    await times.part("inner", takes(30))
    await takes(5)()
  })
  expect(times.split().parts).toEqual([
    { name: "outer", ms: 10 },
    { name: "inner", ms: 30 },
  ])
})

test("a name entered twice adds up, in the order first entered", async () => {
  const { times, takes } = clocked()
  await times.part("b", takes(1))
  await times.part("a", takes(2))
  await times.part("b", takes(3))
  expect(times.split().parts).toEqual([
    { name: "b", ms: 4 },
    { name: "a", ms: 2 },
  ])
})

test("a part that throws is timed", async () => {
  const { times, takes } = clocked()
  await expect(
    times.part("failing", async () => {
      await takes(7)()
      throw new Error("no")
    }),
  ).rejects.toThrow("no")
  expect(times.split().parts).toEqual([{ name: "failing", ms: 7 }])
})

test("commands are counted with their time together", () => {
  const { times } = clocked()
  times.command(12)
  times.command(30)
  expect(times.split().commands).toEqual({ count: 2, ms: 42 })
})
