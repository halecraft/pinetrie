import { entryId, laneNameForThread, runId, writerId } from "@pineta/core"
import { encodeStop, STOP_NAMESPACE } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { beginRun, writeEntry, writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, fakeLane, methods, putValue, record, row } from "../fakes.ts"
import { handleStop } from "./lane.ts"

const ada = writerId("ada@example.com")
const bea = writerId("bea@example.com")

/** A lane running an ask: Ada's prompt `e-1`, the agent's `e-2`. */
function running() {
  const b = basics()
  const lane = laneNameForThread("0123456789abcdef")
  writeEntry(b.doc, row(entryId("e-1"), null))
  writeEntry(
    b.doc,
    row(entryId("e-2"), "e-1", { role: "assistant", content: "working" }),
  )
  writeLaneTip(b.doc, lane, "e-2")
  beginRun(b.doc, lane, runId("r-1"))
  const handle = fakeLane(lane, { abort: async () => {} })
  const agent = record<Pick<Agent, "lane" | "setStop">>({
    lane: () => handle.lane,
    setStop: async () => {},
  })
  return { b, lane, handle, agent }
}

test("stopping a running lane records who stopped its ask, then aborts its run", async () => {
  const { b, lane, handle, agent } = running()
  expect(await handleStop({ basics: b, agent: agent.port }, lane, ada)).toEqual(
    { kind: "stopped" },
  )
  expect(agent.calls).toEqual([
    { method: "setStop", args: ["e-1", { by: ada, at: 1_000 }] },
    { method: "lane", args: [lane] },
  ])
  expect(methods(handle.calls)).toEqual(["abort"])
})

test("a second stop of the same ask records nothing more", async () => {
  const { b, lane, handle, agent } = running()
  putValue(b.doc, {
    namespace: STOP_NAMESPACE,
    key: "e-1",
    value: encodeStop({ by: bea, at: 1 }),
  })
  await handleStop({ basics: b, agent: agent.port }, lane, ada)
  expect(methods(agent.calls)).toEqual(["lane"])
  expect(methods(handle.calls)).toEqual(["abort"])
})
