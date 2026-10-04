import { entryId, laneNameForThread, runId, writerId } from "@pineta/core"
import { STOP, setRecord } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { beginRun, writeEntry, writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import {
  basics,
  fakeLane,
  methods,
  putValue,
  ROOT_ID,
  record,
  row,
} from "../fakes.ts"
import { handleStop } from "./lane.ts"

const ada = writerId("ada@example.com")
const bea = writerId("bea@example.com")

/** A lane running an ask: Ada's prompt `e-1`, the agent's `e-2`. */
function running() {
  const b = basics()
  const lane = laneNameForThread("0123456789abcdef")
  writeEntry(b.root, row(entryId("e-1"), null))
  writeEntry(
    b.root,
    row(entryId("e-2"), "e-1", { role: "assistant", content: "working" }),
  )
  writeLaneTip(b.root, lane, entryId("e-2"))
  beginRun(b.live, lane, runId("r-1"))
  const handle = fakeLane(lane, { abort: async () => {} })
  const agent = record<Pick<Agent, "lane" | "writeValues">>({
    lane: () => handle.lane,
    writeValues: async () => {},
  })
  return { b, lane, handle, agent }
}

test("stopping a running lane records who stopped its ask, then aborts its run", async () => {
  const { b, lane, handle, agent } = running()
  expect(
    await handleStop(
      { basics: b, agent: agent.port, cancel: () => false },
      lane,
      ada,
    ),
  ).toEqual({ kind: "stopped" })
  expect(agent.calls).toEqual([
    {
      method: "writeValues",
      args: [
        [
          setRecord(
            STOP,
            { prompt: entryId("e-1"), by: ada, at: 1_000 },
            ROOT_ID,
          ),
        ],
      ],
    },
    { method: "lane", args: [lane] },
  ])
  expect(methods(handle.calls)).toEqual(["abort"])
})

test("a second stop of the same ask records nothing more", async () => {
  const { b, lane, handle, agent } = running()
  putValue(
    b,
    setRecord(STOP, { prompt: entryId("e-1"), by: bea, at: 1 }, ROOT_ID),
  )
  await handleStop(
    { basics: b, agent: agent.port, cancel: () => false },
    lane,
    ada,
  )
  expect(methods(agent.calls)).toEqual(["lane"])
  expect(methods(handle.calls)).toEqual(["abort"])
})

test("a stop while a chat's run waits for its pinned cards cancels it there, and asks pi to abort nothing", async () => {
  const { b, lane, handle, agent } = running()
  const cancelled: string[] = []
  await handleStop(
    {
      basics: b,
      agent: agent.port,
      cancel: l => {
        cancelled.push(l)
        return true
      },
    },
    lane,
    ada,
  )
  expect(cancelled).toEqual([lane])
  expect(methods(agent.calls)).toEqual(["writeValues"])
  expect(methods(handle.calls)).toEqual([])
})
