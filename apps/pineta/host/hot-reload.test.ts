import { laneNameForThread, runId, writerId } from "@pineta/core"
import { LANE, setRecord } from "@pineta/rules"
import { beginRun, endRun } from "@pineta/schema"
import { expect, test } from "vitest"
import { basics, putValue, ROOT_ID } from "./fakes.ts"
import { hotReload, isHeld } from "./hot-reload.ts"

// Paths that do not exist, so each is its own real path.
const PINETA = "/nowhere/pineta"
const CLIENT_FILE = `${PINETA}/packages/client/src/App.tsx`
const OTHER = "/nowhere/my-project"
const LANE_1 = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
const RUN = runId("r-1")

test("an update waits only for a file inside a direct lane's directory", () => {
  expect(isHeld(CLIENT_FILE, [PINETA])).toBe(true)
  expect(isHeld(PINETA, [PINETA])).toBe(true)
  expect(isHeld(CLIENT_FILE, [])).toBe(false)
  expect(isHeld(CLIENT_FILE, [OTHER])).toBe(false)
  expect(isHeld(CLIENT_FILE, [`${PINETA}-2`])).toBe(false)
  expect(isHeld(`${PINETA}-2/a.ts`, [PINETA])).toBe(false)
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

test("a lane working directly in Pineta holds the client's updates until its run ends, then reloads once", () => {
  const { b, hot, reloads } = directLane(PINETA)
  expect(hot.plugin.handleHotUpdate({ file: CLIENT_FILE })).toEqual([])
  hot.runEnded()
  expect(reloads).toEqual([])
  endRun(b.live, LANE_1, RUN)
  expect(hot.plugin.handleHotUpdate({ file: CLIENT_FILE })).toBeUndefined()
  hot.runEnded()
  hot.runEnded()
  expect(reloads).toEqual(["reload"])
})
