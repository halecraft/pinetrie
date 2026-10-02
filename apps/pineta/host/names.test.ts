import { laneNameForThread } from "@pineta/core"
import { encodeWorkRecord, type WorkRecord } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putValue, record } from "./fakes.ts"
import { createNames } from "./names.ts"

test("two ensures called together write each lane's name once, and no two lanes get one name", async () => {
  const b = basics()
  const lanes = [laneNameForThread("a"), laneNameForThread("b")]
  for (const lane of lanes) writeLaneTip(b.doc, lane, null)
  const agent = record<Pick<Agent, "setWorkRecord">>({
    // Written a moment later, as the agent's storage does: a second plan made
    // meanwhile would not see it.
    setWorkRecord: async (r: WorkRecord) => {
      await new Promise(done => setTimeout(done, 5))
      putValue(b.doc, encodeWorkRecord(r))
    },
  })
  const named: string[] = []
  const names = createNames({
    basics: b,
    agent: agent.port,
    onNamed: lane => named.push(lane),
  })
  await Promise.all([names.ensure(), names.ensure()])
  const written = agent.calls.map(c => c.args[0] as WorkRecord)
  expect(written).toHaveLength(2)
  const given = written.map(r => (r.kind === "name" ? r.record.name : ""))
  expect(new Set(given).size).toBe(2)
  expect(named.sort()).toEqual([...lanes].sort())
})

test("a reservation is named on the same queue as new lanes, and starts its banner (ADR-0057)", async () => {
  const b = basics()
  const lane = laneNameForThread("a")
  const reserved = laneNameForThread("r")
  writeLaneTip(b.doc, lane, null)
  const agent = record<Pick<Agent, "setWorkRecord">>({
    setWorkRecord: async (r: WorkRecord) => {
      await new Promise(done => setTimeout(done, 5))
      putValue(b.doc, encodeWorkRecord(r))
    },
  })
  const named: string[] = []
  const names = createNames({
    basics: b,
    agent: agent.port,
    onNamed: l => named.push(l),
  })
  const [, first, again, held] = await Promise.all([
    names.ensure(),
    names.reserve(reserved),
    names.reserve(reserved),
    names.reserve(lane),
  ])
  expect([first, again, held]).toEqual(["name", "known", "known"])
  const written = agent.calls.map(c => c.args[0] as WorkRecord)
  const all = written.map(r => (r.kind === "name" ? r.record.name : ""))
  expect(new Set(all).size).toBe(2)
  expect(named.sort()).toEqual([lane, reserved].sort())
  // A lane pi holds, not yet named, is no thread to come.
  const other = laneNameForThread("b")
  writeLaneTip(b.doc, other, null)
  expect(await names.reserve(other)).toBe("held")
})
