import {
  BASE_SNAPSHOT,
  commitId,
  type SnapshotId,
  snapshotId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { deferred } from "../fakes.ts"
import { forkFacts } from "./create.ts"

test("forkFacts reads nothing before every pending turn record is written", async () => {
  const pending = deferred<void>()
  const read: string[] = []
  const facts = forkFacts({
    pendingRecords: () => pending.promise,
    exists: async () => true,
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

test("forkFacts asks whether the snapshot above is still there, and not of the base's (ADR-0124)", async () => {
  const asked: string[] = []
  const facts = (snapshot: SnapshotId | null) =>
    forkFacts({
      pendingRecords: async () => {},
      nearest: () => ({ lane: null, commit: null, commitLane: null, snapshot }),
      begin: async () => ({
        kind: "accepted",
        acceptedBookmark: "pinetrie-accepted",
        commit: commitId("aaaa0000"),
      }),
      exists: async id => {
        asked.push(id)
        return false
      },
    })
  expect(await facts(snapshotId("s-1"))).toMatchObject({ kept: false })
  expect(await facts(BASE_SNAPSHOT)).toMatchObject({ kept: true })
  expect(await facts(null)).toMatchObject({ kept: true })
  expect(asked).toEqual(["s-1"])
})
