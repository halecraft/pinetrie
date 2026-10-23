import { type MachineCause, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { machineWords, sizeWords } from "./machine.ts"

const GiB = 1024 ** 3
const lane = threadIdFor("0197a3c2-5b1e-7c4d-8e2f-1a2b3c4d5e6f")
const nameOf = () => "Quiet Otter"
const amber = (...causes: MachineCause[]) =>
  machineWords({ state: "amber", causes }, nameOf)

describe("sizeWords", () => {
  test("binary sizes, one decimal under 10", () => {
    expect(sizeWords(512)).toBe("512 bytes")
    expect(sizeWords(1536)).toBe("1.5 KB")
    expect(sizeWords(6.5 * GiB)).toBe("6.5 GB")
    expect(sizeWords(6 * GiB)).toBe("6 GB")
    expect(sizeWords(29.4 * GiB)).toBe("29 GB")
    expect(sizeWords(3 * 1024 * GiB)).toBe("3 TB")
    expect(sizeWords(2048 * 1024 * GiB)).toBe("2048 TB")
  })
})

describe("machineWords", () => {
  test("a neutral machine is keeping up", () => {
    expect(machineWords({ state: "neutral", causes: [] }, nameOf)).toBe(
      "The machine lanes run on: keeping up",
    )
  })

  test("the worst cause is worded, and the rest counted", () => {
    expect(
      machineWords(
        {
          state: "red",
          causes: [
            { kind: "room-spent", unallocated: GiB / 2 },
            { kind: "host-stalls", stalledMs: 1500 },
          ],
        },
        nameOf,
      ),
    ).toBe(
      "The machine lanes run on: work is stopped: the lanes' disk is full: 512 MB left, and writes in lanes may fail; and 1 more",
    )
  })

  test("each cause has its words", () => {
    expect(
      [
        amber({ kind: "room-low", unallocated: 6 * GiB, minimum: 20 * GiB }),
        amber({ kind: "metadata-full", used: 3.9 * GiB, total: 4 * GiB }),
        amber({ kind: "filesystem-low", free: 80 * GiB, leaveFree: 100 * GiB }),
        amber({ kind: "memory-stalls", fullAvg10: 12.4 }),
        amber({ kind: "lane-oom-killed", lane }),
        amber({ kind: "service-oom-killed", service: "disks" }),
        amber({ kind: "service-oom-killed", service: "privileged" }),
        amber({ kind: "service-oom-killed", service: "observer" }),
        amber({ kind: "host-stalls", stalledMs: 1500 }),
        amber({ kind: "snapshot-skipped", count: 1 }),
        amber({ kind: "snapshot-skipped", count: 3 }),
        amber({ kind: "unsampled", reason: "waiting", error: null }),
        amber({ kind: "unsampled", reason: "stopped", error: null }),
        amber({ kind: "unsampled", reason: "failed", error: "no answer" }),
      ].map(t => t.replace("The machine lanes run on: ", "")),
    ).toEqual([
      "work is slowed: the lanes' disk is low: 6 GB left, 20 GB at least",
      "work is slowed: the lanes' disk has no room for more files: its metadata is 98% full",
      "work is slowed: the disk holding the lanes is low: 80 GB free, 100 GB to leave",
      "work is slowed: lanes are short of memory: every task waited on it 12% of the last 10 seconds",
      "work is slowed: a command in Quiet Otter was killed for using too much memory",
      "work is slowed: lanehost's disk service was killed for using too much memory",
      "work is slowed: lanehost's privileged service was killed for using too much memory",
      "work is slowed: the file observer was killed for using too much memory",
      "work is slowed: the host stalled for 1.5 seconds",
      "a turn's snapshot could not be recorded: branching at it starts from the turn before",
      "3 turns' snapshots could not be recorded: branching at them starts from the turn before",
      "waiting for its first reading",
      "the host has stopped",
      "it could not be read: no answer",
    ])
  })
})
