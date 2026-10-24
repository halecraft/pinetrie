// machine/repair-steps — the one executor of a repair's states, through the
// host's controls: the manager's repair while the host runs and the host's
// at its start take the same steps. Each state is written as it is reached,
// so every host reads where the repair is; a repair starts no VM: it lets
// its locks go, and every host's kept lease starts the VM again.

import { errorText } from "@pinetrie/core"
import type { RepairControls } from "./ports.ts"
import {
  nextRepairState,
  type RepairEvent,
  type RepairState,
  repairFacts,
  repairStateNow,
} from "./repair.ts"

/** How a call to `runRepairSteps` ended. */
export type RepairRun =
  /** The repair ran to `done` or `failed`. */
  | { readonly kind: "ran"; readonly state: RepairState }
  /** Another holds the lock: a repair, or a VM's start; read a fresh sample before deciding again. */
  | { readonly kind: "held-by-another" }
  /** The shared state moved since the sample that asked, or does not allow a repair: none ran. */
  | { readonly kind: "not-needed" }
  | { readonly kind: "lock-failed"; readonly detail: string }

/** What asked for a repair, and what its sample read. */
export interface RepairRequest {
  /** The event that opens it: a trigger, or a person's retry of a failed repair. */
  readonly asked: Extract<RepairEvent, { kind: "trigger" | "retry-asked" }>
  /** The shared state's text the asking sample read: changed since, another host acted. */
  readonly seen: string | null
}

class LockLost extends Error {
  constructor() {
    super("the repair lock was lost")
  }
}

/**
 * The repair `request` asks for, run to its end under the repair lock:
 * the state read again under the lock, then `detected`, the VM stopped,
 * the launcher's lock taken, the disk grown, the repair booted, `done` or
 * `failed`, and both locks let go. A step that fails, or a lock lost,
 * ends it `failed`. `onState` is told each state written.
 */
export async function runRepairSteps<Held, LauncherHeld>(
  controls: RepairControls<Held, LauncherHeld>,
  request: RepairRequest,
  onState: (from: RepairState, to: RepairState) => void,
): Promise<RepairRun> {
  const taken = await controls.takeRepairLock()
  if (taken === "held-by-another") return { kind: "held-by-another" }
  if (isFailed(taken)) return { kind: "lock-failed", detail: taken.detail }
  const held = taken
  let launcherHeld: LauncherHeld | null = null
  try {
    const read = await controls.readRepair()
    if (read.text !== request.seen) return { kind: "not-needed" }
    // Read as a lock no other holds: a running state left is a dead holder's.
    let state = repairStateNow(
      repairFacts({ lockHeld: false, text: read.text }),
    )
    let writes = Promise.resolve()
    const move = (event: RepairEvent): Promise<void> => {
      const next = nextRepairState(state, event)
      if (next === state) return writes
      const from = state
      state = next
      onState(from, next)
      writes = writes.then(() => controls.writeRepairState(held, next))
      return writes
    }
    await move(request.asked)
    if (state.kind !== "detected") return { kind: "not-needed" }
    const lost = controls.lockLost(held).then(() => {
      throw new LockLost()
    })
    lost.catch(() => {})
    const guarded = <T>(step: Promise<T>): Promise<T> =>
      Promise.race([step, lost])
    try {
      const missing = await controls.repairBootMissing()
      if (missing !== null)
        throw new Error(`the repair boot could not be made ready: ${missing}`)
      await move({ kind: "stopping" })
      await guarded(controls.stopVmForRepair(held))
      launcherHeld = await guarded(controls.awaitLauncherGone(held))
      await move({ kind: "stopped" })
      const size = await guarded(controls.growForRepair(held))
      const launcher = launcherHeld
      const outcome = await guarded(
        controls.bootRepair(held, launcher, line => {
          void move({ kind: "progress", line })
        }),
      )
      await move({ kind: "booted", outcome, size })
    } catch (error) {
      const size = await controls.diskSize().catch(() => 0)
      await move({ kind: "broke", why: errorText(error), size })
    }
    await writes
    return { kind: "ran", state }
  } finally {
    await controls.releaseRepairLocks(held, launcherHeld)
  }
}

const isFailed = (
  v: unknown,
): v is { readonly kind: "failed"; readonly detail: string } =>
  typeof v === "object" &&
  v !== null &&
  "kind" in v &&
  (v as { kind: unknown }).kind === "failed" &&
  "detail" in v
