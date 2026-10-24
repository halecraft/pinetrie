import { type MachineCause, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { machineWords, sizeWords, treatmentWords } from "./machine.ts"

const GiB = 1024 ** 3
const lane = threadIdFor("0197a3c2-5b1e-7c4d-8e2f-1a2b3c4d5e6f")
const nameOf = () => "Quiet Otter"
const amber = (...causes: MachineCause[]) =>
  machineWords({ state: "amber", causes, treatments: [] }, nameOf)

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
    expect(
      machineWords({ state: "neutral", causes: [], treatments: [] }, nameOf),
    ).toBe("The machine lanes run on: keeping up")
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
          treatments: [],
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
        amber({
          kind: "room-low",
          unallocated: 6 * GiB,
          minimum: 20 * GiB,
          grows: false,
        }),
        amber({
          kind: "room-low",
          unallocated: 6 * GiB,
          minimum: 20 * GiB,
          grows: true,
        }),
        amber({ kind: "metadata-full", used: 3.9 * GiB, total: 4 * GiB }),
        amber({ kind: "filesystem-low", free: 80 * GiB, leaveFree: 100 * GiB }),
        amber({ kind: "memory-short", rung: 2, isHolding: true }),
        amber({ kind: "memory-short", rung: 3, isHolding: true }),
        amber({ kind: "memory-short", rung: 3, isHolding: false }),
        amber({ kind: "lane-oom-killed", lane }),
        amber({ kind: "service-oom-killed", service: "disks" }),
        amber({ kind: "service-oom-killed", service: "privileged" }),
        amber({ kind: "service-oom-killed", service: "observer" }),
        amber({
          kind: "cgroup-at-limit",
          subject: { kind: "service", service: "observer" },
        }),
        amber({ kind: "cgroup-at-limit", subject: { kind: "lane", lane } }),
        amber({ kind: "host-stalls", stalledMs: 1500 }),
        amber({ kind: "freeing-room" }),
        amber({
          kind: "room-unrecoverable",
          unallocated: 6 * GiB,
          minimum: 20 * GiB,
          isRepaired: true,
        }),
        amber({
          kind: "room-unrecoverable",
          unallocated: 6 * GiB,
          minimum: 20 * GiB,
          isRepaired: false,
        }),
        amber({
          kind: "disk-being-repaired",
          step: "detected",
          progress: null,
        }),
        amber({
          kind: "disk-being-repaired",
          step: "stopping-vm",
          progress: null,
        }),
        amber({
          kind: "disk-being-repaired",
          step: "booting-repair",
          progress:
            "[repair] grown: Resize device id 1 (/dev/vda) from 2.00GiB to max",
        }),
        amber({ kind: "disk-repair-failed", why: "mount: bad superblock" }),
        amber({ kind: "snapshot-skipped", count: 1 }),
        amber({ kind: "snapshot-skipped", count: 3 }),
        amber({ kind: "unsampled", reason: "waiting", error: null }),
        amber({ kind: "unsampled", reason: "stopped", error: null }),
        amber({ kind: "unsampled", reason: "failed", error: "no answer" }),
      ].map(t => t.replace("The machine lanes run on: ", "")),
    ).toEqual([
      "work is slowed: the lanes' disk is low: 6 GB left, 20 GB at least",
      "work is slowed: the lanes' disk is low: 6 GB left, 20 GB at least; it grows when the lane VM next starts",
      "work is slowed: the lanes' disk has no room for more files: its metadata is 98% full",
      "work is slowed: the disk holding the lanes is low: 80 GB free, 100 GB to leave",
      "work is slowed: memory is short: new runs wait for room",
      "work is slowed: memory is short: only the threads that matter most make tool calls",
      "work is slowed: memory is short",
      "work is slowed: a command in Quiet Otter was killed for using too much memory",
      "work is slowed: lanehost's disk service was killed for using too much memory",
      "work is slowed: lanehost's privileged service was killed for using too much memory",
      "work is slowed: the file observer was killed for using too much memory",
      "work is slowed: the file observer is stuck at its memory limit",
      "work is slowed: Quiet Otter is stuck at its memory limit",
      "work is slowed: the host stalled for 1.5 seconds",
      "work is slowed: the lanes' disk is low: old turns' snapshots are being deleted to free room",
      "work is slowed: the lanes' disk is low, and nothing is left that may be deleted: 6 GB left, 20 GB at least",
      "work is slowed: the lanes' disk is low, and nothing is left that may be deleted: 6 GB left, 20 GB at least; `btrfs balance start -dusage=10` on the lanes' directory may free room",
      "work is slowed: the lane VM's disk is full: repairing it",
      "work is slowed: the lane VM's disk is full: repairing it, the lane VM stopping",
      "work is slowed: the lane VM's disk is full: repairing it (grown: Resize device id 1 (/dev/vda) from 2.00GiB to max)",
      "work is slowed: the lane VM's disk could not be repaired: mount: bad superblock; it is tried again once the disk could grow: raise `lanes.store.max`, or free the Mac's disk",
      "a turn's snapshot could not be recorded: branching at it starts from the turn before",
      "3 turns' snapshots could not be recorded: branching at them starts from the turn before",
      "waiting for its first reading",
      "the host has stopped",
      "it could not be read: no answer",
    ])
  })
})

describe("memory held", () => {
  const short = { kind: "memory-short", rung: 2, isHolding: true } as const
  const waiting = { kind: "waiting-to-start" } as const
  test("the footer counts the threads that wait for room", () => {
    expect(
      machineWords(
        {
          state: "amber",
          causes: [short],
          treatments: [
            { lane, treatment: waiting },
            { lane: threadIdFor("t-2"), treatment: { kind: "paused" } },
          ],
        },
        nameOf,
      ),
    ).toBe(
      "The machine lanes run on: work is slowed: memory is short: 2 threads wait for room",
    )
  })

  test("lanes waiting for a repair are not counted as waiting for room", () => {
    expect(
      machineWords(
        {
          state: "amber",
          causes: [short],
          treatments: [
            { lane, treatment: waiting },
            {
              lane: threadIdFor("t-2"),
              treatment: { kind: "waiting-for-repair" },
            },
          ],
        },
        nameOf,
      ),
    ).toBe(
      "The machine lanes run on: work is slowed: memory is short: 1 thread waits for room",
    )
  })

  test("a column says why its lane waits, and nothing for one not held", () => {
    expect([
      treatmentWords({ kind: "normal" }),
      treatmentWords(waiting),
      treatmentWords({ kind: "paused" }),
      treatmentWords({ kind: "waiting-for-repair" }),
    ]).toEqual([
      null,
      "waits for room on the machine to start",
      "paused for memory: its next tool call waits for room",
      "waits while the lane VM's disk is repaired",
    ])
  })
})
