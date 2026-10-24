// lanehost/machine — the machine read for its health: its memory and
// pressure, the lanes directory's btrfs room, and each lane's cgroup through
// the cgroup tree a role was given read-only. Gathered here, parsed by the
// pure functions below; `@pinetrie/machine` decides what any of it means.

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import type {
  CgroupLimitHits,
  CgroupMemory,
  ControlsReadBack,
  MachineReclaim,
  MemoryCounters,
  Pressure,
  StoreRoom,
} from "@pinetrie/core"
import { holdingMount } from "./mountinfo.ts"

/** What one `machine-sample` read: the machine's memory, its btrfs room, and each container's cgroup. */
export interface MachineRead {
  readonly memory: { readonly total: number; readonly available: number }
  /** null where the kernel has no PSI. */
  readonly pressure: Pressure | null
  /** The kernel's refaults and memory stall time; null where either file could not be read. */
  readonly counters: MemoryCounters | null
  /** The machine's own reclaim; null where `/proc/vmstat` could not be read or lacks its counters. */
  readonly reclaim: MachineReclaim | null
  /** null where the lanes directory is not on btrfs, or its counters cannot be found. */
  readonly store: StoreRoom | null
  /** Each container asked for, in order; `memory` null when its cgroup was not found. */
  readonly containers: readonly ContainerRead[]
  /** The services' parent's `memory.low`; null where it does not exist, or the tree was not given. */
  readonly servicesFloor: number | null
}

/** One container's cgroup as read: its memory, and what it is held to. */
export interface ContainerRead {
  readonly id: string
  readonly memory: CgroupMemory | null
  readonly controls: ControlsReadBack
}

const NO_CONTROLS: ControlsReadBack = { processesMax: null, cpuWeight: null }

/** A container's full id, as Docker names its cgroup: never a path of the caller's. */
export const isContainerId = (id: string): boolean => /^[0-9a-f]{64}$/.test(id)

/** `/proc/meminfo`'s total and available memory, in bytes. */
export function parseMeminfo(
  text: string,
): { readonly total: number; readonly available: number } | null {
  const kib = (name: string) => {
    const found = new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(text)
    return found === null ? null : Number(found[1]) * 1024
  }
  const total = kib("MemTotal")
  const available = kib("MemAvailable")
  return total === null || available === null ? null : { total, available }
}

/**
 * A pressure file's `avg10`s (`/proc/pressure/memory`, a cgroup's
 * `memory.pressure`). A file with no `full` line (the machine's CPU) reads
 * `full` as 0.
 */
export function parsePressure(text: string): Pressure | null {
  const avg10 = (line: "some" | "full") => {
    const found = new RegExp(`^${line} avg10=(\\d+(?:\\.\\d+)?)`, "m").exec(
      text,
    )
    return found === null ? null : Number(found[1])
  }
  const some = avg10("some")
  if (some === null) return null
  return { someAvg10: some, fullAvg10: avg10("full") ?? 0 }
}

/** A pressure file's `total=`s: the µs some task, and every task, stalled; null without a `some` line. */
export function parsePressureTotals(
  text: string,
): { readonly some: number; readonly full: number } | null {
  const total = (line: "some" | "full") => {
    const found = new RegExp(`^${line} .*total=(\\d+)`, "m").exec(text)
    return found === null ? null : Number(found[1])
  }
  const some = total("some")
  return some === null ? null : { some, full: total("full") ?? 0 }
}

/**
 * The counters from a `workingset_refault_*` file (`/proc/vmstat`, a
 * cgroup's `memory.stat`) and a pressure file; null when either says none.
 */
export function memoryCounters(
  refaults: string | null,
  pressure: string | null,
): MemoryCounters | null {
  if (refaults === null || pressure === null) return null
  const counts = keyedCounts(refaults)
  const anon = counts.get("workingset_refault_anon")
  const file = counts.get("workingset_refault_file")
  const stalls = parsePressureTotals(pressure)
  return anon === undefined || file === undefined || stalls === null
    ? null
    : {
        refaultAnon: anon,
        refaultFile: file,
        stallSomeUs: stalls.some,
        stallFullUs: stalls.full,
      }
}

/** `memory.stat`'s inactive page cache: what reclaim gives back first, so a cgroup full of it still has room. */
export const parseInactiveFile = (text: string): number =>
  keyedCounts(text).get("inactive_file") ?? 0

/** A flat-keyed cgroup file (`memory.stat`, `memory.events`, `/proc/vmstat`): each name's number. */
const keyedCounts = (text: string): ReadonlyMap<string, number> =>
  new Map(
    text.split("\n").flatMap(line => {
      const [name, value] = line.trim().split(/\s+/)
      return name === undefined || value === undefined || value === ""
        ? []
        : [[name, Number(value)] as const]
    }),
  )

/** `memory.stat`'s memory of the cgroup's own and its cache, in bytes. */
export function parseMemoryStat(text: string): {
  readonly anon: number
  readonly file: number
} {
  const stat = keyedCounts(text)
  return { anon: stat.get("anon") ?? 0, file: stat.get("file") ?? 0 }
}

