import { laneNameForThread, runId, writerId } from "@pinetrie/core"
import { LANE, setRecord } from "@pinetrie/rules"
import { beginRun, endRun } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { basics, putValue, ROOT_ID } from "./fakes.ts"
import { hotReload, isHeld } from "./hot-reload.ts"

// Paths that do not exist, so each is its own real path.
const PINETRIE = "/nowhere/pinetrie"
const CLIENT_FILE = `${PINETRIE}/packages/client/src/App.tsx`
const OTHER = "/nowhere/my-project"
const LANE_1 = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
const RUN = runId("r-1")

test("an update waits only for a file inside a direct lane's directory", () => {
  expect(isHeld(CLIENT_FILE, [PINETRIE])).toBe(true)
  expect(isHeld(PINETRIE, [PINETRIE])).toBe(true)
  expect(isHeld(CLIENT_FILE, [])).toBe(false)
  expect(isHeld(CLIENT_FILE, [OTHER])).toBe(false)
  expect(isHeld(CLIENT_FILE, [`${PINETRIE}-2`])).toBe(false)
  expect(isHeld(`${PINETRIE}-2/a.ts`, [PINETRIE])).toBe(false)
})

/** A host's hot reload with one lane working directly in `dir`, running. */
function directLane(dir: string) {
  const b = basics()
  putValue(
    b,
    setRecord(LANE, {
      lane: LANE_1,
      root: ROOT_ID,
      work: { kind: "direct", dir },
      by: writerId("ada@example.com"),
      createdAt: 0,
    }),
  )
  beginRun(b.live, LANE_1, RUN)
  const reloads: string[] = []
  const hot = hotReload({ session: b.session, live: b.live })
  hot.attach(() => reloads.push("reload"))
  return { b, hot, reloads }
}

test("a lane working directly in another project holds none of the client's updates", () => {
  const { hot, reloads } = directLane(OTHER)
  expect(hot.plugin.handleHotUpdate({ file: CLIENT_FILE })).toBeUndefined()
  hot.runEnded()
  expect(reloads).toEqual([])
})

test("a lane working directly in pinetrie holds the client's updates until its run ends, then reloads once", () => {
  const { b, hot, reloads } = directLane(PINETRIE)
  expect(hot.plugin.handleHotUpdate({ file: CLIENT_FILE })).toEqual([])
  hot.runEnded()
  expect(reloads).toEqual([])
  endRun(b.live, LANE_1, RUN)
  expect(hot.plugin.handleHotUpdate({ file: CLIENT_FILE })).toBeUndefined()
  hot.runEnded()
  hot.runEnded()
  expect(reloads).toEqual(["reload"])
})
