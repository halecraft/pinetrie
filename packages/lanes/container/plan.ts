// lanes/container/plan — Apple's `container` as a lane runtime: every
// decision, pure (ADR-0034). A lane's disk is a volume of its own, an ext4
// image, and a snapshot is an APFS clone of that image under the project's
// `.pinetrie/snapshots/` (S40, S41).

import path from "node:path"
import {
  type ProjectRecord,
  type SnapshotId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  type ContainerShape,
  laneContainer,
  type Mount,
  type ProjectRoot,
} from "../plan.ts"
import type { ContainerFacts, DiskOp } from "../runtime-port.ts"

/** A new volume's size. The image is sparse: only written blocks take space. */
const DISK_SIZE = "64G"

/** Where a lane's disk and a snapshot's file are on the host. */
export interface DiskPaths {
  /** `container`'s volumes directory. */
  readonly volumes: string
  /** The project's `.pinetrie/snapshots/`. */
  readonly snapshots: string
}

/** A lane's volume: named as its container is. */
export const laneVolume = laneContainer

export const volumeImage = (paths: DiskPaths, volume: string): string =>
  path.join(paths.volumes, volume, "volume.img")
export const snapshotFile = (paths: DiskPaths, id: SnapshotId): string =>
  path.join(paths.snapshots, `${id}.img`)

/**
 * A mount's `container run` arguments. `--mount` separates its fields with
 * commas, and `-v` with colons, so a path with a comma takes `-v`, and one
 * with both cannot be mounted (S46 item 4). `planHostMounts` refuses such
 * paths before they get here.
 */
export function mountArgs(m: Mount): readonly string[] {
  const paths = `${m.source}${m.target}`
  if (!paths.includes(","))
    return [
      "--mount",
      `type=bind,source=${m.source},target=${m.target}${m.readonly ? ",readonly" : ""}`,
    ]
  if (!paths.includes(":"))
    return ["-v", `${m.source}:${m.target}${m.readonly ? ":ro" : ""}`]
  throw new Error(
    `${m.source} has both a comma and a colon: container cannot mount it`,
  )
}

/**
 * `container run`'s arguments for a lane, without the spec label. It mounts
 * what `planMounts` listed, each through `mountArgs`. `--init` reaps the
 * processes a timeout or an abort kills (S39 item 6).
 */
