import { threadIdFor } from "@pinetrie/core"
import { KeeperClosed } from "@pinetrie/keeper"
import { createQueue } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { createStartHolds, settledOrAborted } from "./memory-holds.ts"

const lane = threadIdFor("t-1")

/** A machine that lets nothing through until `allow`, rejecting each wait on its signal's abort. */
function heldMachine() {
  const waits: { resolve: () => void }[] = []
  return {
    waits,
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
  const startWhenAllowed = holds.holdStart(lane)
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
  const started = holds.holdStart(lane)(async () => void did.push("start"))
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
  const first = holds.holdStart(lane)(async () => void did.push("first"))
  const second = holds.holdStart(lane)
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
  })
  const did: string[] = []
  await holds.holdStart(lane)(async () => void did.push("start"))
  expect(did).toEqual([])
})

test("a call waiting behind a held start settles on its abort", async () => {
  const machine = heldMachine()
  const holds = createStartHolds(machine)
  const queue = createQueue()
  const startWhenAllowed = holds.holdStart(lane)
  void queue.enqueue(() => startWhenAllowed(async () => {}))
  const call = new AbortController()
  const gate = settledOrAborted(queue.idle(), call.signal)
  call.abort(new Error("stopped"))
  await expect(gate).rejects.toThrow("stopped")
  holds.close()
})
