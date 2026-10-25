import {
  type MachineCause,
  type MachineCauseKind,
  type MachineHealth,
  threadIdFor,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { MACHINE, MACHINE_KEY } from "./machine.ts"

const health: MachineHealth = {
  state: "amber",
  causes: [{ kind: "memory-short", rung: 3, isHolding: true }],
  treatments: [
    { lane: threadIdFor("t-1"), treatment: { kind: "paused" } },
    { lane: threadIdFor("t-2"), treatment: { kind: "waiting-to-start" } },
  ],
}

test("the machine's health, its lanes held among it, is read back as it was written", () => {
  const stored = structuredClone(MACHINE.encode(health))
  expect(MACHINE.decode(stored, MACHINE_KEY)).toEqual(health)
})

test("a health value of the old shape, memory's stalls and no treatments, does not decode", () => {
  const old = {
    state: "amber",
    causes: [{ kind: "memory-stalls", fullAvg10: 12 }],
  }
  expect(MACHINE.decode(old, MACHINE_KEY)).toBeUndefined()
})

test("a cgroup stuck at its limit, a lane's or a service's, is read back as it was written", () => {
  const atLimit: MachineHealth = {
    state: "amber",
    causes: [
      {
        kind: "cgroup-at-limit",
        subject: { kind: "service", service: "observer" },
      },
      {
        kind: "cgroup-at-limit",
        subject: { kind: "lane", lane: threadIdFor("t-1") },
      },
    ],
    treatments: [],
  }
  const stored = structuredClone(MACHINE.encode(atLimit))
  expect(MACHINE.decode(stored, MACHINE_KEY)).toEqual(atLimit)
})

/** One of every cause, each at its own kind, so a cause added to core fails here until it is listed. */
const EVERY_CAUSE = {
  "room-low": {
    kind: "room-low",
    unallocated: 1,
    minimum: 2,
    grows: true,
  },
  "room-spent": { kind: "room-spent", unallocated: 1 },
  "metadata-full": { kind: "metadata-full", used: 1, total: 2 },
  "filesystem-low": { kind: "filesystem-low", free: 1, leaveFree: 2 },
  "memory-short": { kind: "memory-short", rung: 2, isHolding: false },
  "lane-oom-killed": { kind: "lane-oom-killed", lane: threadIdFor("t-1") },
  "service-oom-killed": { kind: "service-oom-killed", service: "disks" },
  "cgroup-at-limit": {
    kind: "cgroup-at-limit",
    subject: { kind: "service", service: "privileged" },
  },
  "host-stalls": { kind: "host-stalls", stalledMs: 300 },
  "snapshot-skipped": { kind: "snapshot-skipped", count: 1 },
  "freeing-room": { kind: "freeing-room" },
  "room-unrecoverable": {
    kind: "room-unrecoverable",
    unallocated: 1,
    minimum: 2,
    isRepaired: true,
  },
  "disk-being-repaired": {
    kind: "disk-being-repaired",
    step: "booting-repair",
    progress: "checking extents",
  },
  "disk-repair-failed": { kind: "disk-repair-failed", why: "repair failed" },
  unsampled: { kind: "unsampled", reason: "failed", error: "no reading" },
} satisfies { [K in MachineCauseKind]: Extract<MachineCause, { kind: K }> }

test.each(
  Object.values(EVERY_CAUSE).map((c): [MachineCauseKind, MachineCause] => [
    c.kind,
    c,
  ]),
)("a health holding %s is read back as it was written", (_, cause) => {
  const h: MachineHealth = { state: "red", causes: [cause], treatments: [] }
  const stored = structuredClone(MACHINE.encode(h))
  expect(MACHINE.decode(stored, MACHINE_KEY)).toEqual(h)
})
