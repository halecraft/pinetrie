// What the types make impossible to write. Each `@ts-expect-error` fails
// `pnpm run typecheck` if the line below it ever compiles.

import type { LaneTreatment } from "@pinetrie/core"
import { expect, test } from "vitest"
import type { RepairState } from "./repair.ts"
import type { LaneActivity } from "./treatments.ts"

test("a treatment missing from what each allows does not compile", () => {
  type Kind = LaneTreatment["kind"] | "repairing"
  const allowed = {
    normal: ["tool-call", "container-start"],
    "waiting-to-start": [],
    paused: ["container-start"],
    // @ts-expect-error: a table of treatments must say what each allows
  } as const satisfies Record<Kind, readonly LaneActivity[]>
  expect(Object.keys(allowed)).toHaveLength(3)
})

test("a repair state missing from where each may go does not compile", () => {
  type Kind = RepairState["kind"] | "retrying"
  const next = {
    idle: ["detected"],
    detected: ["stopping-vm", "failed"],
    "stopping-vm": ["booting-repair", "failed"],
    "booting-repair": ["booting-repair", "done", "failed"],
    done: ["detected"],
    failed: ["detected"],
    // @ts-expect-error: the table must say where every state may go
  } as const satisfies Record<Kind, readonly RepairState["kind"][]>
  expect(Object.keys(next)).toHaveLength(6)
})
