// lanes/shape — a lane's container as a value any runtime renders
// (`ContainerShape`), its spec label, and the files pine·trie writes for
// it: its git config and its ignores.

import { createHash } from "node:crypto"
import {
  DISK_OWN_ROOTS,
  HOST_WORKING_COPY,
  isWithin,
  LANE_HOME,
  NO_EDITOR,
  SHARED_ENV,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import type { LaneRuntime } from "./runtime-port.ts"
import {
  LANE_JJ_CONFIG,
  type LaneOwner,
  type LaneSpec,
  laneContainer,
  type Mount,
  RUNTIME_BIN,
} from "./spec.ts"

/** A directory of your working copy, shared read-write into every lane. */
export interface SharedDir {
  /** Relative to the project's root, normalized, e.g. ".plans". */
  readonly path: string
  /** Its absolute path on the host. */
  readonly source: string
}

/** Where every lane sees its ignore file's directory. */
export const IGNORE_MOUNT = "/pinetrie-git"
/** The ignore file's name, in `ignoreDir` on the host and `IGNORE_MOUNT` in a lane. */
export const IGNORE_FILE = "ignore"
/** Git's system config for every lane, beside the ignore file (`laneGitConfig`). */
export const LANE_GITCONFIG = "gitconfig"
/** The label a container's spec hash is kept under. */
export const SPEC_LABEL = "pinetrie.spec"

/** A lane's container, as any runtime would make it. */
export interface ContainerShape {
  /** `laneContainer(lane)`. */
  readonly name: string
  /** Its disk, at `/workspace`. */
  readonly lane: LaneOwner
  readonly image: string
  readonly memory: string
  /** Host paths, from `planMounts`, then what is attached. */
  readonly mounts: readonly Mount[]
  readonly env: Readonly<Record<string, string>>
  /** Where the runtime's host socket is mounted; null for none (`LaneAttached`). */
  readonly hostSocket: string | null
  /** Started in the background at each start, before the lane's wait. */
  readonly starts: readonly string[]
  /** Lanes of its own inside it: rootless Docker. */
  readonly nested: boolean
  /** Ports of the Mac's loopback it may reach (`LaneGrants.hostPorts`). */
  readonly hostPorts: readonly number[]
  /** Its states directory, read-only at `STATES_MOUNT`: a folder lane's alone. */
  readonly states: boolean
}

/**
 * A folder a shape binds that lanehost makes on the lane's disks, beside the
 * lane's disk itself: a nested lane's nested disk, a folder lane's states
 * directory. Each must be there before the container is made.
 */
export type DiskBind = "nested" | "states"

/** The folders `shape` binds that lanehost makes, in the order its mounts list them. */
export const diskBinds = (shape: ContainerShape): readonly DiskBind[] => [
  ...(shape.nested ? (["nested"] as const) : []),
  ...(shape.states ? (["states"] as const) : []),
]

/**
 * A lane's container. It mounts what `planMounts` listed, then what is
 * attached: nothing of your home directory unless a grant or a skill's root
 * names it, so credentials stay out of reach. Only variables a grant names
 * are copied from `env`; they and the attached ones come first, so
 * pine·trie's own come after them.
 */
export function planShape(
  spec: LaneSpec<LaneOwner>,
  env: Readonly<Record<string, string | undefined>>,
): ContainerShape {
  const passed = spec.grants.env.flatMap(name => {
    const value = env[name]
    return value === undefined ? [] : [[name, value] as const]
  })
  return {
    name: laneContainer(spec.lane),
    lane: spec.lane,
    image: spec.image,
    memory: spec.memory,
    mounts: [...spec.mounts, ...spec.attached.mounts],
    hostSocket: spec.attached.hostSocket,
    starts: spec.attached.starts,
    nested: spec.grants.nested,
    hostPorts: spec.grants.hostPorts,
    states: spec.states,
    env: Object.fromEntries([
      ...passed,
      ...Object.entries(spec.attached.env),
      ["JJ_USER", spec.identity.name],
      ["JJ_EMAIL", spec.identity.email],
      ["JJ_CONFIG", LANE_JJ_CONFIG],
      ["HOME", LANE_HOME],
      // The helper stamps its tools' accesses under the shared directories.
      [
        SHARED_ENV,
        spec.mounts
          .filter(m => !m.readonly && isWithin(m.target, WORKSPACE_ROOT))
          .map(m => m.target)
          .join("\n"),
      ],
      // Every repo in the lane ignores what the ignore file lists, from the
      // container's first moment: git's own variables, which jj reads too
      // An exclude line written by a step would come too late for a jj
      // command that ran first.
      ["GIT_CONFIG_COUNT", "1"],
      ["GIT_CONFIG_KEY_0", "core.excludesFile"],
      ["GIT_CONFIG_VALUE_0", `${IGNORE_MOUNT}/${IGNORE_FILE}`],
      // Git's system config is the host's (`laneGitConfig`): it trusts your
      // working copy, which a fetch reads through upload-pack, and git drops
      // the variables above for that.
      ["GIT_CONFIG_SYSTEM", `${IGNORE_MOUNT}/${LANE_GITCONFIG}`],
      ...Object.entries(NO_EDITOR),
      // Last, so the image's own programs win: the runtime brings its
      // programs for an image that has none, and never Node.
      ["PATH", `${spec.imagePath}:${RUNTIME_BIN}`],
    ]),
  }
}

/** The hash a container is labelled with (`SPEC_LABEL`): of its spec, without the label. */
export const specHash = (spec: unknown): string =>
  createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16)

/** The spec hash `runtime` labels `shape`'s container with. */
export const shapeSpecHash = (
  runtime: Pick<LaneRuntime, "runSpec">,
  shape: ContainerShape,
): string => specHash(runtime.runSpec(shape))

/**
 * Git's system config in every lane. It trusts your working copy, which
 * every lane fetches from: in a nested lane its owner is outside the lane's
 * user namespace, and git refuses a repository another user owns ("dubious
 * ownership"). Both paths: git in the work tree checks it, a fetch from it
 * checks its `.git`. It replaces an image's own `/etc/gitconfig`.
 */
export const laneGitConfig = (): string =>
  `[safe]\n\tdirectory = ${HOST_WORKING_COPY}\n\tdirectory = ${HOST_WORKING_COPY}/.git\n`

/**
 * The lane's ignore file: what no repo in a lane may track. The paths a disk
 * keeps for pine·trie, the repos and the file system, pnpm's store and each
 * shared directory.
 */
export const laneIgnores = (shared: readonly string[]): string =>
  [
    ...DISK_OWN_ROOTS.map(r => `/${r}/`),
    // pnpm keeps its store at the root of the file system it installs on,
    // which in a lane is the disk's: no repo in a lane may track it.
    "/.pnpm-store/",
    ...shared.map(p => `/${p}/`),
  ]
    .map(l => `${l}\n`)
    .join("")
