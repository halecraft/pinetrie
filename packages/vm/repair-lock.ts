// vm/repair-lock — the lane VM's repair lock and its shared state, both in
// the VM's state directory beside `data.img` (never `images/`, which a
// scenario's own lane VM shares with the person's). A VM's start holds the
// lock too, so a repair never stops a VM that is starting, and no VM starts
// on a disk being repaired. Its proofs are made only here, when a lock is
// taken; what needs one says so in its type.

import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  awaitLock,
  type HeldLock,
  type LockFailed,
  type OnWaiting,
  tryLock,
  withLock,
} from "@pinetrie/lock"

export const REPAIR_LOCK = "repair.lock"
/** The repair's last state, as its holder wrote it: text vm never reads the meaning of. */
export const REPAIR_STATE = "repair.state"
/** The launcher's own lock, held for its whole life (`launcher.swift`). */
export const LAUNCHER_LOCK = "launcher.lock"

declare const repairBrand: unique symbol
declare const launcherBrand: unique symbol

/** `REPAIR_LOCK` held by this process. */
export interface RepairLockHeld {
  readonly lock: HeldLock
  readonly [repairBrand]: true
}

/** `launcher.lock` held by this process: no launcher, of any version, runs while it is. */
export interface LauncherLockHeld {
  readonly lock: HeldLock
  readonly [launcherBrand]: true
}

const repairHeld = (lock: HeldLock) => ({ lock }) as RepairLockHeld

/** The state directory a proof's lock is in: the repair's state and the launcher's lock are beside it. */
export const repairLockStateDir = (held: RepairLockHeld): string =>
  path.dirname(held.lock.file)

/** Taken for a repair, now, or `held-by-another`: a repair or a VM's start. */
export async function takeRepairLock(
  stateDir: string,
): Promise<RepairLockHeld | "held-by-another" | LockFailed> {
  const attempt = await tryLock(path.join(stateDir, REPAIR_LOCK), {
    platform: process.platform,
    heldWhile: "until-released",
    writePid: true,
  })
  if (attempt.kind === "held-by-another") return "held-by-another"
  return attempt.kind === "failed" ? attempt : repairHeld(attempt)
}

/**
 * `work` run holding the repair lock, waited for while a repair or another
 * start holds it, and released after, also when it throws. The only maker
 * of the proof a VM's start takes.
 */
export const withRepairLock = <T>(
  stateDir: string,
  onWaiting: OnWaiting,
  work: (held: RepairLockHeld) => Promise<T>,
): Promise<{ readonly kind: "done"; readonly value: T } | LockFailed> =>
  withLock(
    path.join(stateDir, REPAIR_LOCK),
    { platform: process.platform, writePid: true, onWaiting },
    lock => work(repairHeld(lock)),
  )

/**
 * The launcher's lock, waited for: the exact sign its launcher has exited
 * and let `data.img` go. Held, it keeps any launcher out, since one that
 * finds it held exits at once. Only released, never removed: the launcher
 * opens the same file.
 */
export async function awaitLauncherGone(
  held: RepairLockHeld,
  onWaiting: OnWaiting,
): Promise<LauncherLockHeld | LockFailed> {
  const lock = await awaitLock(
    path.join(repairLockStateDir(held), LAUNCHER_LOCK),
    {
      platform: process.platform,
      heldWhile: "until-released",
      onWaiting,
    },
  )
  return lock.kind === "failed" ? lock : ({ lock } as LauncherLockHeld)
}

/** Writes the repair's state, whole or not at all: a reader never sees half. */
export async function writeRepairState(
  held: RepairLockHeld,
  text: string,
): Promise<void> {
  const file = path.join(repairLockStateDir(held), REPAIR_STATE)
  const scratch = `${file}.tmp-${process.pid}`
  try {
    await writeFile(scratch, text)
    await rename(scratch, file)
  } finally {
    await rm(scratch, { force: true })
  }
}

/** Whether anyone holds the repair lock now, and the repair's last state's text. */
export interface RepairFactsRead {
  readonly lockHeld: boolean
  readonly text: string | null
}

/**
 * For anyone: the lock tried and let go at once, then the state read. A
 * lock this process cannot try reads as held: unsure, the safe answer.
 */
export async function readRepairFacts(
  stateDir: string,
): Promise<RepairFactsRead> {
  const attempt = await tryLock(path.join(stateDir, REPAIR_LOCK), {
    platform: process.platform,
    heldWhile: "until-released",
  })
  if (attempt.kind === "held") await attempt.release()
  const text = await readFile(path.join(stateDir, REPAIR_STATE), "utf8").catch(
    () => null,
  )
  return { lockHeld: attempt.kind !== "held", text }
}
