import {
  canvasIdFor,
  type MachinePageFacts,
  type ThreadName,
  threadIdFor,
  workflowStateIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  machineAskPrefill,
  machinePageLines,
  machinePageView,
  machinePageWords,
} from "./machine-page.ts"
import type { ThreadMove } from "./thread-card.ts"

const GiB = 1024 ** 3
const [a, b] = [threadIdFor("t-a"), threadIdFor("t-b")]
const river = "quiet-river" as ThreadName

const facts: MachinePageFacts = {
  health: {
    state: "amber",
    causes: [{ kind: "memory-short", rung: 2, isHolding: true }],
    treatments: [{ lane: b, treatment: { kind: "waiting-to-start" } }],
  },
  reading: {
    kind: "sampled",
    memory: {
      totalBytes: 16 * GiB,
      availableBytes: 2 * GiB,
      source: "whole-machine",
      pressure: { kind: "read", someAvg10: 12.5, fullAvg10: 3 },
      rung: 2,
    },
    store: {
      kind: "read",
      sizeBytes: 400 * GiB,
      unallocatedBytes: 38 * GiB,
      minimumBytes: 40 * GiB,
      maxBytes: null,
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
  },
  vmMemoryCeilingBytes: 8 * GiB,
  lately: [
    {
      at: 2000,
      kind: "event",
      event: { kind: "lane-oom-killed", lane: a },
    },
    { at: 1000, kind: "rung", from: 0, to: 2 },
  ],
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

const words = (f: MachinePageFacts | null, move = archive) =>
  machinePageWords(machinePageView(f, move))

describe("the Machine page", () => {
  test("a host with no machine says so, and draws no section", () => {
    const text = words(null)
    expect([text.noMachine, text.sections.now.lines]).toEqual([
      "This host runs no lanes, so pine·trie reads no machine here.",
      [],
    ])
  })

  test("before the first sample, every reading section waits for it", () => {
    const text = words({ ...facts, reading: { kind: "unsampled" } })
    expect([
      text.sections.threads.empty,
      text.sections.machine.lines.map(l => [l.text, l.unreadable]),
      text.sections.host.lines.map(l => l.text),
    ]).toEqual([
      "waiting for its first reading",
      [["waiting for its first reading", true]],
      ["waiting for its first reading"],
    ])
  })

  test("now is each cause, what pine·trie does, and what you can do", () => {
    expect(words(facts).sections.now.lines).toEqual([
      {
        key: "memory-short:0",
        text: "memory is short: 1 thread waits for room",
        unreadable: false,
        doing: "it holds new runs' starts until there is room",
        youCan:
          "archive the canvases you are done with, or stop the runs you do not need now",
      },
    ])
  })

  test("a lane is its thread's name, held first, its memory against its limit, or why it was not read", () => {
    expect(words(facts).sections.threads.lines.map(l => l.text)).toEqual([
      "a thread not named yet: memory not read: its cgroup could not be read; no snapshots; waits for room on the machine to start",
      "quiet-river: 1 GB of 4 GB (its own 512 MB, cache 512 MB); 3 snapshots, about 3 MB",
    ])
  })

  test("sizes are against their settings, a reading not taken says why, and the VM's ceiling is a ceiling", () => {
    expect(
      words(facts).sections.machine.lines.map(l => [l.text, l.unreadable]),
    ).toEqual([
      ["memory: 2 GB available of 16 GB; short: new runs wait for room", false],
      [
        "memory pressure: some tasks stalled 12.5%, every task 3% of the last 10 seconds",
        false,
      ],
      [
        "the lanes' disk: 38 GB unallocated of 400 GB; pine·trie keeps 40 GB at least; it may grow with no limit set (`lanes.store.max`)",
        false,
      ],
      ["your disk: not read: its free space could not be read", true],
      ["the lane VM may use up to 8 GB of your Mac's memory", false],
    ])
  })

  test("a service not read says why", () => {
    expect(words(facts).sections.host.lines).toEqual([
      {
        key: "observer",
        text: "the file observer: not read: the host outside this lane runs it",
        unreadable: true,
      },
    ])
  })

  test("lately is newest first, a lane by its thread's name", () => {
    expect(words(facts).sections.lately.lines.map(l => l.text)).toEqual([
      "a command in quiet-river was killed for using too much memory",
      "memory grew short: short: new runs wait for room",
    ])
  })

  test("archive's confirmation says what it frees and what it withdraws", () => {
    const row = words(facts).sections.threads.lines.find(l => l.lane === a)
    expect(row?.archive?.confirm).toBe(
      "Archive quiet-river's canvas? Its threads become read-only for everyone until moved out; the upkeep then deletes quiet-river's snapshots, about 3 MB; unfinished changes will be dropped: quiet-river",
    )
  })

  test("only the actions the facts carry are offered", () => {
    const none = words({ ...facts, actions: [] })
    const repair = words({
      ...facts,
      actions: [{ kind: "archive" }, { kind: "repair-again", why: "no room" }],
    })
    expect([
      none.sections.threads.lines.map(l => l.archive),
      none.repairAgain,
      words(facts).repairAgain,
      repair.repairAgain?.confirm,
    ]).toEqual([
      [null, null],
      null,
      null,
      "Repair the lane VM's disk again? Every running thread on every host waits while the lane VM is stopped and its disk repaired. The last repair failed: no room",
    ])
  })

  test("the page as text holds each section, and lately's times", () => {
    const lines = machinePageLines(words(facts))
    expect([lines[0], lines.includes("Threads:"), lines.at(-2)]).toEqual([
      "Now:",
      true,
      `  ${new Date(2000).toISOString()} a command in quiet-river was killed for using too much memory`,
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
