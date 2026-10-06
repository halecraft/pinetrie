import { laneNameForThread } from "@pinetrie/core"
import { expect, test } from "vitest"
import { applyWrites, basics, putLane, record, writesOf } from "./fakes.ts"
import { createNames } from "./names.ts"
import type { Records } from "./records.ts"

test("two ensures called together write each lane's name once, and no two lanes get one name", async () => {
  const b = basics()
  const lanes = [laneNameForThread("a"), laneNameForThread("b")]
  for (const lane of lanes) putLane(b, lane)
  const scribe = record<Pick<Records, "writeValues">>({
    // Written a moment later, as the scribe's session does: a second plan made
    // meanwhile would not see it.
    writeValues: async writes => {
      await new Promise(done => setTimeout(done, 5))
      applyWrites(b, writes)
    },
  })
  const named: string[] = []
  const names = createNames({
    basics: b,
    records: scribe.port,
    onNamed: lane => named.push(lane),
  })
  await Promise.all([names.ensure(), names.ensure()])
  const written = writesOf(scribe.calls)
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
  putLane(b, lane)
  const scribe = record<Pick<Records, "writeValues">>({
    writeValues: async writes => {
      await new Promise(done => setTimeout(done, 5))
      applyWrites(b, writes)
    },
  })
  const named: string[] = []
  const names = createNames({
    basics: b,
    records: scribe.port,
    onNamed: l => named.push(l),
  })
  const [, first, again, held] = await Promise.all([
    names.ensure(),
    names.reserve(reserved),
    names.reserve(reserved),
    names.reserve(lane),
  ])
  expect([first, again, held]).toEqual(["name", "known", "known"])
  const written = writesOf(scribe.calls)
  const all = written.map(w =>
    w.kind === "set" ? (w.value as { name: string }).name : null,
  )
  expect(new Set(all).size).toBe(2)
  expect(named.sort()).toEqual([lane, reserved].sort())
  // A lane pi holds, not yet named, is no thread to come.
  const other = laneNameForThread("b")
  putLane(b, other)
  expect(await names.reserve(other)).toBe("held")
})
