import { laneNameForThread, rootIdFor } from "@pineta/core"
import { readThreadName } from "@pineta/reads"
import { expect, test } from "vitest"
import { basics, deferred } from "./fakes.ts"
import { createSerial } from "./queue.ts"
import { createSettle } from "./settle.ts"

test("a settle asked for before the last compaction started drains, and compacts no more, its lanes' roots among the first's", async () => {
  const [a, b] = [laneNameForThread("a"), laneNameForThread("b")]
  const roots = new Map([
    [a, rootIdFor("ra")],
    [b, rootIdFor("rb")],
  ])
  const serial = createSerial()
  const done: string[] = []
  const settle = createSettle({
    basics: basics(),
    serial,
    drain: async lane => {
      done.push(`drain ${lane}`)
    },
    rootOf: lane => roots.get(lane) ?? null,
    beforeCompact: async () => {},
    compact: async covered => {
      done.push(`compact ${[...covered].sort().join(" ")}`)
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
  expect(done).toEqual([
    `drain ${a}`,
    "compact r-ra r-rb",
    "sweep",
    `drain ${b}`,
  ])
})

test("a failed compaction is logged, and the sweep still runs", async () => {
  const b = basics()
  const done: string[] = []
  const settle = createSettle({
    basics: b,
    serial: createSerial(),
    drain: async () => {},
    rootOf: () => null,
    beforeCompact: async () => {},
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

test("a failed drain is logged; the other lanes drain, and the next settle compacts", async () => {
  const [a, b] = [laneNameForThread("a"), laneNameForThread("b")]
  const bs = basics()
  const done: string[] = []
  const settle = createSettle({
    basics: bs,
    serial: createSerial(),
    drain: async lane => {
      if (lane === a) throw new Error("append refused")
      done.push(`drain ${lane}`)
    },
    rootOf: () => null,
    beforeCompact: async () => {},
    compact: async () => {
      done.push("compact")
    },
    sweep: async () => {
      done.push("sweep")
    },
  })
  await settle([a, b])
  await settle([])
  expect(done).toEqual([`drain ${b}`, "compact", "sweep", "compact", "sweep"])
  expect(bs.lines).toEqual([
    `[host] ${readThreadName(bs.session, a)}: draining failed: append refused`,
  ])
})
