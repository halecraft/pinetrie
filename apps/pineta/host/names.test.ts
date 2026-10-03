import { laneNameForThread } from "@pineta/core"
import type { Agent } from "@pineta/pi"
import { writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import { applyWrites, basics, record, writesOf } from "./fakes.ts"
import { createNames } from "./names.ts"

test("two ensures called together write each lane's name once, and no two lanes get one name", async () => {
  const b = basics()
  const lanes = [laneNameForThread("a"), laneNameForThread("b")]
  for (const lane of lanes) writeLaneTip(b.doc, lane, null)
  const agent = record<Pick<Agent, "writeValues">>({
    // Written a moment later, as the agent's storage does: a second plan made
    // meanwhile would not see it.
    writeValues: async writes => {
      await new Promise(done => setTimeout(done, 5))
      applyWrites(b.doc, writes)
    },
  })
  const named: string[] = []
  const names = createNames({
    basics: b,
    agent: agent.port,
    onNamed: lane => named.push(lane),
  })
  await Promise.all([names.ensure(), names.ensure()])
  const written = writesOf(agent.calls)
  expect(written).toHaveLength(2)
  const given = written.map(w =>
    w.kind === "set" ? (w.value as { name: string }).name : null,
  )
  expect(new Set(given).size).toBe(2)
  expect(named.sort()).toEqual([...lanes].sort())
})

test("a reservation is named on the same queue as new lanes, and starts its banner (ADR-0057)", async () => {
  const b = basics()
  const lane = laneNameForThread("a")
  const reserved = laneNameForThread("r")
  writeLaneTip(b.doc, lane, null)
  const agent = record<Pick<Agent, "writeValues">>({
    writeValues: async writes => {
      await new Promise(done => setTimeout(done, 5))
      applyWrites(b.doc, writes)
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
  const written = writesOf(agent.calls)
  const all = written.map(w =>
    w.kind === "set" ? (w.value as { name: string }).name : null,
  )
  expect(new Set(all).size).toBe(2)
  expect(named.sort()).toEqual([lane, reserved].sort())
  // A lane pi holds, not yet named, is no thread to come.
  const other = laneNameForThread("b")
  writeLaneTip(b.doc, other, null)
  expect(await names.reserve(other)).toBe("held")
})
