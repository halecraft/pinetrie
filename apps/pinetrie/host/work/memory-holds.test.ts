import { threadIdFor } from "@pinetrie/core"
import { KeeperClosed } from "@pinetrie/keeper"
import { createQueue } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { createStartHolds, settledOrAborted } from "./memory-holds.ts"

const lane = threadIdFor("t-1")

/** A machine that lets nothing through until `allow`, rejecting each wait on its signal's abort. */
function heldMachine() {
  const waits: { resolve: () => void }[] = []
  const noted: unknown[] = []
  return {
    waits,
    noted,
    noteRunStarted: (l: unknown) => void noted.push(l),
    isLaneActivityAllowed: () => false,
    allow: () => {
      for (const w of waits.splice(0)) w.resolve()
    },
    waitUntilAllowed: (
      _lane: unknown,
      _activity: unknown,
      signal: AbortSignal | undefined,
    ) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason)
        waits.push({ resolve })
        signal?.addEventListener("abort", () => reject(signal.reason))
      }),
  }
}

test("a held start its run's end aborts starts nothing, and the queue's next step runs", async () => {
  const machine = heldMachine()
  const holds = createStartHolds(machine)
  const queue = createQueue()
  const did: string[] = []
  const startWhenAllowed = holds.holdStart(lane, "wait")
  const start = queue.enqueue(
    () => startWhenAllowed(async () => void did.push("start")),
    { fatal: true },
  )
  const stop = queue.enqueue(async () => void did.push("stop"))
  holds.abandon(lane)
  await start
  await stop
  expect(did).toEqual(["stop"])
  await expect(queue.idle()).resolves.toBeUndefined()
})

test("a held start starts once the machine allows it", async () => {
  const machine = heldMachine()
  const holds = createStartHolds(machine)
  const did: string[] = []
  const started = holds.holdStart(
    lane,
    "wait",
  )(async () => void did.push("start"))
  await Promise.resolve()
  expect(did).toEqual([])
  machine.allow()
  await started
  expect(did).toEqual(["start"])
})

test("a start asked again aborts the last one's wait", async () => {
  const machine = heldMachine()
  const holds = createStartHolds(machine)
  const did: string[] = []
  const first = holds.holdStart(
    lane,
    "wait",
  )(async () => void did.push("first"))
  const second = holds.holdStart(lane, "wait")
  await first
  expect(did).toEqual([])
  const run = second(async () => void did.push("second"))
  machine.allow()
  await run
  expect(did).toEqual(["second"])
})

test("a start the host's close refuses starts nothing, and is no failure", async () => {
  const holds = createStartHolds({
    waitUntilAllowed: () => Promise.reject(new KeeperClosed()),
    isLaneActivityAllowed: () => false,
    noteRunStarted: () => {},
  })
  const did: string[] = []
  await holds.holdStart(lane, "wait")(async () => void did.push("start"))
  expect(did).toEqual([])
})

test("a call waiting behind a held start settles on its abort", async () => {
  const machine = heldMachine()
  const holds = createStartHolds(machine)
  const queue = createQueue()
  const startWhenAllowed = holds.holdStart(lane, "wait")
  void queue.enqueue(() => startWhenAllowed(async () => {}))
  const call = new AbortController()
  const gate = settledOrAborted(queue.idle(), call.signal)
  call.abort(new Error("stopped"))
  await expect(gate).rejects.toThrow("stopped")
  holds.close()
})

test("a refusing start the machine holds starts nothing, answers start-held, and leaves the queue open", async () => {
  const machine = heldMachine()
  const holds = createStartHolds(machine)
  const queue = createQueue()
  const did: string[] = []
  const startIfAllowed = holds.holdStart(lane, "refuse")
  const answer = await queue.enqueue(
    () => startIfAllowed(async () => void did.push("start")),
    { fatal: true },
  )
  await queue.enqueue(async () => void did.push("next"))
  expect([answer, did]).toEqual(["start-held", ["next"]])
})

test("a refusing start notes its run started only once allowed, and a waiting one at once", () => {
  const machine = heldMachine()
  const holds = createStartHolds(machine)
  void holds.holdStart(lane, "refuse")(async () => {})
  expect(machine.noted).toEqual([])
  void holds.holdStart(lane, "wait")
  expect(machine.noted).toEqual([lane])
  holds.close()
})

test("a refusing start the machine allows starts", async () => {
  const holds = createStartHolds({
    ...heldMachine(),
    isLaneActivityAllowed: () => true,
  })
  const did: string[] = []
  const answer = await holds.holdStart(
    lane,
    "refuse",
  )(async () => void did.push("start"))
  expect([answer, did]).toEqual(["started", ["start"]])
})
