import { expect, test } from "vitest"
import { requestOutside } from "./outside.ts"
import { createSerial } from "./queue.ts"

test("requestOutside: holds its key while out, settles inside the queue, and logs a failure, leaving the set empty", async () => {
  const serial = createSerial()
  const set = new Set<string>()
  const settled: string[] = []
  const failures: unknown[] = []
  const answer = Promise.withResolvers<string>()
  const done = requestOutside({
    serial,
    held: { set, key: "a" },
    request: () => answer.promise,
    settle: async a => {
      settled.push(a)
    },
    failed: e => failures.push(e),
  })
  expect(set.has("a")).toBe(true)
  answer.resolve("written")
  await done
  expect([settled, set.size]).toEqual([["written"], 0])

  await requestOutside({
    serial,
    held: { set, key: "b" },
    request: async () => {
      throw new Error("no key")
    },
    settle: async () => {},
    failed: e => failures.push(e),
  })
  expect([failures.length, set.size]).toEqual([1, 0])

  await requestOutside({
    serial,
    request: async () => null,
    settle: async a => {
      settled.push(String(a))
    },
    failed: e => failures.push(e),
  })
  expect(settled).toEqual(["written"])
  await serial.idle()
})
