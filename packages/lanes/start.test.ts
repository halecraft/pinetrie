import { snapshotId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { spec } from "./fixtures.ts"
import { planShape, shapeSpecHash } from "./shape.ts"
import {
  decideContainerStart,
  decideLaneStart,
  type LaneFactReader,
  type LaneMade,
  NOTHING_MADE,
  planContainer,
  planLaneStart,
} from "./start.ts"
import { planBindSources, planDiskThenStart, planStart } from "./steps.ts"

describe("a lane's start", () => {
  test("planContainer: create, recreate from another spec, start, or nothing", () => {
    const decide = (
      state: "running" | "stopped" | "missing",
      label: string | null,
    ) => planContainer({ facts: { state, label }, want: "h1" })
    expect(decide("missing", null)).toBe("create")
    expect(decide("stopped", "h0")).toBe("recreate")
    expect(decide("running", null)).toBe("recreate")
    expect(decide("stopped", "h1")).toBe("start")
    expect(decide("running", "h1")).toBe("running")
  })
  test("planLaneStart: a fork owed runs whatever is there", () => {
    for (const container of ["create", "recreate", "start", "running"] as const)
      expect(
        planLaneStart({ fork: "owed", container, made: NOTHING_MADE }),
      ).toEqual({ kind: "fork" })
  })

  test("planLaneStart: a begun lane's container there is started; one to make asks for its disk", () => {
    expect(
      planLaneStart({
        fork: "begun",
        container: "running",
        made: NOTHING_MADE,
      }),
    ).toEqual({ kind: "container", plan: "running" })
    expect(
      planLaneStart({ fork: "begun", container: "create", made: NOTHING_MADE }),
    ).toEqual({ kind: "gather", need: { kind: "disk" } })
  })

  describe("planLaneStart: a begun lane whose container must be made", () => {
    const [e2, e1, kept] = [
      snapshotId("e2"),
      snapshotId("e1"),
      snapshotId("turn-1"),
    ]
    const history = { own: [e2, e1], recorded: true, kept }
    const gone: LaneMade = { disk: false, history, exists: new Map() }
    const start = (m: Partial<LaneMade>, container = "create" as const) =>
      planLaneStart({ fork: "begun", container, made: { ...gone, ...m } })

    test("planLaneStart: a disk starts from it", () => {
      expect(start({ disk: true })).toEqual({ kind: "disk", recreate: false })
      expect(
        planLaneStart({
          fork: "begun",
          container: "recreate",
          made: { ...gone, disk: true },
        }),
      ).toEqual({ kind: "disk", recreate: true })
    })

    test("planLaneStart: with no disk, its history is asked for, then each snapshot newest first", () => {
      expect(start({ history: null })).toEqual({
        kind: "gather",
        need: { kind: "history" },
      })
      expect(start({})).toEqual({
        kind: "gather",
        need: { kind: "snapshot", snapshot: e2 },
      })
      expect(start({ exists: new Map([[e2, false]]) })).toEqual({
        kind: "gather",
        need: { kind: "snapshot", snapshot: e1 },
      })
    })

    test("planLaneStart: with no disk, the newest of its snapshots that exists, then its kept state's", () => {
      expect(
        start({
          exists: new Map([
            [e2, false],
            [e1, true],
          ]),
        }),
      ).toEqual({ kind: "snapshot", from: e1, recreate: false })
      expect(
        start({
          exists: new Map([
            [e2, false],
            [e1, false],
            [kept, true],
          ]),
        }),
      ).toEqual({ kind: "snapshot", from: kept, recreate: false })
    })

    test("planLaneStart: with nothing kept, a lane that recorded no turn forks again, and one that did is retired", () => {
      const none = new Map([
        [e2, false],
        [e1, false],
        [kept, false],
      ])
      expect(
        start({ history: { ...history, recorded: false }, exists: none }),
      ).toEqual({ kind: "fork" })
      expect(start({ exists: none })).toEqual({ kind: "retired" })
    })
  })

  describe("decideLaneStart: what a start reads", () => {
    const [e3, e2, e1] = [snapshotId("e3"), snapshotId("e2"), snapshotId("e1")]
    /** A reader over `disk` and the snapshots `there`, counting each read. */
    const reader = (disk: boolean, there: readonly string[]) => {
      const reads: string[] = []
      const read: LaneFactReader = {
        async disk() {
          reads.push("disk")
          return disk
        },
        async history() {
          reads.push("history")
          return { own: [e3, e2, e1], recorded: true, kept: null }
        },
        async snapshotExists(s) {
          reads.push(s)
          return there.includes(s)
        },
      }
      return { read, reads }
    }

    test("decideLaneStart: a lane whose disk is there reads nothing else", async () => {
      const { read, reads } = reader(true, [])
      expect(
        await decideLaneStart({ fork: "begun", container: "create" }, read),
      ).toEqual({ kind: "disk", recreate: false })
      expect(reads).toEqual(["disk"])
    })

    test("decideLaneStart: a lane whose disk is gone checks its snapshots only until one is there", async () => {
      const { read, reads } = reader(false, [e2, e1])
      expect(
        await decideLaneStart({ fork: "begun", container: "create" }, read),
      ).toEqual({ kind: "snapshot", from: e2, recreate: false })
      expect(reads).toEqual(["disk", "history", "e3", "e2"])
    })

    test("decideContainerStart: a missing container's start carries the steps that make it, on its disk or from a snapshot", async () => {
      const runtime = { runSpec: () => ({}) }
      const missing = { state: "missing", label: null } as const
      const base = {
        spec,
        env: {},
        runtime,
        facts: missing,
        fork: "begun",
        dataRoot: { kind: "keep" },
      } as const
      const onDisk = await decideContainerStart(base, reader(true, []).read)
      expect(onDisk.container).toBe("create")
      expect(onDisk.start).toEqual({
        kind: "disk",
        recreate: false,
        steps: planStart(spec, {}, { kind: "keep" }),
        dataRoot: null,
      })
      const restored = await decideContainerStart(
        base,
        reader(false, [e2]).read,
      )
      expect(restored.start).toEqual({
        kind: "snapshot",
        from: e2,
        recreate: false,
        steps: planDiskThenStart({
          spec,
          env: {},
          from: e2,
          dataRoot: { kind: "keep" },
        }),
        dataRoot: null,
      })
    })

    test("decideContainerStart: a stopped nested container's start makes its data root; a running one's makes nothing", async () => {
      const nested = { ...spec, grants: { ...spec.grants, nested: true } }
      const clone = {
        kind: "clone",
        cloneFromLane: threadIdFor("2"),
        atRunEnd: 1,
      } as const
      const decide = (state: "stopped" | "running") =>
        decideContainerStart(
          {
            spec: nested,
            env: {},
            runtime: { runSpec: () => ({}) },
            facts: {
              state,
              label: shapeSpecHash(
                { runSpec: () => ({}) },
                planShape(nested, {}),
              ),
            },
            fork: "begun",
            dataRoot: clone,
          },
          reader(true, []).read,
        )
      expect((await decide("stopped")).start).toEqual({
        kind: "container",
        plan: "start",
        steps: planBindSources(nested, {}, clone),
        dataRoot: clone,
      })
      expect((await decide("running")).start).toEqual({
        kind: "container",
        plan: "running",
        steps: [],
        dataRoot: null,
      })
    })

    test("decideLaneStart: a container there reads nothing", async () => {
      const { read, reads } = reader(false, [])
      expect(
        await decideLaneStart({ fork: "begun", container: "start" }, read),
      ).toEqual({ kind: "container", plan: "start" })
      expect(reads).toEqual([])
    })
  })
})
