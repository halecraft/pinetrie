import { type ThreadName, threadIdFor } from "@pinetrie/core"
import {
  LEAVE_FREE_DEFAULT,
  type MachineReading,
  type MachineSample,
  type ReadingPlanned,
} from "@pinetrie/machine"
import { describe, expect, test } from "vitest"
import {
  type MachineGathered,
  machineActions,
  machineKind,
  planMachineFacts,
} from "./page.ts"

const GiB = 1024 ** 3
const [a, b] = [threadIdFor("t-a"), threadIdFor("t-b")]
const named = "quiet-river" as ThreadName

const sample: MachineSample = {
  machine: {
    memoryTotal: 16 * GiB,
    memoryAvailable: 6 * GiB,
    pressure: null,
    counters: null,
    reclaim: null,
    limitHits: null,
    source: "whole-machine",
  },
  lanes: [
    {
      lane: a,
      current: GiB,
      anon: GiB / 2,
      file: GiB / 2,
      limit: 4 * GiB,
      oomKills: 0,
      limitHits: { max: 0, high: 0 },
      pressure: null,
    },
  ],
  lanesRunning: [a, b],
  store: {
    size: 100 * GiB,
    unallocated: 30 * GiB,
    data: { total: 60 * GiB, used: 50 * GiB },
    metadata: { total: GiB, used: GiB / 2 },
  },
  filesystem: null,
  services: [],
  containment: { kind: "contained" },
  serviceKills: [],
  hostStalledMs: 0,
  snapshotsSkipped: 0,
  upkeep: { freeing: false, exhausted: false },
}

const reading: MachineReading & { readonly kind: "fresh" } = {
  kind: "fresh",
  sample,
  scope: { kind: "contained", pressure: { someAvg10: 30, fullAvg10: 20 } },
  health: { state: "amber", causes: [], treatments: [] },
  rung: 2,
  held: [{ lane: b, treatment: { kind: "waiting-to-start" } }],
  repair: { lockHeld: false, state: { kind: "idle" } },
}

const minute = (laneBytes: Record<string, number>) => ({
  memoryAvailableBytes: 6 * GiB,
  machinePressureFull: null,
  isContainedStall: false,
  laneBytes,
})

const gathered: MachineGathered = {
  reading,
  history: {
    minutes: [null, minute({ [a]: GiB, [threadIdFor("t-gone")]: GiB })],
  },
  lately: [],
  latelyCapped: false,
  snapshots: new Map([[a, { count: 3, bytes: 300 }]]),
  names: new Map([[a, named]]),
  settings: { max: 200 * GiB, leaveFree: LEAVE_FREE_DEFAULT },
  target: "lane-vm",
  memorySource: "whole-machine",
  vmMemoryCeilingBytes: 8 * GiB,
  servicesFloorBytes: GiB,
  isOomdManagingLanes: false,
  repairs: false,
}

describe("the machine's facts", () => {
  test("before a sample, the page is unsampled, waiting", () => {
    const facts = planMachineFacts({ ...gathered, reading: null })
    expect([facts.reading, facts.health.causes[0]?.kind]).toEqual([
      { kind: "unsampled" },
      "unsampled",
    ])
  })

  test("each running lane is its thread's name, its treatment, its memory or why not, and its snapshots", () => {
    const facts = planMachineFacts(gathered)
    expect(facts.reading.kind === "sampled" && facts.reading.lanes).toEqual([
      {
        lane: a,
        name: named,
        treatment: "normal",
        memory: {
          kind: "read",
          currentBytes: GiB,
          limitBytes: 4 * GiB,
          anonBytes: GiB / 2,
          fileBytes: GiB / 2,
        },
        snapshots: { count: 3, bytes: 300 },
      },
      {
        lane: b,
        name: null,
        treatment: "waiting-to-start",
        memory: { kind: "unreadable", why: "its cgroup could not be read" },
        snapshots: { count: 0, bytes: 0 },
      },
    ])
  })

  test("a lane Lately names, at its limit or killed, carries its thread's name", () => {
    const facts = planMachineFacts({
      ...gathered,
      names: new Map([
        [a, named],
        [b, "still-pond" as ThreadName],
      ]),
      lately: [
        {
          at: 2,
          kind: "event",
          event: {
            kind: "cgroup-at-limit",
            subject: { kind: "lane", lane: a },
            maxHits: 4,
            highHits: 0,
          },
        },
        { at: 1, kind: "event", event: { kind: "lane-oom-killed", lane: b } },
      ],
    })
    expect(facts.names).toEqual([
      { lane: a, name: named },
      { lane: b, name: "still-pond" },
    ])
  })

  test("the page carries the sample's containment, the floor asked and whether systemd-oomd manages the lanes", () => {
    const facts = planMachineFacts(gathered)
    expect([
      facts.reading.kind === "sampled" && facts.reading.containment,
      facts.servicesFloorBytes,
      facts.isOomdManagingLanes,
    ]).toEqual([{ kind: "contained" }, GiB, false])
  })

  test("the store is against its bounds and its setting, and what was not read says why", () => {
    const facts = planMachineFacts(gathered)
    if (facts.reading.kind !== "sampled") throw new Error("unsampled")
    const { store } = facts.reading
    expect([
      store.kind === "read" && [store.unallocatedBytes, store.maxBytes],
      store.kind === "read" && store.bounds.map(b => [b.acts, b.does]),
      facts.reading.filesystem.kind,
      facts.vmMemoryCeilingBytes,
    ]).toEqual([
      [30 * GiB, 200 * GiB],
      [
        [10 * GiB, "delete-snapshots"],
        [GiB, "writes-may-fail"],
      ],
      "unreadable",
      8 * GiB,
    ])
  })

  test("the pressure is the reading's scope's, with no scope read as unreadable", () => {
    const pressure = (scope: ReadingPlanned["scope"]) => {
      const facts = planMachineFacts({
        ...gathered,
        reading: { ...reading, scope },
      })
      return facts.reading.kind === "sampled" && facts.reading.memory.pressure
    }
    expect(pressure(reading.scope)).toMatchObject({
      kind: "read",
      fullAvg10: 20,
      scope: "contained",
    })
    expect(pressure({ kind: "unmeasured" })).toMatchObject({
      kind: "unreadable",
    })
  })

  test("the hour holds only the lanes running now", () => {
    const facts = planMachineFacts(gathered)
    expect(
      facts.reading.kind === "sampled" &&
        facts.reading.history.minutes.map(m => m?.laneBytes ?? null),
    ).toEqual([null, { [a]: GiB }])
  })

  test("the machine is the lane VM, a Linux host, or a host's own lane", () => {
    expect([
      machineKind("lane-vm", "whole-machine"),
      machineKind("docker-host", "whole-machine"),
      machineKind("docker-host", "own-cgroup"),
    ]).toEqual(["lane-vm", "linux-host", "own-cgroup"])
  })
})

test("repair again is offered only to a host holding the repair's controls, after a failure", () => {
  const failed: ReadingPlanned = {
    ...reading,
    repair: {
      lockHeld: false,
      state: { kind: "failed", why: "no room", sizeAtFailure: 1 },
    },
  }
  expect([
    machineActions(failed, true),
    machineActions(failed, false),
    machineActions(reading, true),
  ]).toEqual([
    [{ kind: "archive" }, { kind: "repair-again", why: "no room" }],
    [{ kind: "archive" }],
    [{ kind: "archive" }],
  ])
})
