// What the types make impossible to write. Each `@ts-expect-error` fails
// `pnpm run typecheck` if the line below it ever compiles.

import type { HeldLock } from "@pinetrie/lock"
import { expect, test } from "vitest"
import { stopVmForRepair } from "./lease.ts"
import { repairDataDisk } from "./repair.ts"
import { writeRepairState } from "./repair-lock.ts"

const lock = {} as HeldLock

test("no step of a repair takes a lock it was not given by taking it", () => {
  const never = () => {
    // @ts-expect-error: a stop for a repair needs the repair lock's proof
    void stopVmForRepair({ lock })
    // @ts-expect-error: only the repair lock's holder writes its state
    void writeRepairState({ lock }, "")
    // @ts-expect-error: the repair boot needs the launcher's lock held
    void repairDataDisk({ stateDir: "", launcherHeld: { lock }, log: () => {} })
  }
  expect(typeof never).toBe("function")
})
