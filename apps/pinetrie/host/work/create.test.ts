import { commitId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { deferred } from "../fakes.ts"
import { forkFacts } from "./create.ts"

test("forkFacts reads nothing before every pending turn record is written", async () => {
  const pending = deferred<void>()
  const read: string[] = []
  const facts = forkFacts({
    pendingRecords: () => pending.promise,
    nearest: () => {
      read.push("nearest")
      return { lane: null, commit: null, commitLane: null, snapshot: null }
    },
    begin: async () => {
      read.push("begin")
      return {
        kind: "accepted",
        acceptedBookmark: "pinetrie-accepted",
        commit: commitId("aaaa0000"),
      }
    },
  })
  await new Promise(r => setTimeout(r, 10))
  expect(read).toEqual([])
  pending.resolve()
  await facts
  expect(read).toEqual(["nearest", "begin"])
})
