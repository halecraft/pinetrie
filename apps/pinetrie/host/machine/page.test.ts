import { type ThreadName, threadIdFor } from "@pinetrie/core"
import {
  LEAVE_FREE_DEFAULT,
  type MachineReading,
  type MachineSample,
  type ReadingPlanned,
} from "@pinetrie/machine"
import { describe, expect, test } from "vitest"
import { machineActions, planMachinePage } from "./page.ts"

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
  health: { state: "amber", causes: [], treatments: [] },
  rung: 2,
  held: [{ lane: b, treatment: { kind: "waiting-to-start" } }],
  repair: { lockHeld: false, state: { kind: "idle" } },
}

const gathered = {
  reading,
  lately: [],
  snapshots: new Map([[a, { count: 3, bytes: 300 }]]),
  names: new Map([[a, named]]),
  settings: { max: 200 * GiB, leaveFree: LEAVE_FREE_DEFAULT },
  vmMemoryCeilingBytes: 8 * GiB,
  servicesFloorBytes: GiB,
  isOomdManagingLanes: false,
  repairs: false,
}

describe("the Machine page's facts", () => {
  test("before a sample, the page is unsampled, waiting", () => {
    const facts = planMachinePage({ ...gathered, reading: null })
    expect([facts.reading, facts.health.causes[0]?.kind]).toEqual([
      { kind: "unsampled" },
      "unsampled",
    ])
  })

  test("each running lane is its thread's name, its treatment, its memory or why not, and its snapshots", () => {
    const facts = planMachinePage(gathered)
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
    const facts = planMachinePage({
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
    const facts = planMachinePage(gathered)
    expect([
      facts.reading.kind === "sampled" && facts.reading.containment,
      facts.servicesFloorBytes,
      facts.isOomdManagingLanes,
    ]).toEqual([{ kind: "contained" }, GiB, false])
  })

  test("the store is against its floor and its setting, and what was not read says why", () => {
    const facts = planMachinePage(gathered)
    if (facts.reading.kind !== "sampled") throw new Error("unsampled")
    expect([
      facts.reading.store,
      facts.reading.filesystem.kind,
      facts.reading.memory.pressure.kind,
      facts.vmMemoryCeilingBytes,
    ]).toEqual([
      {
        kind: "read",
        sizeBytes: 100 * GiB,
        unallocatedBytes: 30 * GiB,
        minimumBytes: 10 * GiB,
        maxBytes: 200 * GiB,
      },
      "unreadable",
      "unreadable",
      8 * GiB,
    ])
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
