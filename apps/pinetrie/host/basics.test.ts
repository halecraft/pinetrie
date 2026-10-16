import { threadIdFor } from "@pinetrie/core"
import { KeeperClosed } from "@pinetrie/keeper"
import { expect, test } from "vitest"
import { failed } from "./basics.ts"
import { basics } from "./fakes.ts"

test("failed logs the host's line, with the thread when it names a lane", () => {
  const b = basics()
  const lane = threadIdFor("0123456789abcdef")
  failed(b, "compaction")(new Error("disk full"))
  failed(b, "forking", lane)("no volume")
  expect(b.lines).toEqual([
    "[host] compaction failed: disk full",
    "[host] 89abcdef: forking failed: no volume",
  ])
})

test("failed logs nothing for a step a closed keeper refused", () => {
  const b = basics()
  failed(b, "refreshing its proposed changes")(new KeeperClosed())
  expect(b.lines).toEqual([])
})
