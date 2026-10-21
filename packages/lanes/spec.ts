// lanes/spec — what a lane is to every planner: its owner (a thread or the
// base's scratch lane), its container's name, its grants, what is attached
// to it, and where the lane runtime and its jj config are inside it.

import {
  isThreadId,
  RUNTIME_MKFIFO,
  RUNTIME_SHELL,
  type RuntimeShell,
  type ThreadId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"

/**
 * pine·trie's lane runtime, read-only: Node and its libraries, and what
 * core's `RUNTIME_ENTRIES` lists: in `bin/` the static programs, in
 * `shell/` pine·trie's bash and the `mkfifo` that makes its output pipes.
 */
export const RUNTIME_MOUNT = "/pinetrie-runtime"
/** The runtime's programs, as a lane sees them: on its `PATH`, last. */
export const RUNTIME_BIN = `${RUNTIME_MOUNT}/bin`
/** What runs a `bash` call, as a lane sees it, off the `PATH`. */
export const RUNTIME_SHELL_PATHS: RuntimeShell = {
  bash: `${RUNTIME_MOUNT}/${RUNTIME_SHELL}`,
  mkfifo: `${RUNTIME_MOUNT}/${RUNTIME_MKFIFO}`,
}
/** The lane's own jj config, on its disk so that forks inherit it. */
export const LANE_CONFIG_DIR = `${WORKSPACE_ROOT}/.pinetrie-lane`
export const LANE_JJ_CONFIG = `${LANE_CONFIG_DIR}/jj.toml`

declare const baseLaneBrand: unique symbol
/**
 * The scratch lane a project's base is made in (`base.ts`): no thread's, so
 * no `ThreadId`, and nothing that takes a thread can be given it.
 */
export type BaseLane = `base-scratch-${string}` & {
  readonly [baseLaneBrand]: true
}

/**
 * The base's scratch lane of the project whose key (the runtime's) is
 * `project`. A container's name is shared by every project on its machine,
 * and a build starts by removing whatever holds its scratch lane's name, so
 * a name that two projects shared let one delete the other's build.
 */
export const baseLane = (project: string): BaseLane =>
  `base-scratch-${project}` as BaseLane

/**
 * What a lane's container, disk and snapshots are named by: a thread, whose
 * id names its lane, or the base's scratch lane.
 */
export type LaneOwner = ThreadId | BaseLane

/** A lane's container's name. */
export const laneContainer = (lane: LaneOwner): string => `pinetrie-${lane}`

/** The thread whose lane a container is, by its name; null for any other container, the base's scratch lane's among them. */
export function containerLane(name: string): ThreadId | null {
  const lane = name.startsWith("pinetrie-")
    ? name.slice("pinetrie-".length)
    : ""
  return isThreadId(lane) ? lane : null
}

/** What a project lets cross a lane's boundary, from `pinetrie.json`. */
export interface LaneGrants {
  /** Lanes may ask for their owner's ssh identity (`lanes.ssh`); each asks the owner first. */
  readonly ssh: boolean
  /** Lanes of their own inside each lane: rootless Docker. */
  readonly nested: boolean
  /** Ports of the Mac's loopback a lane may reach, through the lane VM. */
  readonly hostPorts: readonly number[]
  /** Environment variable names passed from the host. */
  readonly env: readonly string[]
  /** Further read-only mounts. */
  readonly mounts: readonly Mount[]
}

/** A host path mounted into a lane: every mount a lane gets is one of these. */
export interface Mount {
  readonly source: string
  readonly target: string
  readonly readonly: boolean
}

export const NO_GRANTS: LaneGrants = {
  ssh: false,
  nested: false,
  hostPorts: [],
  env: [],
  mounts: [],
}

/**
 * What the host attaches to a lane beside its grants, from a service of its
 * own (the ssh relay): its socket, mounts, variables, and commands started
 * with the container. This package knows none of them by name.
 */
export interface LaneAttached {
  /** Where the runtime's host socket is mounted in the lane; null for none. */
  readonly hostSocket: string | null
  readonly mounts: readonly Mount[]
  readonly env: Readonly<Record<string, string>>
  /** Shell commands started in the background, in order, at each start of the container. */
  readonly starts: readonly string[]
}

export const NOTHING_ATTACHED: LaneAttached = {
  hostSocket: null,
  mounts: [],
  env: {},
  starts: [],
}

/** A lane's spec: a thread's, unless `L` says the base's scratch lane. */
export interface LaneSpec<L extends LaneOwner = ThreadId> {
  readonly lane: L
  readonly image: string
  /** The image's own `PATH`; the runtime's `bin` is added after it. */
  readonly imagePath: string
  /** Every host path the lane sees, from `planMounts`. */
  readonly mounts: readonly Mount[]
  /** The grants that are not mounts: lanes inside, the Mac's ports, named variables. */
  readonly grants: Pick<LaneGrants, "nested" | "hostPorts" | "env">
  readonly attached: LaneAttached
  readonly identity: { readonly name: string; readonly email: string }
  readonly memory: string
  /** Whether it sees its states directory at `STATES_MOUNT`: a folder lane's. */
  readonly states: boolean
}
