// vm/plan — the lane VM's decisions.

import { createHash } from "node:crypto"
import path from "node:path"
import type { Pin } from "./pinned.ts"
import type { ShareEntry } from "./protocol.ts"

/** The files in `image/` the build reads. Each is part of the image's identity. */
export const IMAGE_FILES = [
  "manifest.json",
  "build.sh",
  "init",
  "clock",
  "stage1-init",
  "daemon.json",
] as const
export type ImageFile = (typeof IMAGE_FILES)[number]

/** The image's sources, by file name. */
export type ImageSources = Readonly<Record<ImageFile, string>>

/** The three files the launcher boots, as the build writes them. */
export const IMAGE_OUTPUTS = ["Image", "stage1.cpio", "system.erofs"] as const

/**
 * The image's identity: a hash of its sources. The manifest pins every
 * package; the scripts decide what is done with them, and `daemon.json` how
 * Docker runs, so a change to any makes another image.
 */
export function imageKey(sources: ImageSources): string {
  const hash = createHash("sha256")
  for (const name of IMAGE_FILES) hash.update(`${name}\0${sources[name]}\0`)
  return hash.digest("hex").slice(0, 16)
}

/** The VM's state, one per user: `$XDG_STATE_HOME/pinetrie/vm`. */
export const vmStateDir = (
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string =>
  path.join(
    env.XDG_STATE_HOME ?? path.join(home, ".local", "state"),
    "pinetrie",
    "vm",
  )

/** Where the image for `key` is kept. */
export const imageDir = (stateDir: string, key: string): string =>
  path.join(stateDir, "images", key)

/** `sha256sum`'s output as file name → hash; a line that is not one is skipped. */
export function parseSums(text: string): ReadonlyMap<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim())
    if (m?.[1] !== undefined && m[2] !== undefined) sums.set(m[2], m[1])
  }
  return sums
}

/** An image directory's record of its sources' hashes, beside `SHA256SUMS`, in its format. */
export const IMAGE_SOURCE_SUMS = "SOURCES.SHA256SUMS"

/** The record's text: one `sha256  name` line per file of `IMAGE_FILES`, in order. */
export const imageSourceSums = (sources: ImageSources): string =>
  IMAGE_FILES.map(
    name =>
      `${createHash("sha256").update(sources[name]).digest("hex")}  ${name}\n`,
  ).join("")

/**
 * The image files whose hashes differ between two records (read with
 * `parseSums`), in `IMAGE_FILES`' order; null when the running image has no
 * record, as an image built before records were kept has none. A file
 * named in one record only counts as changed.
 */
export function changedImageFiles(
  running: ReadonlyMap<string, string> | null,
  built: ReadonlyMap<string, string>,
): readonly ImageFile[] | null {
  if (running === null) return null
  return IMAGE_FILES.filter(name => running.get(name) !== built.get(name))
}

/**
 * Why a built image cannot be used, or null: `SHA256SUMS` must name each
 * output with the hash `actual` gives it (null for a file that is missing).
 */
export function imageRefusal(
  sums: ReadonlyMap<string, string>,
  actual: Readonly<Record<string, string | null>>,
): string | null {
  for (const name of IMAGE_OUTPUTS) {
    const want = sums.get(name)
    const have = actual[name] ?? null
    if (want === undefined) return `SHA256SUMS does not name ${name}`
    if (have === null) return `${name} is missing`
    if (have !== want) return `${name} does not match SHA256SUMS`
  }
  return null
}

const GiB = 1024 ** 3

/** The VM's memory: a quarter of the Mac's, between 4 and 16 GiB. */
export const vmMemory = (macMemory: number): number =>
  Math.min(16 * GiB, Math.max(4 * GiB, Math.floor(macMemory / 4)))

/**
 * How the launcher attaches the VM's disks, in Virtualization's names: ours,
 * or Apple's defaults.
 */
