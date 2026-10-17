import {
  type LaneRecord,
  type ProjectKind,
  rootIdFor,
  snapshotId,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { LANE_FORK } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { planLaneForks } from "./0023-lane-forks.ts"

const lane = (id: string, history: ProjectKind | null): LaneRecord => ({
  lane: threadIdFor(id),
  root: rootIdFor("r"),
  history,
  by: writerId("ada@x.io"),
  createdAt: 0,
})
const none = new Set<ThreadId>()
const plan = (input: Partial<Parameters<typeof planLaneForks>[0]>) =>
  planLaneForks({
    lanes: new Map(),
    forks: none,
    recorded: none,
    started: none,
    lost: new Map(),
    ...input,
  })

test("a recorded lane and a folder lane with a start state are begun, a files-lost snapshot their lost; any other is owed", () => {
  const recorded = lane("a", "jj")
  const started = lane("b", "folder")
  const neither = lane("c", "jj")
  const writes = plan({
    lanes: new Map([recorded, started, neither].map(r => [r.lane, r])),
    recorded: new Set([recorded.lane]),
    started: new Set([started.lane]),
    lost: new Map([[recorded.lane, snapshotId("e1")]]),
  })
  expect(
    writes.map(w => [w.namespace, w.key, "value" in w && w.value]),
  ).toEqual([
    [
      LANE_FORK.namespace,
      recorded.lane,
      { base: null, state: "begun", lost: "e1" },
    ],
    [
      LANE_FORK.namespace,
      started.lane,
      { base: null, state: "begun", lost: null },
    ],
    [LANE_FORK.namespace, neither.lane, { base: null, state: "owed" }],
  ])
})

test("a lane with a fork record, or with no copy of its own, gets none", () => {
  const forked = lane("a", "jj")
  const noCopy = lane("b", null)
  expect(
    plan({
      lanes: new Map([forked, noCopy].map(r => [r.lane, r])),
      forks: new Set([forked.lane]),
    }),
  ).toEqual([])
})
