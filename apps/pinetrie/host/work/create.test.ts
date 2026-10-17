import {
  BASE_SNAPSHOT,
  pointId,
  type SnapshotId,
  snapshotId,
  threadIdFor,
} from "@pinetrie/core"
import {
  executeFork,
  type ForkSteps,
  type LaneRuntime,
  recordedStart,
} from "@pinetrie/lanes"
import { LANE_FORK, setRecord } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { deferred } from "../fakes.ts"
import { forkEnd, forkFacts } from "./create.ts"

test("forkFacts reads nothing before every pending turn record is written", async () => {
  const pending = deferred<void>()
  const read: string[] = []
  const facts = forkFacts({
    pendingRecords: () => pending.promise,
    exists: async () => true,
    nearest: () => {
      read.push("nearest")
      return {
        lane: null,
        point: null,
        pointLane: null,
        snapshot: null,
        snapshotLane: null,
      }
    },
    begin: async () => {
      read.push("begin")
      return {
        kind: "accepted",
        acceptedBookmark: "pinetrie-accepted",
        point: pointId("aaaa0000"),
      }
    },
  })
  await new Promise(r => setTimeout(r, 10))
  expect(read).toEqual([])
  pending.resolve()
  await facts
  expect(read).toEqual(["nearest", "begin"])
})

test("forkFacts asks whether the snapshot above is still there, and not of the base's", async () => {
  const asked: string[] = []
  const facts = (snapshot: SnapshotId | null) =>
    forkFacts({
      pendingRecords: async () => {},
      nearest: () => ({
        lane: null,
        point: null,
        pointLane: null,
        snapshot,
        snapshotLane: null,
      }),
      begin: async () => ({
        kind: "accepted",
        acceptedBookmark: "pinetrie-accepted",
        point: pointId("aaaa0000"),
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

test("forkEnd: the history's start records, then the fork begun, its lost carried, in one write", async () => {
  const lane = threadIdFor("1")
  const forked = await executeFork(
    { lane, steps: [] } as unknown as ForkSteps,
    {
      runtime: {} as LaneRuntime,
      lane: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
      laneBytes: async () => {
        throw new Error("no bytes")
      },
    },
  )
  const start = setRecord(LANE_FORK, { lane, base: null, state: "owed" })
  const writes = forkEnd({
    fork: { lane, base: "wip", state: "owed" },
    lost: snapshotId("e1"),
    forked,
    start: recordedStart([start]),
  })
  expect(writes.map(w => ("value" in w ? w.value : null))).toEqual([
    start.value,
    { base: "wip", state: "begun", lost: "e1" },
  ])
})
