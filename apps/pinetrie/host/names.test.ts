import { threadIdFor, writerId } from "@pinetrie/core"
import { readNames } from "@pinetrie/reads"
import { setRecord, THREAD } from "@pinetrie/rules"
import { expect, test } from "vitest"
import {
  applyWrites,
  basics,
  putLane,
  ROOT_ID,
  record,
  writesOf,
} from "./fakes.ts"
import { createNames } from "./names.ts"
import type { Records } from "./records.ts"

test("two ensures called together write each lane's name once, and no two lanes get one name", async () => {
  const b = basics()
  const lanes = [threadIdFor("a"), threadIdFor("b")]
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
  const lane = threadIdFor("a")
  const reserved = threadIdFor("r")
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
  const other = threadIdFor("b")
  putLane(b, other)
  expect(await names.reserve(other)).toBe("held")
})

test("a conversation thread is named as a lane is, and draws no banner: every thread has a name (ADR-0117)", async () => {
  const b = basics()
  const thread = threadIdFor("conversation")
  applyWrites(b, [
    setRecord(THREAD, {
      thread,
      root: ROOT_ID,
      by: writerId("ada@x.io"),
      createdAt: 1,
      origin: { kind: "root" },
    }),
  ])
  const scribe = record<Pick<Records, "writeValues">>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const named: string[] = []
  const names = createNames({
    basics: b,
    records: scribe.port,
    onNamed: lane => named.push(lane),
  })
  await names.ensure()
  expect(readNames(b.session).has(thread)).toBe(true)
  expect(named).toEqual([])
})
