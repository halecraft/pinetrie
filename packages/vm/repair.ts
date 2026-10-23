// vm/repair — the lane VM's repair boot: the builder's machine on
// `data.img`, its initrd holding `btrfs-progs` and its libraries, pinned, so
// a repair needs no network when it runs. Its `/init`
// (`builder/repair-init`) grows the filesystem to the disk and repacks data
// chunks, saying so in `[repair] ` lines read here. What the repair is for,
// and when it runs, is the host's; this is the boot, made ready ahead and
// run with the VM stopped.

import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { apkEntries, kernelImageName, pinnedKernel } from "./apk.ts"
import {
  BUILDER_DIR,
  readBuilderPins,
  runBuilder,
  writeInitrd,
  writeInitrdDir,
} from "./build.ts"
import {
  ensurePinned,
  type FetchBytes,
  fetchBytes,
  sha256Hex,
} from "./pinned.ts"
import { type BuilderPins, type KernelModule, kernelModules } from "./plan.ts"
import type { LauncherLockHeld } from "./repair-lock.ts"
import { BUILDER, buildBinary, gatherBinary } from "./swift.ts"

export const REPAIR_LINE_PREFIX = "[repair] "

/** The filesystem's room, in bytes, as the repair boot reads it. */
export interface RepairRoom {
  readonly size: number
  readonly unallocated: number
  readonly metadataSize: number
  readonly metadataUsed: number
}

/** One protocol line of the repair boot's console. */
export type RepairLine =
  | { readonly kind: "found"; readonly room: RepairRoom }
  | { readonly kind: "grown"; readonly words: string }
  | { readonly kind: "not-grown"; readonly words: string }
  | {
      readonly kind: "repacked"
      readonly percent: number
      /** Chunks moved, or null where btrfs said no count (an error). */
      readonly relocated: number | null
      readonly words: string
    }
  | { readonly kind: "left"; readonly room: RepairRoom }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly words: string }

/** What a repair boot did, from its lines. */
export interface RepairReport {
  readonly found: RepairRoom | null
  readonly left: RepairRoom | null
  readonly grown: boolean
  /** Data chunks moved, across every pass. */
  readonly repacked: number
  /** Why it failed, or null when it said `done`. */
  readonly failed: string | null
}

const ROOM =
  /^size=(\d+) unallocated=(\d+) metadata-size=(\d+) metadata-used=(\d+)$/

function parseRoom(text: string): RepairRoom | null {
  const m = ROOM.exec(text)
  if (m === null) return null
  return {
    size: Number(m[1]),
    unallocated: Number(m[2]),
    metadataSize: Number(m[3]),
    metadataUsed: Number(m[4]),
  }
}

/**
 * A `[repair] ` line as a value; null for any other line, and for the
 * boot's own notes (a module not loaded, dmesg's tail), which a person's
 * log keeps but no decision reads.
 */
export function parseRepairLine(line: string): RepairLine | null {
  if (!line.startsWith(REPAIR_LINE_PREFIX)) return null
  const said = line.slice(REPAIR_LINE_PREFIX.length)
  if (said === "done") return { kind: "done" }
  const [head = "", ...rest] = said.split(": ")
  const words = rest.join(": ")
  if (head === "failed") return { kind: "failed", words }
  if (head === "grown") return { kind: "grown", words }
  if (head === "not grown") return { kind: "not-grown", words }
  const repacked = /^repacked at (\d+)%$/.exec(head)
  if (repacked !== null) {
    const count = /had to relocate (\d+) out of/.exec(words)?.[1]
    return {
      kind: "repacked",
      percent: Number(repacked[1]),
      relocated: count === undefined ? null : Number(count),
      words,
    }
  }
  const room = /^(found|left) (.*)$/.exec(said)
  const read = room === null ? null : parseRoom(room[2] ?? "")
  if (room === null || read === null) return null
  return room[1] === "found"
    ? { kind: "found", room: read }
    : { kind: "left", room: read }
}