export interface LauncherDisks {
  readonly synchronization: "fsync" | "full"
  readonly caching: "cached" | "automatic"
}

/**
 * Apple's defaults, `full` and `automatic`, make every flush the guest asks
 * for an `F_FULLFSYNC` on the Mac, and every `docker run` about 500 ms.
 */
export const LAUNCHER_DISKS: LauncherDisks = {
  synchronization: "fsync",
  caching: "cached",
}

/** What the launcher's argv is made from, gathered before it starts. */
export interface LauncherFacts {
  readonly stateDir: string
  /** The image's directory (`imageDir`). */
  readonly image: string
  readonly slots: number
  /** The Mac's memory in bytes; the VM takes `vmMemory` of it. */
  readonly macMemory: number
  readonly cpus: number
  /** gvproxy's binary, where `ensureGvproxy` puts it. */
  readonly gvproxy: string
}

/** The launcher's argv after its binary, in the order `launcher.swift` reads it. */
export const launcherArgs = (f: LauncherFacts): readonly string[] => [
  f.stateDir,
  f.image,
  String(f.slots),
  String(vmMemory(f.macMemory)),
  String(f.cpus),
  f.gvproxy,
  LAUNCHER_DISKS.synchronization,
  LAUNCHER_DISKS.caching,
]

/** A launcher's command line in `ps`: its binary's name, its state directory, and its image's key. */
const LAUNCHER_LINE = /\/(launcher-[0-9a-f]+) (.+?) \2\/images\/([^ /]+) /

/**
 * The image and launcher a running launcher of `stateDir` names in its
 * arguments (`launcherArgs`), or null for any other line. Launchers of
 * other state directories run over the same binaries, the suites' among
 * them, and are not this one.
 */
export function launcherFromCommandLine(
  line: string,
  stateDir: string,
): { readonly image: string; readonly launcher: string } | null {
  const m = LAUNCHER_LINE.exec(line)
  if (m?.[1] === undefined || m[3] === undefined || m[2] !== stateDir)
    return null
  return { image: m[3], launcher: m[1] }
}

/** gvproxy's address for the Mac's loopback, in the VM's network. */
export const GVPROXY_HOST_ADDRESS = "192.168.127.254"

/** Where a slot's directories are in the VM. */
const SHARES_ROOT = "/mnt/host-shares"

/** A host directory lanes may mount, and whether they may write it. */
export interface ShareDir {
  readonly source: string
  readonly readOnly: boolean
}

/** One slot's share, as it was filled. */
export interface Fill {
  readonly slot: number
  readonly entries: readonly ShareEntry[]
}

const entryName = (source: string) =>
  createHash("sha256").update(source).digest("hex").slice(0, 16)

/**
 * A slot's share entries. Each entry is named by a hash of its source, so a
 * directory has one name whatever else is shared; one source given twice is
 * one entry, read-write if either is.
 */