/** `memory.events`' count of processes killed for memory; its limits' counts are `parseLimitHits`'. */
export const parseMemoryEvents = (text: string): number =>
  keyedCounts(text).get("oom_kill") ?? 0

/** `memory.events`' counts of the cgroup's use meeting `memory.max` and going over `memory.high`. */
export function parseLimitHits(text: string): CgroupLimitHits {
  const events = keyedCounts(text)
  return { max: events.get("max") ?? 0, high: events.get("high") ?? 0 }
}

/**
 * `/proc/vmstat`'s reclaim counters. `allocstall_*` is one line per memory
 * zone, and which zones there are differs by machine, so every one is
 * summed. Null when any is missing.
 */
export function parseReclaim(vmstat: string): MachineReclaim | null {
  const counts = keyedCounts(vmstat)
  const stalls = [...counts].filter(([name]) => name.startsWith("allocstall_"))
  const scannedDirect = counts.get("pgscan_direct")
  const scannedByKswapd = counts.get("pgscan_kswapd")
  return stalls.length === 0 ||
    scannedDirect === undefined ||
    scannedByKswapd === undefined
    ? null
    : {
        allocStalls: stalls.reduce((sum, [, n]) => sum + n, 0),
        scannedDirect,
        scannedByKswapd,
      }
}

/** `memory.max`: bytes, or null for `max`, no ceiling. */
export function parseMemoryMax(text: string): number | null {
  return parseCgroupNumber(text)
}

/**
 * A cgroup file of one number (`memory.max`, `memory.low`, `pids.max`,
 * `cpu.weight`): its number, or null for `max` or anything else.
 */
export function parseCgroupNumber(text: string): number | null {
  const value = text.trim()
  return value === "max" || !/^\d+$/.test(value) ? null : Number(value)
}

/** One kind of chunk's counters, under `/sys/fs/btrfs/<fsid>/allocation/<kind>/`. */
export interface ChunkCounters {
  /** `total_bytes`: what its chunks can hold. */
  readonly total: number
  /** `bytes_used`. */
  readonly used: number
  /** `disk_total`: what its chunks take of the devices, a profile's copies counted. */
  readonly diskTotal: number
}

/** The room from btrfs's counters: unallocated is the devices' size less every kind's chunks on disk. */
export function planBtrfsRoom(input: {
  readonly deviceBytes: readonly number[]
  readonly data: ChunkCounters
  readonly metadata: ChunkCounters
  readonly system: ChunkCounters
}): StoreRoom {
  const size = input.deviceBytes.reduce((a, b) => a + b, 0)
  const allocated =
    input.data.diskTotal + input.metadata.diskTotal + input.system.diskTotal
  return {
    size,
    unallocated: Math.max(0, size - allocated),
    data: { total: input.data.total, used: input.data.used },
    metadata: { total: input.metadata.total, used: input.metadata.used },
  }
}

/**
 * The services' parent cgroup at the tree's root, holding their floor
 * (`memory.low`): the lane VM's `init` makes it at boot, and Docker puts a
 * service's container under it (`CgroupParent`).
 */
export const SERVICES_CGROUP = "pinetrie-services"

/**
 * Where a container's cgroup may be under the tree, in the order tried:
 * cgroupfs's, under Docker's own parent or the services', then systemd's.
 */
export const cgroupCandidates = (id: string): readonly string[] => [
  `docker/${id}`,
  `${SERVICES_CGROUP}/${id}`,
  `system.slice/docker-${id}.scope`,
]

/** A block device's name, as `/sys/fs/btrfs/<fsid>/devices/` lists it: `/dev/vdb` is `vdb`. */
export const deviceName = (source: string): string | null =>
  source.startsWith("/dev/") && !source.slice(5).includes("/")
    ? source.slice(5)
    : null

// --- gathering ---------------------------------------------------------------

const PROC = "/proc"
const BTRFS = "/sys/fs/btrfs"
/** Bytes in one sector of a block device's `size` file, whatever the device's own sector. */
const SECTOR = 512

const readOrNull = (p: string): Promise<string | null> =>
  readFile(p, "utf8").catch(() => null)

/** Each container's cgroup directory once found: a container keeps its cgroup for its life. */
const cgroupDirs = new Map<string, string>()

async function findCgroupDir(tree: string, id: string): Promise<string | null> {
  const known = cgroupDirs.get(id)
  if (known !== undefined) return known
  for (const candidate of cgroupCandidates(id)) {
    const dir = path.join(tree, candidate)
    if ((await readOrNull(path.join(dir, "memory.current"))) !== null) {
      cgroupDirs.set(id, dir)
      return dir
    }
  }
  return null
}

async function readCgroup(dir: string): Promise<CgroupMemory | null> {
  const [current, stat, events, pressure, max] = await Promise.all(
    [
      "memory.current",
      "memory.stat",
      "memory.events",
      "memory.pressure",
      "memory.max",
    ].map(f => readOrNull(path.join(dir, f))),
  )
  if (current == null || stat == null || events == null) return null
  return {
    current: Number(current.trim()),
    ...parseMemoryStat(stat),
    limit: max == null ? null : parseMemoryMax(max),
    oomKills: parseMemoryEvents(events),
    limitHits: parseLimitHits(events),
    pressure: pressure == null ? null : parsePressure(pressure),
  }
}