/** The report of a boot that said `lines`: failed unless it said `done`. */
export function repairReport(lines: readonly RepairLine[]): RepairReport {
  let report: RepairReport = {
    found: null,
    left: null,
    grown: false,
    repacked: 0,
    failed: null,
  }
  let isDone = false
  for (const line of lines)
    switch (line.kind) {
      case "found":
        report = { ...report, found: line.room }
        break
      case "left":
        report = { ...report, left: line.room }
        break
      case "grown":
        report = { ...report, grown: true }
        break
      case "not-grown":
        break
      case "repacked":
        report = {
          ...report,
          repacked: report.repacked + (line.relocated ?? 0),
        }
        break
      case "failed":
        report = { ...report, failed: report.failed ?? line.words }
        break
      case "done":
        isDone = true
        break
    }
  return report.failed === null && !isDone
    ? {
        ...report,
        failed: "the repair boot stopped before it said it was done",
      }
    : report
}

/** What a repair boot is made of: the builder's kernel and root, its modules, and the repair's. */
export interface RepairBootPlan {
  readonly pinsDir: string
  /** The initrd, named by a hash of everything in it. */
  readonly initrd: string
  readonly scratch: string
  readonly modules: readonly KernelModule[]
  readonly packages: BuilderPins["repair"]["packages"]
}

/**
 * The repair boot of `pins` and `init` (the repair's `/init`'s text) under
 * `stateDir`: its initrd named by a hash of its inputs, so it is made once
 * and made again when any of them changes.
 */
export function planRepairBoot(f: {
  readonly stateDir: string
  readonly pins: BuilderPins
  readonly init: string
  readonly pid: number
}): RepairBootPlan {
  const pinsDir = path.join(f.stateDir, "builder")
  const hash = sha256Hex(
    JSON.stringify([
      f.pins.kernel.sha256,
      f.pins.root.sha256,
      f.pins.modules,
      f.pins.repair.modules,
      f.pins.repair.packages.map(p => p.sha256),
      f.init,
    ]),
  ).slice(0, 16)
  const initrd = path.join(pinsDir, `repair-${hash}.cpio`)
  return {
    pinsDir,
    initrd,
    scratch: `${initrd}.tmp-${f.pid}`,
    modules: kernelModules(f.pins.kernel.version, [
      ...f.pins.modules,
      ...f.pins.repair.modules,
    ]),
    packages: f.pins.repair.packages,
  }
}

/** The names under `builder/` a repair needs kept: its initrd and its packages. */
export const repairBootNames = (plan: RepairBootPlan): readonly string[] => [
  path.basename(plan.initrd),
  ...plan.packages.map(p => path.basename(p.url)),
]

const REPAIR_INIT = path.join(BUILDER_DIR, "repair-init")

