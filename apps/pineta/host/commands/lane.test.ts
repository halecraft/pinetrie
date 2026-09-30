import { entryId, laneNameForThread, runId } from "@pineta/core"
import type { Agent } from "@pineta/pi"
import { beginRun, writeEntry, writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, fakeLane, methods, record, row } from "../fakes.ts"
import { handleStop } from "./lane.ts"

test("stopping a running lane aborts its run", async () => {
  const b = basics()
  const lane = laneNameForThread("0123456789abcdef")
  writeEntry(b.doc, row(entryId("e-1"), null))
  writeLaneTip(b.doc, lane, "e-1")
  beginRun(b.doc, lane, runId("r-1"))
  const handle = fakeLane(lane, { abort: async () => {} })
  const agent = record<Pick<Agent, "hold" | "lane">>({
    lane: () => handle.lane,
  })
  expect(await handleStop({ basics: b, agent: agent.port }, lane)).toEqual({
    kind: "stopped",
  })
  expect(methods(handle.calls)).toEqual(["abort"])
})
