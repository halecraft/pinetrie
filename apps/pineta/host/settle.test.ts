import { laneNameForThread } from "@pineta/core"
import { expect, test } from "vitest"
import { basics, deferred } from "./fakes.ts"
import { createSerial } from "./queue.ts"
import { createSettle } from "./settle.ts"

test("a settle asked for before the last compaction started drains, and compacts no more", async () => {
  const [a, b] = [laneNameForThread("a"), laneNameForThread("b")]
  const serial = createSerial()
  const done: string[] = []
  const settle = createSettle({
    basics: basics(),
    serial,
    drain: async lane => {
      done.push(`drain ${lane}`)
    },
    compact: async () => {
      done.push("compact")
    },
    sweep: async () => {
      done.push("sweep")
    },
  })
  // Hold the queue, so both are asked for before either starts.
  const gate = deferred<void>()
  void serial.run(() => gate.promise)
  const first = settle([a])
  const second = settle([b])
  gate.resolve()
  await Promise.all([first, second])
  expect(done).toEqual([`drain ${a}`, "compact", "sweep", `drain ${b}`])
})

test("a failed compaction is logged, and the sweep still runs", async () => {
  const b = basics()
  const done: string[] = []
  const settle = createSettle({
    basics: b,
    serial: createSerial(),
    drain: async () => {},
    compact: async () => {
      throw new Error("store closed")
    },
    sweep: async () => {
      done.push("sweep")
    },
  })
  await settle([])
  expect(done).toEqual(["sweep"])
  expect(b.lines).toEqual(["[host] compaction failed: store closed"])
})