export function renderRun(shape: ContainerShape): readonly string[] {
  return [
    "run",
    "-d",
    "--init",
    "--name",
    shape.name,
    "-m",
    shape.memory,
    "-v",
    `${laneVolume(shape.lane)}:${WORKSPACE_ROOT}`,
    ...shape.mounts.flatMap(mountArgs),
    ...(shape.ssh ? ["--ssh"] : []),
    ...Object.entries(shape.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-w",
    WORKSPACE_ROOT,
    shape.image,
    "sleep",
    "infinity",
  ]
}

/** `renderRun`'s arguments with the label inserted after `run`. */
export function labelled(
  args: readonly string[],
  label: string,
): readonly string[] {
  const [first, ...rest] = args
  return [first ?? "run", "--label", label, ...rest]
}

/**
 * A journaled volume: mid-write clones of one without a journal are corrupt
 * (S41), and `container`'s default has none.
 */
export const createVolume = (
  volume: string,
  size = DISK_SIZE,
): readonly string[] => [
  "container",
  "volume",
  "create",
  "--opt",
  "journal=ordered",
  "--opt",
  `size=${size}`,
  volume,
]

/**
 * A copy-on-write clone to a temporary name, renamed into place, so the file
 * at `to` is never half-written. `/bin/cp -c` is macOS's clonefile; GNU `cp`
 * has no `-c` (S36).
 */
const cloneFile = (from: string, to: string): (readonly string[])[] => [
  ["/bin/cp", "-c", from, `${to}.tmp`],
  ["/bin/mv", "-f", `${to}.tmp`, to],
]

/**
 * A disk operation as host commands, run in order. A volume made from a
 * snapshot is created by `container`, then has its image replaced by a clone
 * of the snapshot's file (S40). `delete` is `container volume rm`, whose
 * failure for a missing volume the caller ignores (`ignoreFailure`).
 */
export function planDiskCommands(
  op: DiskOp,
  paths: DiskPaths,
): {
  readonly commands: readonly (readonly string[])[]
  readonly ignoreFailure: boolean
} {
  switch (op.kind) {
    case "create":
      return {
        commands: [createVolume(laneVolume(op.lane))],
        ignoreFailure: false,
      }
    case "restore": {
      const volume = laneVolume(op.lane)
      return {
        commands: [
          createVolume(volume),
          ...cloneFile(
            snapshotFile(paths, op.from),
            volumeImage(paths, volume),
          ),
        ],
        ignoreFailure: false,
      }
    }
    case "snapshot":
      return {
        commands: cloneFile(
          volumeImage(paths, laneVolume(op.lane)),
          snapshotFile(paths, op.snapshot),
        ),
        ignoreFailure: false,
      }
    case "delete":
      return {
        commands: [["container", "volume", "rm", laneVolume(op.lane)]],
        ignoreFailure: true,
      }
    case "deleteSnapshots":
      // One after another: each deletion of a clone takes about 280 ms (S40
      // item 4), so the host does not await this on anyone's path.
      return {
        commands: op.ids.map(id => ["/bin/rm", "-f", snapshotFile(paths, id)]),
        ignoreFailure: false,
      }
  }
}

/** A container's state and spec label from `container inspect`'s output; missing when unreadable. */
export function parseInspect(stdout: string, label: string): ContainerFacts {
  const missing: ContainerFacts = { state: "missing", label: null }
  try {
    const [found] = JSON.parse(stdout) as {
      status?: { state?: string }
      configuration?: { labels?: Record<string, unknown> }
    }[]
    if (found === undefined) return missing
    const value = found.configuration?.labels?.[label]
    return {
      state: found.status?.state === "running" ? "running" : "stopped",
      label: typeof value === "string" ? value : null,
    }
  } catch {
    return missing
  }
}

/** The `PATH` of an image that names none. */
const STANDARD_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

/** The image's own `PATH` from `container image inspect`'s arm64 variant; the standard one if it names none. */
export function parseImagePath(stdout: string): string {
  type Variant = {
    config?: { architecture?: string; config?: { Env?: string[] } }
  }
  const [image] = JSON.parse(stdout) as { variants?: Variant[] }[]
  const variant = image?.variants?.find(v => v.config?.architecture === "arm64")
  const env = variant?.config?.config?.Env ?? []
  const found = env.find(e => e.startsWith("PATH="))
  return found === undefined ? STANDARD_PATH : found.slice("PATH=".length)
}

/** What the host finds about `container` and the disk it clones on. */
export interface ContainerHostFacts {
  /** The project's root, or why it has none. */
  readonly root: ProjectRoot
  readonly installed: boolean
  readonly running: boolean
  readonly kernel: boolean
  /** A clone of a small file into `.pinetrie/snapshots/` shared its blocks. */
  readonly clones: boolean
}

/** Whether lanes can have their own containers here; else the first reason not. */
export function planContainerHost(f: ContainerHostFacts): ProjectRecord {
  if ("direct" in f.root)
    return { kind: "direct", root: f.root.direct, reason: f.root.reason }
  const root = f.root.ok
  const reason = !f.installed
    ? "Apple's `container` is not installed (macOS 26 on Apple silicon)"
    : !f.running
      ? "`container` is not running: `container system start`"
      : !f.kernel
        ? "`container` has no kernel: `container system kernel set --recommended`"
        : !f.clones
          ? `${root}/.pinetrie/snapshots cannot clone copy-on-write: it must be on the same APFS volume as \`container\`'s data`
          : null
  return reason === null
    ? { kind: "lanes", root, rootDefault: "own" }
    : { kind: "direct", root, reason }
}
