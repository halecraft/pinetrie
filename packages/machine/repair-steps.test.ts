import { describe, expect, test } from "vitest"
import type { RepairControls } from "./ports.ts"
import { decodeRepairState, encodeRepairState } from "./repair.ts"
import { runRepairSteps } from "./repair-steps.ts"

const GiB = 1024 ** 3

/** Controls over a shared state, recording each step; `change` alters one. */
function controls(
  change: Partial<RepairControls<"held", "launcher">> = {},
  shared: { text: string | null } = { text: null },
) {
  const steps: string[] = []
  const c: RepairControls<"held", "launcher"> = {
    takeRepairLock: async () => "held",
    lockLost: () => new Promise(() => {}),
    readRepair: async () => ({ lockHeld: true, text: shared.text }),
    repairBootMissing: async () => null,
    diskSize: async () => 8 * GiB,
    stopVmForRepair: async () => void steps.push("stop"),
    awaitLauncherGone: async () => "launcher",
    growForRepair: async () => 72 * GiB,
    bootRepair: async () => ({
      leftUnallocated: 64 * GiB,
      leftMetadata: { size: GiB, used: GiB / 2 },
      failed: null,
    }),
    writeRepairState: async (_held, state) => {
      shared.text = encodeRepairState(state)
    },
    releaseRepairLocks: async (_held, launcher) =>
      void steps.push(`release ${launcher ?? "none"}`),
    ...change,
  }
  return { c, steps, shared }
}

const request = {
  trigger: "room-spent-and-nothing-to-delete",
  plannedSize: 72 * GiB,
  seen: null,
} as const

describe("runRepairSteps", () => {
  test("runs to done, each state told, and lets both locks go", async () => {
    const { c, steps, shared } = controls()
    const told: string[] = []
    const run = await runRepairSteps(c, request, (_from, to) =>
      told.push(to.kind),
    )
    expect(run).toMatchObject({ kind: "ran", state: { kind: "done" } })
    expect(told).toEqual(["detected", "stopping-vm", "booting-repair", "done"])
    expect(decodeRepairState(shared.text)).toMatchObject({ kind: "done" })
    expect(steps).toEqual(["stop", "release launcher"])
  })

  test("a lock another holds runs nothing", async () => {
    const { c, steps } = controls({
      takeRepairLock: async () => "held-by-another",
    })
    expect(await runRepairSteps(c, request, () => {})).toEqual({
      kind: "held-by-another",
    })
    expect(steps).toEqual([])
  })

  test("a state that moved since the sample that asked runs nothing", async () => {
    const { c, steps } = controls(
      {},
      { text: encodeRepairState({ kind: "idle" }) },
    )
    expect(await runRepairSteps(c, request, () => {})).toEqual({
      kind: "not-needed",
    })
    expect(steps).toEqual(["release none"])
  })

  test("a repair boot not ready fails it without stopping the VM", async () => {
    const { c, steps, shared } = controls({
      repairBootMissing: async () => "its initrd is not made",
    })
    await runRepairSteps(c, request, () => {})
    expect(steps).toEqual(["release none"])
    expect(decodeRepairState(shared.text)).toEqual({
      kind: "failed",
      why: "the repair boot could not be made ready: its initrd is not made",
      sizeAtFailure: 8 * GiB,
    })
  })

  test("a lock lost mid-repair ends it failed", async () => {
    const { c, shared } = controls({
      lockLost: async () => {},
      bootRepair: () => new Promise(() => {}),
    })
    await runRepairSteps(c, request, () => {})
    expect(decodeRepairState(shared.text)).toMatchObject({
      kind: "failed",
      why: "the repair lock was lost",
    })
  })
})
