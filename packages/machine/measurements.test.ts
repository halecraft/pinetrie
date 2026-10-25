import { HISTORY_MINUTES, threadIdFor } from "@pinetrie/core"
import fc from "fast-check"
import { describe, expect, test } from "vitest"
import { READING_OVERDUE_AFTER_TICKS } from "./freshness.ts"
import {
  commandProgram,
  counterRise,
  FOLLOWED_NONE,
  type FollowedRow,
  type LimitsRead,
  lanesChanged,
  lanesMeasured,
  lastHourHistory,
  limitEvents,
  limitEventsMeasured,
  nextFollowed,
  numbersInForce,
  reclaimRise,
  treatmentChanges,
  trimFollowed,
} from "./measurements.ts"

test("commandProgram skips cd, export, assignments, env and time to the program", () => {
  expect(
    [
      "cd packages/x && pnpm test",
      "export CI=1; FOO=bar env -i NODE_ENV=test time node scripts/x.ts --flag",
      "./node_modules/.bin/vitest run a.test.ts",
      "cd /tmp",
      "",
      "(cd a && make)",
      "env -u HOME -C /tmp nice -n 10 cargo build",
    ].map(commandProgram),
  ).toEqual(["pnpm", "node", "vitest", null, null, "make", "cargo"])
})

test("commandProgram never returns an argument", () => {
  const WORD = fc.stringMatching(/^[a-z][a-z0-9_.-]{0,8}$/)
  const NOISE = fc.oneof(
    WORD.map(w => `cd ${w}`),
    WORD.map(w => `export ${w.toUpperCase().replace(/[.-]/g, "_")}=1`),
  )
  fc.assert(
    fc.property(
      fc.array(NOISE, { maxLength: 3 }),
      fc.array(
        WORD.map(w => `${w.toUpperCase().replace(/[.-]/g, "_")}=x`),
        { maxLength: 2 },
      ),
      fc.subarray(["env", "env -u NAME", "time", "nice -n 5"]),
      WORD.filter(
        w =>
          ![
            "cd",
            "export",
            "env",
            "time",
            "exec",
            "nice",
            "nohup",
            "command",
            "pushd",
            "popd",
            "set",
          ].includes(w),
      ),
      fc.array(WORD, { maxLength: 4 }),
      (noise, assignments, prefixes, program, args) => {
        const statement = [...prefixes, ...assignments, program, ...args].join(
          " ",
        )
        const command = [...noise, statement].join(" && ")
        expect(commandProgram(command)).toBe(program)
      },
    ),
  )
})

describe("rows from a sample and a plan", () => {
  const lane = threadIdFor("t-1")
  const counters = {
    refaultAnon: 10,
    refaultFile: 100,
    stallSomeUs: 1000,
    stallFullUs: 500,
  }

  test("the counters' rise since the last sample, and none across a reset", () => {
    expect(
      counterRise(counters, {
        ...counters,
        refaultFile: 160,
        stallSomeUs: 1300,
      }),
    ).toEqual({
      refaultAnon: 0,
      refaultFile: 60,
      stallSomeUs: 300,
      stallFullUs: 0,
    })
    expect(counterRise(null, counters)).toBeNull()
    expect(counterRise(counters, { ...counters, refaultAnon: 1 })).toBeNull()
  })

  test("a lane is kept only when its memory moved by a MiB or its program changed", () => {
    const MiB = 1024 ** 2
    const sample = {
      lane,
      current: 600 * MiB,
      anon: 100 * MiB,
      file: 500 * MiB,
      limit: null,
      oomKills: 0,
      limitHits: { max: 0, high: 0 },
      pressure: null,
    }
    const [kept] = lanesMeasured([sample], () => null)
    if (kept === undefined) throw new Error("no lane")
    const before = new Map([[lane, kept]])
    expect(
      lanesChanged(
        before,
        lanesMeasured([{ ...sample, anon: sample.anon + 1000 }], () => null),
      ),
    ).toEqual([])
    expect(
      lanesChanged(
        before,
        lanesMeasured([sample], () => "pnpm"),
      ).map(l => l.program),
    ).toEqual(["pnpm"])
  })

  test("a treatment changed is from and to, a lane not held being normal", () => {
    const b = threadIdFor("t-2")
    expect(
      treatmentChanges(
        [{ lane, treatment: { kind: "waiting-to-start" } }],
        [{ lane: b, treatment: { kind: "paused" } }],
      ),
    ).toEqual([
      { lane, from: "waiting-to-start", to: "normal" },
      { lane: b, from: "normal", to: "paused" },
    ])
  })
})

test("the reclaim's rise since the last sample, and none across a reboot", () => {
  const reclaim = {
    allocStalls: 300,
    scannedDirect: 1_000,
    scannedByKswapd: 50_000,
  }
  expect(
    reclaimRise(reclaim, {
      ...reclaim,
      allocStalls: 320,
      scannedDirect: 1_400,
    }),
  ).toEqual({ allocStalls: 20, scannedDirect: 400, scannedByKswapd: 0 })
  expect(reclaimRise(reclaim, { ...reclaim, scannedByKswapd: 10 })).toBeNull()
  expect(reclaimRise(null, reclaim)).toBeNull()
})

