import { expect, test } from "vitest"
import { type Endable, keepLease } from "./keep.ts"

/** A lease that ends when `end` is called. */
function fakeLease(name: string) {
  let end: () => void = () => {}
  const ended = new Promise<void>(r => {
    end = r
  })
  let closed = false
  return {
    name,
    ended,
    end: () => end(),
    closed: () => closed,
    close: async () => {
      closed = true
    },
  } satisfies Endable & Record<string, unknown>
}
const tick = () => new Promise(r => setTimeout(r, 0))

test("a lease that ends is leased again and settled; the new one is held", async () => {
  const first = fakeLease("first")
  const second = fakeLease("second")
  const settled: string[] = []
  const kept = keepLease({
    first,
    lease: async () => second,
    settle: async l => {
      settled.push(l.name)
    },
    log: () => {},
  })
  first.end()
  for (let i = 0; i < 5; i++) await tick()
  expect(settled).toEqual(["second"])
  expect(kept.current()).toBe(second)
})

test("a failed lease is tried again, after a wait that doubles", async () => {
  const first = fakeLease("first")
  const third = fakeLease("third")
  let calls = 0
  const waits: number[] = []
  const kept = keepLease({
    first,
    lease: async () => {
      calls += 1
      if (calls < 3) throw new Error("no VM yet")
      return third
    },
    settle: async () => {},
    log: () => {},
    wait: async ms => {
      waits.push(ms)
    },
  })
  first.end()
  for (let i = 0; i < 20; i++) await tick()
  expect(waits).toEqual([1000, 2000])
  expect(kept.current()).toBe(third)
})

test("after close, an end takes no new lease", async () => {
  const first = fakeLease("first")
  let calls = 0
  const kept = keepLease({
    first,
    lease: async () => {
      calls += 1
      return fakeLease("never")
    },
    settle: async () => {},
    log: () => {},
  })
  await kept.close()
  first.end()
  for (let i = 0; i < 5; i++) await tick()
  expect(first.closed()).toBe(true)
  expect(calls).toBe(0)
})