/** The repair boot for the current pins and `repair-init`, planned. */
export async function gatherRepairBoot(
  stateDir: string,
): Promise<RepairBootPlan> {
  const [pins, init] = await Promise.all([
    readBuilderPins(),
    readFile(REPAIR_INIT, "utf8"),
  ])
  return planRepairBoot({ stateDir, pins, init, pid: process.pid })
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/**
 * Make the repair boot ready: the builder's binary built, the kernel and
 * root and the repair's packages fetched, and its initrd written, each
 * only if missing. A host on the Mac calls it at its start, so a repair
 * never fetches or compiles when it runs. Returns the initrd.
 */
export async function ensureRepairBoot(
  stateDir: string,
  fetch: FetchBytes = fetchBytes,
): Promise<string> {
  const builder = await gatherBinary(stateDir, BUILDER)
  if (builder.state === "no-swiftc")
    throw new Error(
      "the lane VM's builder machine needs Xcode's command line tools: `xcode-select --install`",
    )
  if (builder.state === "buildable") await buildBinary(builder.binary, BUILDER)
  const plan = await gatherRepairBoot(stateDir)
  const pins = await readBuilderPins()
  await pinnedKernel(plan.pinsDir, pins.kernel, fetch)
  if (await exists(plan.initrd)) return plan.initrd
  const rootTarball = await ensurePinned(
    path.join(plan.pinsDir, path.basename(pins.root.url)),
    pins.root,
    fetch,
  )
  const apks = await Promise.all(
    plan.packages.map(p =>
      ensurePinned(path.join(plan.pinsDir, path.basename(p.url)), p, fetch),
    ),
  )
  const dir = path.join(plan.scratch, "initrd")
  await rm(plan.scratch, { recursive: true, force: true })
  try {
    await writeInitrdDir({
      dir,
      kernelApk: await readFile(
        path.join(plan.pinsDir, path.basename(pins.kernel.url)),
      ),
      modules: plan.modules,
      init: REPAIR_INIT,
    })
    for (const apk of apks)
      for (const entry of apkEntries(await readFile(apk))) {
        const to = path.join(dir, entry.name)
        await mkdir(path.dirname(to), { recursive: true })
        if (entry.kind === "symlink") await symlink(entry.target, to)
        else await writeFile(to, entry.body, { mode: entry.mode })
      }
    const written = path.join(plan.scratch, "repair.cpio")
    await writeInitrd({
      rootTarball,
      dir,
      scratch: plan.scratch,
      initrd: written,
    })
    await rename(written, plan.initrd)
  } finally {
    await rm(plan.scratch, { recursive: true, force: true })
  }
  return plan.initrd
}

/** Why the repair boot cannot run now, without fetching or building anything; null when it can. */
export async function repairBootMissing(
  stateDir: string,
): Promise<string | null> {
  const [plan, pins, builder] = await Promise.all([
    gatherRepairBoot(stateDir),
    readBuilderPins(),
    gatherBinary(stateDir, BUILDER),
  ])
  if (builder.state !== "built") return "its builder machine is not built"
  if (!(await exists(plan.initrd))) return "its initrd is not made"
  if (!(await exists(path.join(plan.pinsDir, kernelImageName(pins.kernel)))))
    return "its kernel is not unpacked"
  return null
}

/** The repair boot's memory, the image build's: a balance of a 2 GiB disk ran in it. */
const REPAIR_MEMORY = 1024 ** 3

/**
 * Boot the repair on `data.img`, with the VM stopped and its launcher's
 * lock held (`launcherHeld`), so no launcher opens the disk beside it. It
 * grows nothing: its caller grows the file first. Each console line is
 * handed to `log` as it comes; the report is read from the protocol's.
 * Refuses, saying why, when the boot is not ready: it never fetches or
 * compiles here.
 */
export async function repairDataDisk(input: {
  readonly stateDir: string
  readonly launcherHeld: LauncherLockHeld
  readonly log: (line: string) => void
}): Promise<RepairReport> {
  const missing = await repairBootMissing(input.stateDir)
  if (missing !== null)
    throw new Error(`the repair boot is not ready: ${missing}`)
  const [plan, pins, builder] = await Promise.all([
    gatherRepairBoot(input.stateDir),
    readBuilderPins(),
    gatherBinary(input.stateDir, BUILDER),
  ])
  const lines: RepairLine[] = []
  await runBuilder(
    builder.binary,
    [
      path.join(plan.pinsDir, kernelImageName(pins.kernel)),
      plan.initrd,
      path.join(input.stateDir, "data.img"),
      String(REPAIR_MEMORY),
      String(os.availableParallelism()),
      "-",
    ],
    line => {
      const parsed = parseRepairLine(line)
      if (parsed !== null) lines.push(parsed)
      if (line.startsWith(REPAIR_LINE_PREFIX)) input.log(line)
    },
  )
  return repairReport(lines)
}