describe("a cgroup at its limit", () => {
  const lane = threadIdFor("t-1")
  const other = threadIdFor("t-2")
  const hits = (max: number, high = 0) => ({ max, high })
  const laneAt = (l: typeof lane, max: number, high = 0) => ({
    lane: l,
    current: 0,
    anon: 0,
    file: 0,
    limit: null,
    oomKills: 0,
    limitHits: hits(max, high),
    pressure: null,
  })
  const observerAt = (max: number) => ({
    service: "observer" as const,
    memory: {
      kind: "read" as const,
      currentBytes: 0,
      limitBytes: null,
      limitHits: hits(max),
    },
  })
  const read = (
    lanes: LimitsRead["lanes"],
    services: LimitsRead["services"],
    own: { max: number; high: number } | null = null,
  ): LimitsRead => ({ lanes, services, machine: { limitHits: own } })

  test("each cgroup whose max or high rose is one event, with each rise", () => {
    expect(
      limitEvents(
        read([laneAt(lane, 2), laneAt(other, 5)], [observerAt(100)]),
        read([laneAt(lane, 2, 3), laneAt(other, 5)], [observerAt(141)]),
      ).causes,
    ).toEqual([
      {
        kind: "cgroup-at-limit",
        subject: { kind: "lane", lane },
        maxHits: 0,
        highHits: 3,
      },
      {
        kind: "cgroup-at-limit",
        subject: { kind: "service", service: "observer" },
        maxHits: 41,
        highHits: 0,
      },
    ])
  })

  test("a cgroup new in the sample, or made again, has no rise yet", () => {
    expect(
      limitEvents(
        read([laneAt(lane, 9)], []),
        read([laneAt(lane, 1), laneAt(other, 7)], [observerAt(4)]),
      ),
    ).toEqual({ causes: [], own: null })
    expect(limitEvents(null, read([laneAt(lane, 9)], [], hits(3)))).toEqual({
      causes: [],
      own: null,
    })
  })

  test("an own cgroup's limit hits come back as own, never among the causes", () => {
    const events = limitEvents(
      read([], [], hits(10)),
      read([], [], hits(12, 1)),
    )
    expect(events).toEqual({ causes: [], own: { max: 2, high: 1 } })
    expect(limitEventsMeasured(events)).toEqual([
      {
        kind: "cgroup-at-limit",
        subject: { kind: "own" },
        maxHits: 2,
        highHits: 1,
      },
    ])
  })
})

test("the numbers in force name the overdue bound's constant and the bound a host set", () => {
  const numbers = numbersInForce({
    sampleEveryMs: 100,
    readingOverdueAfterTicks: 40,
    memoryLimits: null,
    containerLimits: null,
    servicesFloorBytes: null,
    leaveFree: [],
  })
  expect([
    numbers.READING_OVERDUE_AFTER_TICKS,
    numbers.readingOverdueAfterTicks,
    numbers.sampleEveryMs,
  ]).toEqual([READING_OVERDUE_AFTER_TICKS, 40, 100])
})

describe("the samples followed", () => {
  const MIN = 60_000
  const lane = threadIdFor("t-1")
  const sample = (
    at: number,
    memoryAvailable: number,
    fullAvg10: number | null,
    scope: "machine" | "contained" | "unmeasured" = "machine",
    rung = 0,
  ): FollowedRow => ({
    kind: "sample",
    at,
    rung,
    memoryAvailable,
    fullAvg10,
    scope,
  })
  const fold = (rows: readonly FollowedRow[]) =>
    rows.reduce(nextFollowed, FOLLOWED_NONE)

  test("a minute keeps its least memory and its most machine pressure", () => {
    const { minutes } = lastHourHistory(
      fold([sample(0, 900, 2), sample(5_000, 400, 9), sample(10_000, 700, 3)])
        .history,
    )
    expect(minutes.at(-1)).toEqual({
      memoryAvailableBytes: 400,
      machinePressureFull: 9,
      isContainedStall: false,
      laneBytes: {},
    })
  })

  test("a stall inside one thread's own limit adds no pressure, and marks its minute", () => {
    const { minutes } = lastHourHistory(
      fold([sample(0, 900, 1), sample(5_000, 900, 40, "contained")]).history,
    )
    expect(minutes.at(-1)).toMatchObject({
      machinePressureFull: 1,
      isContainedStall: true,
    })
  })

  test("a lane's minute with no row of its own carries its last memory", () => {
    const { minutes } = lastHourHistory(
      fold([
        sample(0, 900, 0),
        { kind: "lane", at: 1_000, lane, currentBytes: 300 },
        sample(MIN, 900, 0),
        sample(2 * MIN, 900, 0),
      ]).history,
    )
    expect(minutes.slice(-3).map(m => m?.laneBytes[lane])).toEqual([
      300, 300, 300,
    ])
  })

  test("the served hour ends at the newest minute, a minute with no sample null, and the older gone", () => {
    const { minutes } = lastHourHistory(
      fold([sample(0, 1, 0), sample(11 * MIN, 2, 0), sample(70 * MIN, 3, 0)])
        .history,
    )
    expect(minutes).toHaveLength(HISTORY_MINUTES)
    expect(minutes.at(-1)?.memoryAvailableBytes).toBe(3)
    expect(minutes.at(0)?.memoryAvailableBytes).toBe(2)
    expect(minutes.filter(m => m !== null)).toHaveLength(2)
  })

  test("the rung changes only between consecutive samples that differ", () => {
    const followed = fold(
      [0, 0, 2, 2, 1].map((rung, i) => sample(i + 1, 1, 0, "machine", rung)),
    )
    expect(followed.rungs.changes).toEqual([
      { at: 3, kind: "rung", from: 0, to: 2 },
      { at: 5, kind: "rung", from: 2, to: 1 },
    ])
    expect(trimFollowed(followed, 4).rungs.changes).toEqual([
      { at: 5, kind: "rung", from: 2, to: 1 },
    ])
  })
})
