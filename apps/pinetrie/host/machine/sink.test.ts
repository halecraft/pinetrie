import type { MachineHealth } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { WAITING } from "@pinetrie/machine"
import { newSessionDoc } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import type { HostKey } from "../basics.ts"
import type { StepDocs } from "../roots.ts"
import { createHealthSink } from "./sink.ts"

const health = (count: number): MachineHealth => ({
  state: "amber",
  causes: [{ kind: "snapshot-skipped", count }],
  treatments: [],
})

/** A sink over a documents' keeper held by a step until `release`. */
function heldSink(refuse = false) {
  // No step reads its context.
  const keeper = createKeeper<HostKey, StepDocs>()
  const held = Promise.withResolvers<void>()
  void keeper.run(() => held.promise)
  const writes: unknown[] = []
  const unwritten: string[] = []
  const sink = createHealthSink({
    session: newSessionDoc(),
    keeper,
    records: {
      writeValues: async values => {
        if (refuse) throw new Error("the session is closed")
        writes.push(values)
      },
    },
    onUnwritten: error => unwritten.push(error),
  })
  return { sink, writes, unwritten, release: () => held.resolve() }
}

test("writes asked while the documents' keeper is held land as one write of the last", async () => {
  const { sink, writes, release } = heldSink()
  sink.write(WAITING)
  sink.write(health(1))
  sink.write(health(2))
  release()
  await sink.writesFlushed()
  expect(writes).toHaveLength(1)
  expect(JSON.stringify(writes[0])).toContain('"count":2')
})

test("a refused write is told once", async () => {
  const { sink, unwritten, release } = heldSink(true)
  sink.write(health(1))
  sink.write(health(2))
  release()
  await sink.writesFlushed()
  expect(unwritten).toEqual(["the session is closed"])
})
