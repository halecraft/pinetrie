import { type MachineHealth, threadIdFor } from "@pinetrie/core"
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
