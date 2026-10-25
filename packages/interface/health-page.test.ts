import {
  type ActingBound,
  canvasIdFor,
  type EventMeasured,
  HISTORY_MINUTES,
  type MachineFacts,
  type MachineSampled,
  type ThreadName,
  threadIdFor,
  workflowStateIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { foldRepeats, healthPageView, vitalStatus } from "./health-page.ts"
import {
  diagnosticLines,
  type HealthPageText,
  healthPageWords,
  machineAskPrefill,
} from "./health-words.ts"
import type { ThreadMove } from "./thread-card.ts"

const GiB = 1024 ** 3
const [a, b] = [threadIdFor("t-a"), threadIdFor("t-b")]
const river = "quiet-river" as ThreadName
const NOW = 10 * 24 * 60 * 60 * 1000

const below = (
  acts: number,
  clears: number,
  does: ActingBound["does"],
): ActingBound => ({ worse: "below", acts, clears, does })
const above = (
  acts: number,
  clears: number,
  does: ActingBound["does"],
): ActingBound => ({ worse: "above", acts, clears, does })

const memoryBounds = [
  below(1.6 * GiB, 2.4 * GiB, "hold-starts"),
  below(0.8 * GiB, 1.6 * GiB, "pause-threads"),
]
const pressureBounds = [
  above(5, 1, "hold-starts"),
  above(10, 2, "pause-threads"),
]

const sampled: MachineSampled = {
  kind: "sampled",
  memory: {
    totalBytes: 16 * GiB,
    availableBytes: 2 * GiB,
    rung: 2,
    bounds: memoryBounds,
    pressure: {
      kind: "read",
      someAvg10: 12.5,
      fullAvg10: 3,
      scope: "machine",
      bounds: pressureBounds,
    },
  },
  store: {
    kind: "read",
    sizeBytes: 400 * GiB,
    unallocatedBytes: 38 * GiB,
    maxBytes: null,
    bounds: [
      below(40 * GiB, 44 * GiB, "delete-snapshots"),
      below(GiB, 2 * GiB, "writes-may-fail"),
    ],
  },
  filesystem: { kind: "unreadable", why: "its free space could not be read" },
  lanes: [
    {
      lane: a,
      name: river,
      treatment: "normal",
      memory: {
        kind: "read",
        currentBytes: GiB,
        limitBytes: 4 * GiB,
        anonBytes: GiB / 2,
        fileBytes: GiB / 2,
      },
      snapshots: { count: 3, bytes: 3 * 1024 ** 2 },
    },
    {
      lane: b,
      name: null,
      treatment: "waiting-to-start",
      memory: { kind: "unreadable", why: "its cgroup could not be read" },
      snapshots: { count: 0, bytes: 0 },
    },
  ],
  services: [
    {
      service: "observer",
      memory: {
        kind: "unreadable",
        why: "the host outside this lane runs it",
      },
    },
  ],
  containment: { kind: "contained" },
  history: {
    minutes: [
      ...Array.from({ length: HISTORY_MINUTES - 2 }, () => null),
      {
        memoryAvailableBytes: 3 * GiB,
        machinePressureFull: 1,
        isContainedStall: false,
        laneBytes: { [a]: GiB / 2 },
      },
      {
        memoryAvailableBytes: 2 * GiB,
        machinePressureFull: 3,
        isContainedStall: true,
        laneBytes: { [a]: GiB },
      },
    ],
  },
}

const facts: MachineFacts = {
  health: {
    state: "amber",
    causes: [{ kind: "memory-short", rung: 2, isHolding: true }],
    treatments: [{ lane: b, treatment: { kind: "waiting-to-start" } }],
  },
  machineKind: "lane-vm",
  reading: sampled,
  vmMemoryCeilingBytes: 8 * GiB,
  servicesFloorBytes: 1.5 * GiB,
  isOomdManagingLanes: false,
  lately: [
    {
      at: NOW - 2000,
      kind: "event",
      event: { kind: "lane-oom-killed", lane: a },
    },
    { at: NOW - 3 * 60_000, kind: "rung", from: 0, to: 2 },
  ],
  latelyCapped: false,
  names: [{ lane: a, name: river }],
  actions: [{ kind: "archive" }],
}

const archive = (lane: (typeof facts.names)[number]["lane"]): ThreadMove => ({
  name: "Archive",
  closes: true,
  busy: null,
  drops: lane === a ? ["quiet-river"] : [],
  intent: {
    kind: "move-canvas",
    canvas: canvasIdFor("c-1"),
    from: workflowStateIdFor("doing"),
    to: workflowStateIdFor("archive"),
    before: null,
    closes: true,
  },
})

const words = (f: MachineFacts | null, move = archive): HealthPageText =>
  healthPageWords(healthPageView(f, move, NOW))

/** The page's words where the host reads a machine. */
const machine = (f: MachineFacts = facts, move = archive) => {
  const text = words(f, move)
  if (text.kind !== "machine") throw new Error("no machine")
  return text
}

const withSampled = (change: Partial<MachineSampled>): MachineFacts => ({
  ...facts,
  reading: { ...sampled, ...change },
})

describe("the Health page", () => {
  test("a host with no machine says so, and draws no section", () => {
    expect(words(null)).toEqual({
      kind: "no-machine",
      title: "Health",
      noMachine: "This host runs no lanes, so pine·trie reads no machine here.",
    })
  })

  test("before the first sample, every vital and the threads wait for it", () => {
    const text = machine({ ...facts, reading: { kind: "unsampled" } })
    expect([
      text.threads.empty,
      text.vitals.items.map(v => [v.status.word, v.note]),
    ]).toEqual([
      "waiting for its first reading",
      Array.from({ length: 4 }, () => [
        "Waiting",
        "waiting for its first reading",
      ]),
    ])
  })

  test("the verdict is the worst cause, what pine·trie does, and what you can do", () => {
    expect(machine().verdict).toEqual({
      state: "amber",
      title: "Memory is short",
      sentence: "memory is short: 1 thread waits for room",
      doing: "pine·trie holds new runs' starts until there is room",
      youCan:
        "archive the canvases you are done with, or stop the runs you do not need now",
      more: [],
      quiet: false,
    })
  })

  test("with no cause, everything keeps up and the actions are quiet", () => {
    const text = machine({
      ...facts,
      health: { state: "neutral", causes: [], treatments: [] },
    })
    expect([text.verdict.title, text.verdict.quiet]).toEqual([
      "Everything keeps up",
      true,
    ])
  })

  test("the line under the heading names the machine and its sizes", () => {
    expect(machine().machineLine).toBe(
      "The lane VM on your Mac, where your threads' commands run · 16 GB memory · 400 GB disk",
    )
  })

  test("a lane is its thread's name, held first, its memory against its limit, or why it was not read", () => {
    expect(machine().threads.rows.map(r => r.line)).toEqual([
      "a thread not named yet: memory not read: its cgroup could not be read; no snapshots; waits for room on the machine to start",
      "quiet-river: 1 GB of 4 GB (its own 512 MB, cache 512 MB); 3 snapshots, about 3 MB",
    ])
    expect(machine().threads.rows.map(r => r.state.label)).toEqual([
      "waits to start",
      "running",
    ])
  })

  test("each vital is its number, its status and its note, a reading not taken saying why", () => {
    expect(
      machine().vitals.items.map(v => [
        v.label,
        v.number,
        v.of,
        v.status.word,
        v.note,
      ]),
    ).toEqual([
      [
        "Memory",
        "2 GB",
        "free of 16 GB",
        "Short",
        "pine·trie holds new runs' starts until there is room",
      ],
      [
        "Memory pressure",
        "3%",
        "of the time stalled",
        "Near limit",
        "new runs wait above 5%: 2% away",
      ],
      [
        "Lanes' disk",
        "38 GB",
        "free of 400 GB",
        "Near limit",
        "pine·trie deletes old snapshots below 40 GB: 2 GB away",
      ],
      [
        "Your Mac's disk",
        "—",
        "",
        "Not read",
        "its free space could not be read",
      ],
    ])
  })

  test("a vital acts only while its cause is in force, and is near past its clearing bound", () => {
    const store = sampled.store.kind === "read" ? sampled.store.bounds : []
    const kinds = (value: number, causes: Parameters<typeof vitalStatus>[3]) =>
      vitalStatus("store", value, store, causes, null).kind
    const low = {
      kind: "room-low",
      unallocated: 30 * GiB,
      minimum: 40 * GiB,
      grows: false,
    } as const
    expect([
      kinds(30 * GiB, []),
      kinds(30 * GiB, [low]),
      kinds(42 * GiB, []),
      kinds(50 * GiB, []),
    ]).toEqual(["near", "acting", "near", "normal"])
  })

  test("a stall inside a thread's own limit is the thread's, never near", () => {
    const text = machine(
      withSampled({
        memory: {
          ...sampled.memory,
          pressure: {
            kind: "read",
            someAvg10: 40,
            fullAvg10: 30,
            scope: "contained",
            bounds: pressureBounds,
          },
        },
      }),
    )
    expect(text.vitals.items[1]?.status).toEqual({
      kind: "contained",
      word: "A thread's own",
    })
  })

  test("the pressure acts with memory only past its own bound", () => {
    const status = (full: number) =>
      vitalStatus("pressure", full, pressureBounds, facts.health.causes, null)
        .kind
    expect([status(3), status(6)]).toEqual(["near", "acting"])
  })

  test("the last hour is drawn to the vital's top, with its bounds as lines", () => {
    const memory = machine().vitals.items[0]
    expect([
      memory?.series?.points.slice(-2),
      memory?.series?.lines,
      memory?.seriesText,
    ]).toEqual([
      [13 / 16, 14 / 16],
      [14.4 / 16, 15.2 / 16],
      "memory in use over the last hour: least 13 GB, most 14 GB, now 14 GB",
    ])
  })

  test("the safeguards say what is contained, the floor it protects, and the OOM priority as set, not read", () => {
    const items = (f: MachineFacts) =>
      machine(f).details.safeguards.items.map(i => [i.mark, i.text])
    const sampledWith = (containment: MachineSampled["containment"]) =>
      withSampled({ containment })
    expect(items(facts)).toEqual([
      ["in-effect", "each lane is held to its process limit"],
      ["in-effect", "the services are held to theirs, and to their CPU share"],
      ["in-effect", "the services are protected up to 1.5 GB of memory"],
      [
        "set",
        "the kernel is set to stop a lane before a service when memory runs out (set, not read back)",
      ],
    ])
    expect(items({ ...facts, servicesFloorBytes: null })[2]).toEqual([
      "outside",
      "the services' memory has no floor here, where the cgroups are not pine·trie's",
    ])
    expect(
      items(
        sampledWith({
          kind: "not-contained",
          missing: ["processes", "cpu-weight", "services-floor"],
          why: "no-cgroup-driver",
        }),
      ),
    ).toEqual([
      [
        "missing",
        "this lane's Docker has no cgroup controllers: nothing is contained here",
      ],
    ])
    expect(
      items(
        sampledWith({
          kind: "not-contained",
          missing: ["cpu-weight", "services-floor"],
          why: "not-read-back",
        }),
      ),
    ).toEqual([
      [
        "missing",
        "not every limit took: a service's CPU share, the services' memory floor did not read back as set",
      ],
    ])
  })

  test("a host whose lanes systemd-oomd manages says so", () => {
    expect(
      machine({ ...facts, isOomdManagingLanes: true })
        .details.safeguards.items.map(i => i.text)
        .at(-1),
    ).toBe(
      "systemd-oomd may stop these lanes under memory pressure, outside pine·trie",
    )
  })

  test("a service not read says why", () => {
    expect(machine().details.services.rows[0]).toMatchObject({
      label: "the file observer",
      text: "not read: the host outside this lane runs it",
      unreadable: true,
    })
  })

  test("what happened is newest first, a lane by its thread's name, with how long ago", () => {
    expect(machine().happened.rows.map(r => [r.when, r.text, r.tone])).toEqual([
      [
        "just now",
        "a command in quiet-river was killed for using too much memory",
        "trouble",
      ],
      [
        "3 min ago",
        "memory grew short: short: new runs wait for room",
        "trouble",
      ],
    ])
  })

  test("repeats in a row fold into one, with a count and the longest time, and other subjects never fold", () => {
    const at = (t: number, event: EventMeasured) => ({
      at: t,
      kind: "event" as const,
      event,
    })
    const rows = foldRepeats([
      at(5, { kind: "host-stalled", ms: 1100 }),
      at(4, { kind: "host-stalled", ms: 1400 }),
      at(3, { kind: "host-stalled", ms: 1200 }),
      at(2, { kind: "lane-oom-killed", lane: a }),
      at(1, { kind: "lane-oom-killed", lane: b }),
    ])
    expect(rows.map(r => [r.count, r.lately])).toEqual([
      [3, at(5, { kind: "host-stalled", ms: 1400 })],
      [1, at(2, { kind: "lane-oom-killed", lane: a })],
      [1, at(1, { kind: "lane-oom-killed", lane: b })],
    ])
    expect(
      machine({ ...facts, lately: rows.slice(0, 1).map(r => r.lately) })
        .happened.rows[0]?.text,
    ).toBe("the host stalled for 1.4 seconds")
  })

  test("a capped day's strip spans from its oldest row", () => {
    const text = machine({ ...facts, latelyCapped: true })
    expect([
      text.happened.strip.from,
      text.happened.span.startsWith("since"),
    ]).toEqual([NOW - 3 * 60_000, true])
  })

  test("a cgroup at its limit is worded by its thread's name, its service or this host's lane, with each count", () => {
    const at = (t: number, event: EventMeasured) => ({
      at: t,
      kind: "event" as const,
      event,
    })
    const lately = machine({
      ...facts,
      lately: [
        at(3, {
          kind: "cgroup-at-limit",
          subject: { kind: "service", service: "observer" },
          maxHits: 41,
          highHits: 0,
        }),
        at(2, {
          kind: "cgroup-at-limit",
          subject: { kind: "lane", lane: a },
          maxHits: 1,
          highHits: 2,
        }),
        at(1, {
          kind: "cgroup-at-limit",
          subject: { kind: "own" },
          maxHits: 0,
          highHits: 1,
        }),
      ],
    }).happened.rows.map(r => r.text)
    expect(lately).toEqual([
      "the file observer met its memory limit 41 times",
      "quiet-river met its memory limit 1 time and its memory's high mark 2 times",
      "this host's lane met its memory's high mark 1 time",
    ])
  })

  test("archive's confirmation says what it frees and what it withdraws", () => {
    const row = machine().threads.rows.find(r => r.lane === a)
    expect(row?.archive?.confirm).toBe(
      "Archive quiet-river's canvas? Its threads become read-only for everyone until moved out; the upkeep then deletes quiet-river's snapshots, about 3 MB; unfinished changes will be dropped: quiet-river",
    )
  })

  test("only the actions the facts carry are offered", () => {
    const none = machine({ ...facts, actions: [] })
    const repair = machine({
      ...facts,
      actions: [{ kind: "archive" }, { kind: "repair-again", why: "no room" }],
    })
    expect([
      none.threads.rows.map(r => r.archive),
      none.repairAgain,
      machine().repairAgain,
      repair.repairAgain?.confirm,
    ]).toEqual([
      [null, null],
      null,
      null,
      "Repair the lane VM's disk again? Every running thread on every host waits while the lane VM is stopped and its disk repaired. The last repair failed: no room",
    ])
  })

  test("the diagnostics start with Now, and hold each vital's words and what happened's times", () => {
    const lines = diagnosticLines(words(facts))
    expect([
      lines[0],
      lines.includes(
        "  Memory pressure: 3% of the time stalled; Near limit; new runs wait above 5%: 2% away",
      ),
      lines.at(-2),
    ]).toEqual([
      "Now:",
      true,
      `  ${new Date(NOW - 2000).toISOString()} a command in quiet-river was killed for using too much memory`,
    ])
  })

  test("asking an agent opens with @agent and the diagnostics after it, not blank", () => {
    const prefill = machineAskPrefill("Now:\n  calm\n")
    expect([
      prefill.text.startsWith("@agent "),
      prefill.text.includes("```\nNow:\n  calm\n```"),
      prefill.blank,
    ]).toEqual([true, true, false])
  })
})