export function planShares(dirs: readonly ShareDir[]): readonly ShareEntry[] {
  const readOnly = new Map<string, boolean>()
  for (const d of dirs)
    readOnly.set(d.source, (readOnly.get(d.source) ?? true) && d.readOnly)
  return [...readOnly]
    .map(([source, ro]) => ({ name: entryName(source), source, readOnly: ro }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Where a slot's entries are in the VM, for the stop of what binds into it. */
export const slotRoot = (slot: number): string => `${SHARES_ROOT}/${slot}/`

/** The slots of a host that hold one source: at most one of each kind. */
export interface Held {
  readonly readOnly: number | null
  readonly readWrite: number | null
}

/**
 * Every source a host's slots hold, by kind. One slot per kind is all it can
 * record, so a source is never in two slots read-write, which loses appends
 * and refuses creates.
 */
export type Holdings = ReadonlyMap<string, Held>

export const NOTHING_HELD: Holdings = new Map()

/**
 * `held` with `fill`'s entries. A kind a source is held in already keeps its
 * first slot: `planWidening` never asks for it again.
 */
export function holdFill(held: Holdings, fill: Fill): Holdings {
  const next = new Map(held)
  for (const e of fill.entries) {
    const was = next.get(e.source) ?? { readOnly: null, readWrite: null }
    next.set(
      e.source,
      e.readOnly
        ? { ...was, readOnly: was.readOnly ?? fill.slot }
        : { ...was, readWrite: was.readWrite ?? fill.slot },
    )
  }
  return next
}

/**
 * Where a source is in the VM: its read-write entry if a slot holds one,
 * else its read-only one. Throws for a path no slot holds: a lane binding
 * outside its host's slots would see nothing the host gave it.
 */
export function sharePath(held: Holdings, source: string): string {
  const h = held.get(source)
  const slot = h?.readWrite ?? h?.readOnly ?? null
  if (slot === null)
    throw new Error(`${source} is not shared into this host's slots`)
  return `${slotRoot(slot)}${entryName(source)}`
}

/**
 * The directories a new slot must share for `wanted`: those no slot holds,
 * and those wanted read-write that no slot holds read-write. A read-only
 * entry is never replaced: refilling a slot cuts every bind into it.
 */
export function planWidening(
  held: Holdings,
  wanted: readonly ShareDir[],
): readonly ShareDir[] {
  return planShares(wanted)
    .filter(w => {
      const h = held.get(w.source)
      return h === undefined || (!w.readOnly && h.readWrite === null)
    })
    .map(({ source, readOnly }) => ({ source, readOnly }))
}

/** Where the lane VM cannot run: no image is built or booted there. */
export type VmHostRefusal = "not-mac" | "not-apple-silicon" | "old-macos"

/** Why this machine cannot run the lane VM at all, or null. */
export function vmHostRefusal(f: {
  readonly platform: NodeJS.Platform
  readonly arch: string
  /** Darwin's major version (`os.release()`): 22 is macOS 13. */
  readonly darwin: number
}): VmHostRefusal | null {
  if (f.platform !== "darwin") return "not-mac"
  if (f.arch !== "arm64") return "not-apple-silicon"
  if (f.darwin < 22) return "old-macos"
  return null
}

/** Whether one of the Mac's binaries is built, can be, or cannot without Xcode's tools. */
export type BinaryState = "built" | "buildable" | "no-swiftc"

/** What decides whether a host starts the VM, joins it, or cannot. */
export interface VmFacts {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly darwin: number
  /** The launcher's control.sock answers: the VM runs. */
  readonly answering: boolean
  /** The image for the current sources is built and whole. */
  readonly image: boolean
  readonly launcher: BinaryState
  /** The image's builder: it is needed only when the image is not built. */
  readonly builder: BinaryState
}

export type VmRefusal = VmHostRefusal | "no-swiftc"

export type VmPlan =
  | { readonly kind: "join" }
  /** Start the VM, building its image first when it is not built. */
  | { readonly kind: "start"; readonly buildImage: boolean }
  | { readonly kind: "refused"; readonly refusal: VmRefusal }

/**
 * Why this host could not start the current VM, or null: it needs the
 * launcher, and the image or what builds it. A host that finds an older VM
 * running replaces it only when this is null.
 */
export function vmStartRefusal(
  f: Omit<VmFacts, "answering">,
): VmRefusal | null {
  const host = vmHostRefusal(f)
  if (host !== null) return host
  if (f.launcher === "no-swiftc") return "no-swiftc"
  if (!f.image && f.builder === "no-swiftc") return "no-swiftc"
  return null
}

/** Join a running VM; else start one, building what it lacks, when everything that takes is here. */
export function planVm(f: VmFacts): VmPlan {
  const host = vmHostRefusal(f)
  if (host !== null) return { kind: "refused", refusal: host }
  if (f.answering) return { kind: "join" }
  const refusal = vmStartRefusal(f)
  if (refusal !== null) return { kind: "refused", refusal }
  return { kind: "start", buildImage: !f.image }
}

/** Why the lane VM cannot start, with what would let it. */
export function vmWords(r: VmRefusal): string {
  switch (r) {
    case "not-mac":
      return "the lane VM runs only on the Mac; on Linux, lanes use the host's Docker"
    case "not-apple-silicon":
      return "the lane VM needs a Mac with Apple silicon"
    case "old-macos":
      return "the lane VM needs macOS 13 or later"
    case "no-swiftc":
      return "the lane VM's launcher and image builder are built with Xcode's command line tools, which are not installed: `xcode-select --install`"
  }
}

/** What decides whether `pnpm vm:build` and `pnpm build` build the image. */
export interface VmBuildFacts {
  readonly host: VmHostRefusal | null
  /** The image for the current sources is built and whole. */
  readonly image: boolean
  readonly builder: BinaryState
  /** `--force`: build even when the image is whole. */
  readonly force: boolean
}

export type VmBuildPlan =
  | { readonly kind: "present" }
  | { readonly kind: "build" }
  /** This machine runs no lane VM, so needs no image. */
  | { readonly kind: "not-needed"; readonly why: VmHostRefusal }
  | {
      readonly kind: "refused"
      readonly why:
        | { readonly kind: "no-swiftc" }
        | { readonly kind: "forced"; readonly host: VmHostRefusal }
    }

/** Whether to build the lane VM's image here. */
export function planVmBuild(f: VmBuildFacts): VmBuildPlan {
  if (f.host !== null)
    return f.force
      ? { kind: "refused", why: { kind: "forced", host: f.host } }
      : { kind: "not-needed", why: f.host }
  if (f.image && !f.force) return { kind: "present" }
  if (f.builder === "no-swiftc")
    return { kind: "refused", why: { kind: "no-swiftc" } }
  return { kind: "build" }
}

/** What a build must do before its 20 s: each worded in `vmBuildWords`. */
interface VmBuildFirst {
  readonly compile: boolean
  readonly fetch: boolean
}

/**
 * A build's plan in words: why nothing is built, why it cannot be, or what
 * is about to happen. `present` is worded by its caller, which names the
 * image's directory.
 */
export function vmBuildWords(
  plan: Exclude<VmBuildPlan, { kind: "present" }>,
  first: VmBuildFirst,
): string {
  switch (plan.kind) {
    case "not-needed":
      return `nothing to build here: ${vmWords(plan.why)}, so no image is needed (\`pnpm vm:build --force\` builds one anyway, on a Mac with Apple silicon for now)`
    case "refused":
      return plan.why.kind === "no-swiftc"
        ? vmWords("no-swiftc")
        : `the lane VM's image is built only on a Mac with Apple silicon, for now: ${vmWords(plan.why.host)}`
    case "build": {
      const before = [
        ...(first.compile ? ["compiling its builder"] : []),
        ...(first.fetch
          ? ["fetching Alpine's kernel and root, 43 MB, once"]
          : []),
      ]
      return before.length === 0
        ? "building the lane VM's image (about 20 s)"
        : `building the lane VM's image: ${before.join(" and ")}, then about 20 s`
    }
  }
}

/** Who asks what the lane VM runs: a host holding a lease on it, or `vm:build`, holding none. */
export type VmAsker = "host" | "build"

/**
 * The leases on the VM held by hosts other than the asker, or null when the
 * launcher did not say: a host's own lease is among `leases`, and
 * `vm:build` holds none.
 */
export const otherHolders = (
  leases: number | null,
  asker: VmAsker,
): number | null =>
  leases === null ? null : asker === "host" ? leases - 1 : leases

/** What the lane VM's image and launcher change from, and to. */
export interface VmChange {
  readonly from: {
    readonly image: string | null
    readonly launcher: string | null
  }
  readonly to: { readonly image: string; readonly launcher: string }
  /** The image files that changed; null when the running image's sources were not recorded. */
  readonly changedFiles: readonly ImageFile[] | null
}

/** What happens to the VM found running, and why (`planVmVersion`). */
export type VmVersion =
  | { readonly kind: "current"; readonly image: string }
  /** Out of date, and no other host holds it: replaced now, or at the next host's start. */
  | { readonly kind: "retire"; readonly change: VmChange }
  /** Out of date, held by other hosts: replaced once the last of them stops. */
  | {
      readonly kind: "stale"
      readonly change: VmChange
      readonly others: number
    }
  /**
   * Out of date, from a launcher that can be retired but did not say how
   * many hosts hold it (it refused `status`): replaced at the start of a
   * host that holds it alone.
   */
  | { readonly kind: "holders-unknown"; readonly change: VmChange }
  /** A launcher too old to be retired: it stops by itself after its last host. */
  | { readonly kind: "old-launcher"; readonly change: VmChange }

/**
 * Whether the VM running is the one the asker would start, its image and
 * its launcher, and when one out of date is replaced: only when no other
 * host holds a lease on it, so no other host's lanes are cut off. Whether
 * the launcher can be retired and how many hosts hold it are apart: a
 * launcher that refuses `status` takes `retire` yet does not say.
 */
export function planVmVersion(input: {
  readonly running: {
    readonly image: string | null
    readonly launcher: string | null
  }
  /** The launcher takes `retire`: it sent the VM's identity. */
  readonly retirable: boolean
  readonly want: { readonly image: string; readonly launcher: string }
  /** `otherHolders`. */
  readonly othersHolding: number | null
  readonly changedFiles: readonly ImageFile[] | null
}): VmVersion {
  const { running, want } = input
  if (running.image === want.image && running.launcher === want.launcher)
    return { kind: "current", image: want.image }
  const change = { from: running, to: want, changedFiles: input.changedFiles }
  if (!input.retirable) return { kind: "old-launcher", change }
  if (input.othersHolding === null) return { kind: "holders-unknown", change }
  return input.othersHolding === 0
    ? { kind: "retire", change }
    : { kind: "stale", change, others: input.othersHolding }
}

/** `a`, `a and b`, `a, b and c`. */
const listWords = (items: readonly string[]): string =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`

/**
 * What the VM runs, against what the asker would start: both images and
 * what differs between them. Every line about an out-of-date VM wraps it,
 * after "the lane VM runs".
 */
export function vmChangeWords(c: VmChange): string {
  const image =
    c.from.image === c.to.image
      ? `image ${c.to.image}`
      : c.from.image === null
        ? `an image its launcher does not name, rather than ${c.to.image}`
        : `image ${c.from.image} rather than ${c.to.image}, ${
            c.changedFiles === null
              ? "whose sources were not recorded"
              : c.changedFiles.length === 0
                ? "from the same sources"
                : `in which ${listWords(c.changedFiles)} ${c.changedFiles.length === 1 ? "differs" : "differ"}`
          }`
  return c.from.launcher === c.to.launcher
    ? image
    : `${image}, and its launcher is older`
}

const REPLACE_OLD_LAUNCHER =
  "stop every pine·trie host, then `pkill -TERM -f 'pinetrie/vm/bin/launcher-'`"

/** What happens to the VM found running, worded for the one asking. */
export function vmVersionWords(v: VmVersion, asker: VmAsker): string {
  if (v.kind === "current")
    return asker === "host"
      ? `the lane VM runs ${v.image}, this host's image and launcher`
      : `the lane VM runs ${v.image}, this image`
  const runs = `the lane VM runs ${vmChangeWords(v.change)}`
  switch (v.kind) {
    case "retire":
      return asker === "host"
        ? `${runs}: this host replaces it now`
        : `${runs}: the next host to start replaces it`
    case "stale": {
      const hold = v.others === 1 ? "host holds a lease" : "hosts hold leases"
      return asker === "host"
        ? `${runs}, and ${v.others} other ${hold} on it: this host joins it, and it is replaced when the last of them stops`
        : `${runs}, and ${v.others} ${hold} on it: it is replaced once the last of them stops`
    }
    case "holders-unknown":
      return asker === "host"
        ? `${runs}, and its launcher does not say how many hosts hold it: this host joins it`
        : `${runs}: it is replaced at the start of a host that holds it alone (its launcher does not say how many hosts hold it)`
    case "old-launcher":
      return asker === "host"
        ? `${runs}, from a launcher that cannot be replaced from here: this host joins it. To replace it, ${REPLACE_OLD_LAUNCHER}; it also stops by itself 10 minutes after its last host`
        : `${runs}, from a launcher no host can replace: it stops by itself 10 minutes after its last host, and the next host to start replaces it. To replace it sooner, ${REPLACE_OLD_LAUNCHER}`
  }
}

/** A host that found an out-of-date VM and cannot start the current one: it keeps the old one, and says why. */
export const vmKeptWords = (change: VmChange, why: string): string =>
  `the lane VM runs ${vmChangeWords(change)}, kept: ${why}`

/** A build's one line while another process builds an image, naming it when it wrote its pid. */
export const vmBuildWaitWords = (pid: number | null): string =>
  `waiting for ${pid === null ? "another process" : `process ${pid}`}, which is building the lane VM's image`

/** `vm:build`, finding no lane VM running. */
export const vmNoneRunningWords = (image: string): string =>
  `no lane VM is running: the next host starts it from ${image}`

/**
 * One build at a time, of any image, under `images/`: an `@pinetrie/lock`
 * lock, never removed, since a removed lock's file is a free lock: prune
 * keeps it whatever is current.
 */
export const BUILD_LOCK = "build.lock"

/** An entry of `images/`, `bin/` or `builder/`, and the process it belongs to, if any. */
export interface PruneEntry {
  readonly path: string
  /** The PID in a `.tmp-<pid>` or `.old-<pid>` name; null for anything else. */
  readonly owner: number | null
}

/**
 * The entries to remove after a build: what is not current and that no
 * running launcher names, and what a dead process left half-written.
 * Running launchers are matched by each argument's last path component,
 * since one may run from another state directory over the same `images/`
 * and `bin/` (the contract scenario's).
 */
export function planPrune(f: {
  readonly entries: readonly PruneEntry[]
  /** The names of the current image, binaries and pins. */
  readonly current: ReadonlySet<string>
  /** Every running launcher's command line. */
  readonly running: readonly string[]
  readonly alive: (pid: number) => boolean
}): readonly string[] {
  const named = new Set(
    f.running.flatMap(c => c.split(/\s+/).map(a => path.basename(a))),
  )
  return f.entries
    .filter(e => {
      if (e.owner !== null) return !f.alive(e.owner)
      const name = path.basename(e.path)
      if (name === BUILD_LOCK) return false
      return !f.current.has(name) && !named.has(name)
    })
    .map(e => e.path)
}

/** What `builder/pins.json` holds: the builder's kernel and root, and the modules it loads. */
export interface BuilderPins {
  readonly kernel: {
    readonly version: string
    readonly url: string
    readonly sha256: string
  }
  readonly root: {
    readonly version: string
    readonly url: string
    readonly sha256: string
  }
  /** Paths under the kernel's `lib/modules/<kver>/kernel/`, in load order. */
  readonly modules: readonly string[]
  /** What the repair boot adds to the builder's: `btrfs-progs` and its libraries, and the modules btrfs needs. */
  readonly repair: {
    readonly packages: readonly (Pin & { readonly name: string })[]
    /** Paths as `modules`' are, in load order, loaded after them. */
    readonly modules: readonly string[]
  }
}

/** `linux-virt`'s modules directory for its package version: `6.18.56-r0` is `6.18.56-0-virt`. */
export function kernelRelease(version: string): string {
  const m = /^(.+)-r(\d+)$/.exec(version)
  if (m === null)
    throw new Error(`linux-virt's version ${version} has no -r release`)
  return `${m[1]}-${m[2]}-virt`
}

/** A module in the kernel's package (`entry`), and the uncompressed name it is loaded as. */
export interface KernelModule {
  readonly entry: string
  readonly as: string
}

/** `paths`, under the kernel's `lib/modules/<kver>/kernel/`, as the modules an initrd loads. */
export function kernelModules(
  kernelVersion: string,
  paths: readonly string[],
): readonly KernelModule[] {
  const release = kernelRelease(kernelVersion)
  return paths.map(m => ({
    entry: `lib/modules/${release}/kernel/${m}`,
    as: path.basename(m).replace(/\.gz$/, ""),
  }))
}

/** `m/order`: the modules' file names, one a line, in load order. */
export const moduleOrder = (modules: readonly KernelModule[]): string =>
  `${modules.map(m => m.as).join("\n")}\n`

/** Everything a build's executor does, as paths and arguments. */
export interface VmBuildRun {
  readonly pinsDir: string
  readonly image: string
  readonly lock: string
  readonly scratch: string
  /** What goes into the initrd beside the root: `m/`, `init`, `src/`. */
  readonly initrdDir: string
  readonly initrd: string
  readonly modules: readonly KernelModule[]
  readonly disk: { readonly path: string; readonly bytes: number }
  readonly out: string
  /** The builder binary's arguments after its path. */
  readonly builderArgs: readonly string[]
}

/** The builder's memory and its disk: a build fits in 1 GiB, and its outputs are about 140 MB. */
const BUILD_MEMORY = 1024 ** 3
const BUILD_DISK = 1024 ** 3

/** A build of the image `key`, from `pins`, as values. */
export function planVmBuildRun(f: {
  readonly stateDir: string
  readonly key: string
  readonly pins: BuilderPins
  readonly pid: number
  readonly cpus: number
  /** The builder's kernel, unpacked (`pinnedKernel`). */
  readonly kernel: string
}): VmBuildRun {
  const image = imageDir(f.stateDir, f.key)
  const scratch = `${image}.tmp-${f.pid}`
  const modules = kernelModules(f.pins.kernel.version, f.pins.modules)
  const initrd = path.join(scratch, "initrd.cpio")
  const disk = path.join(scratch, "out.img")
  return {
    pinsDir: path.join(f.stateDir, "builder"),
    image,
    lock: path.join(path.dirname(image), BUILD_LOCK),
    scratch,
    initrdDir: path.join(scratch, "initrd"),
    initrd,
    modules,
    disk: { path: disk, bytes: BUILD_DISK },
    out: path.join(scratch, "out"),
    builderArgs: [
      f.kernel,
      initrd,
      disk,
      String(BUILD_MEMORY),
      String(f.cpus),
      "-",
    ],
  }
}

/** What `init` says when the data disk is full at its boot: no room left, and its metadata full. */
export const DATA_DISK_FULL_LINE = "data disk full"

/**
 * Whether the console's last boot (from the last `stage 1` line, stage 1
 * starting every boot) says its data disk was full. The launcher makes the
 * console anew at each start; an earlier boot's word is not this one's.
 */
export function isDiskFullAtLastBoot(console: string): boolean {
  const lines = console.split("\n")
  const lastBoot = lines.findLastIndex(l => / stage 1: /.test(l))
  return lines
    .slice(Math.max(lastBoot, 0))
    .some(l => /^T\+[\d.]+ /.test(l) && l.endsWith(` ${DATA_DISK_FULL_LINE}`))
}

/** A line of the builder's console worth a person's log: the build's own and the builder's. */
export const isBuildLogLine = (line: string): boolean =>
  /^\[(vm-build|builder)\]/.test(line)
