import { laneNameForThread } from "@pineta/core"
import { encodeWorkRecord, type WorkRecord } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { writeLaneTip } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putValue, record } from "./fakes.ts"
import { createNames } from "./names.ts"

test("two ensureNames called together write each lane's name once, and no two lanes get one name", async () => {
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
  const ensureNames = createNames({ basics: b, agent: agent.port })
  await Promise.all([ensureNames(), ensureNames()])
  const written = agent.calls.map(c => c.args[0] as WorkRecord)
  expect(written).toHaveLength(2)
  const names = written.map(r => (r.kind === "name" ? r.record.name : ""))
  expect(new Set(names).size).toBe(2)
})