async function readControls(dir: string): Promise<ControlsReadBack> {
  const [processesMax, cpuWeight] = await Promise.all(
    ["pids.max", "cpu.weight"].map(f => readOrNull(path.join(dir, f))),
  )
  return {
    processesMax: processesMax == null ? null : parseCgroupNumber(processesMax),
    cpuWeight: cpuWeight == null ? null : parseCgroupNumber(cpuWeight),
  }
}

/**
 * Each container's cgroup under `tree`, by its full id: its memory and its
 * controls, each null or empty where its cgroup was not found. A container
 * not asked for has stopped, and its cgroup is forgotten.
 */
export async function readContainers(
  tree: string | null,
  ids: readonly string[],
): Promise<readonly ContainerRead[]> {
  for (const id of cgroupDirs.keys())
    if (!ids.includes(id)) cgroupDirs.delete(id)
  return Promise.all(
    ids.map(async id => {
      const dir = tree === null ? null : await findCgroupDir(tree, id)
      return dir === null
        ? { id, memory: null, controls: NO_CONTROLS }
        : {
            id,
            memory: await readCgroup(dir),
            controls: await readControls(dir),
          }
    }),
  )
}

/** The services' parent's floor under `tree`: its `memory.low`, null where it is not there. */
export async function readServicesFloor(
  tree: string | null,
): Promise<number | null> {
  if (tree === null) return null
  const low = await readOrNull(path.join(tree, SERVICES_CGROUP, "memory.low"))
  return low === null ? null : parseCgroupNumber(low)
}

async function readCounters(dir: string): Promise<ChunkCounters | null> {
  const [total, used, diskTotal] = await Promise.all(
    ["total_bytes", "bytes_used", "disk_total"].map(f =>
      readOrNull(path.join(dir, f)),
    ),
  )
  if (total == null || used == null || diskTotal == null) return null
  return {
    total: Number(total.trim()),
    used: Number(used.trim()),
    diskTotal: Number(diskTotal.trim()),
  }
}

/** The room of the btrfs filesystem holding `lanesDir`: the one whose `devices/` lists its mount's device. */
async function readStore(lanesDir: string): Promise<StoreRoom | null> {
  const mountinfo = await readOrNull(`${PROC}/self/mountinfo`)
  const mount = mountinfo === null ? null : holdingMount(mountinfo, lanesDir)
  const device = mount?.fs === "btrfs" ? deviceName(mount.source) : null
  if (device === null) return null
  const fsids = await readdir(BTRFS).catch(() => [] as string[])
  for (const fsid of fsids) {
    const devices = await readdir(path.join(BTRFS, fsid, "devices")).catch(
      () => [] as string[],
    )
    if (!devices.includes(device)) continue
    const sizes = await Promise.all(
      devices.map(d =>
        readOrNull(path.join(BTRFS, fsid, "devices", d, "size")),
      ),
    )
    const allocation = path.join(BTRFS, fsid, "allocation")
    const [data, metadata, system] = await Promise.all(
      ["data", "metadata", "system"].map(k =>
        readCounters(path.join(allocation, k)),
      ),
    )
    if (data == null || metadata == null || system == null) return null
    if (sizes.some(s => s === null)) return null
    return planBtrfsRoom({
      deviceBytes: sizes.map(s => Number(s?.trim()) * SECTOR),
      data,
      metadata,
      system,
    })
  }
  return null
}

/**
 * The machine as the role sees it. `cgroup` is where the cgroup tree was
 * bound, null when it was not; `containers` are full ids, and any other
 * value is refused.
 */
export async function readMachine(input: {
  readonly lanesDir: string
  readonly cgroup: string | null
  readonly containers: readonly string[]
}): Promise<MachineRead> {
  for (const id of input.containers)
    if (!isContainerId(id))
      throw new Error(`not a container's id: ${JSON.stringify(id)}`)
  const [meminfo, pressure, vmstat, store, tree] = await Promise.all([
    readOrNull(`${PROC}/meminfo`),
    readOrNull(`${PROC}/pressure/memory`),
    readOrNull(`${PROC}/vmstat`),
    readStore(input.lanesDir),
    input.cgroup === null
      ? Promise.resolve(false)
      : readdir(input.cgroup).then(
          () => true,
          () => false,
        ),
  ])
  const memory = meminfo === null ? null : parseMeminfo(meminfo)
  if (memory === null) throw new Error("/proc/meminfo could not be read")
  const given = tree ? input.cgroup : null
  const [containers, servicesFloor] = await Promise.all([
    readContainers(given, input.containers),
    readServicesFloor(given),
  ])
  return {
    memory,
    pressure: pressure === null ? null : parsePressure(pressure),
    counters: memoryCounters(vmstat, pressure),
    reclaim: vmstat === null ? null : parseReclaim(vmstat),
    store,
    containers,
    servicesFloor,
  }
}
