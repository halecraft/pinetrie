// docker/plan — Docker as a lane runtime: every decision.
//
// Each lane's disk is a btrfs subvolume on Docker's machine, under the
// project's own directory there (`projectDisks`, lanehost's layout), so a
// project's disks are deleted with it. Lanehost's roles, each a container,
// do everything to the disks.

import { createHash } from "node:crypto"
import { WORKSPACE_ROOT } from "@pinetrie/core"
import {
  FOLDER_MOUNT,
  MACHINE_SOCKET,
  OBSERVER_LOADER,
  OBSERVER_SERVER,
  type ProjectDisks,
  ROLES,
  ROOTLESS_UID,
  type Role,
} from "@pinetrie/lanehost"
import {
  type ContainerShape,
  type Mount,
  PINETRIE_MOUNT,
  RUNTIME_MOUNT,
  runtimeNode,
  SPEC_LABEL,
  STATES_MOUNT,
} from "@pinetrie/lanes"
import type { DockerTarget } from "./target.ts"

/** Every container made for a project carries its key. */
export const PROJECT_LABEL = "pinetrie.project"
/** On the Mac, every container carries its host's slot. */
export const SLOT_LABEL = "pinetrie.slot"
/** A lanehost container carries the role it serves. */
export const LANEHOST_LABEL = "pinetrie.lanehost"
/** Where a nested lane's inner lanes are, inside it. */
export const NESTED_MOUNT = "/var/lib/pinetrie-lanes"
/** The inner Docker's socket, which a nested lane's own host uses. */
export const INNER_DOCKER_HOST = `unix:///run/user/${ROOTLESS_UID}/docker.sock`
/**
 * A nested lane's command: its inner Docker, then the lane's own wait. The
 * inner Docker starts in a subshell that exits at once, so `--init` adopts
 * it and reaps it when it ends: `sleep` would leave it a zombie.
 */
export const NESTED_COMMAND = "(pinetrie-inner-docker &); exec sleep infinity"

/**
 * A lane's command: each start in the background, in a subshell that exits
 * at once so `--init` adopts and reaps it, then a nested lane's inner Docker,
 * then the wait. Null for a lane with neither: the image runs `sleep`.
 */
export function laneCommand(lane: {
  readonly nested: boolean
  readonly starts: readonly string[]
}): readonly string[] {
  if (!lane.nested && lane.starts.length === 0) return ["sleep", "infinity"]
  const starts = lane.starts.map(s => `(${s} &); `).join("")
  return [
    "sh",
    "-c",
    `${starts}${lane.nested ? NESTED_COMMAND : "exec sleep infinity"}`,
  ]
}

/** Each project's lanes are on a network of their own, so a grant is its project's. */
export const projectNetwork = (key: string): string => `pinetrie-${key}`

/** The variables a lane is told the host's granted ports by. */
export const HOST_ENV = "PINETRIE_HOST"
export const HOST_PORTS_ENV = "PINETRIE_HOST_PORTS"

/** A project's key on Docker's machine: a hash of its root. */
export const projectKey = (root: string): string =>
  createHash("sha256").update(root).digest("hex").slice(0, 16)

/** A bind mount, as Docker's machine sees its source. */
export interface BindMount {
  readonly source: string
  readonly target: string
  readonly readonly: boolean
}

/**
 * A container as a value: everything it is made with. Docker's API takes it
 * (`createBody`), and its hash is its spec label (`SPEC_LABEL`), so a
 * container made from another spec is recreated. Every container runs
 * `--init`.
 */
export interface ContainerSpec {
  readonly name: string
  readonly hostname: string | null
  readonly image: string
  readonly cmd: readonly string[]
  readonly workingDir: string | null
  /** `KEY=value`. */
  readonly env: readonly string[]
  readonly labels: Readonly<Record<string, string>>
  readonly mounts: readonly BindMount[]
  readonly network: string
  /** As the CLI's `-m` reads it: `4G`, `256m`. */
  readonly memory: string
  readonly capDrop: readonly string[]
  readonly capAdd: readonly string[]
  /** `seccomp=<path>` names a profile on the host, read when the container is made. */
  readonly securityOpt: readonly string[]
  readonly devices: readonly string[]
  /**
   * The machine's own pid namespace, a read-only root with a
   * tmpfs at each of `tmpfs`, and removal when it stops: the machine role's
   * alone (`renderObserver`). Null for every other container.
   */
  readonly machine: { readonly tmpfs: readonly string[] } | null
}

/** A host mount as Docker's machine sees it. */
const bind = (m: Mount, pathOf: (p: string) => string): BindMount => ({
  source: pathOf(m.source),
  target: m.target,
  readonly: m.readonly,
})

/**
 * A lane's shape as a container, without its spec label. Never privileged,
 * never a capability, never a Docker socket: a lane with the VM's socket
 * reads every lane's disk. A nested lane gets the narrow
 * seccomp profile, unconfined system paths, `/dev/net/tun` and its inner
 * lanes' subvolume, and keeps setuid, which rootless Docker's `newuidmap`
 * needs; every other lane runs with `no-new-privileges`.
 */
export function renderRun(
  shape: ContainerShape,
  input: {
    readonly target: DockerTarget
    readonly disks: ProjectDisks
    readonly project: string
    /** The nested seccomp profile's path on the host. */
    readonly seccomp: string
  },
): ContainerSpec {
  const { target, disks } = input
  const hostSocket =
    shape.hostSocket !== null && target.hostSocket !== null
      ? { source: target.hostSocket, target: shape.hostSocket }
      : null
  const nested = shape.nested
  const hostPorts = target.hostAddress !== null && shape.hostPorts.length > 0
  return {
    name: shape.name,
    // A lane's hostname is its container's name; Docker's own would be the
    // container's id.
    hostname: shape.name,
    image: shape.image,
    cmd: [...laneCommand(shape)],
    workingDir: WORKSPACE_ROOT,
    env: [
      ...(hostPorts
        ? [
            `${HOST_ENV}=${target.hostAddress}`,
            `${HOST_PORTS_ENV}=${shape.hostPorts.join(",")}`,
          ]
        : []),
      ...(nested ? [`DOCKER_HOST=${INNER_DOCKER_HOST}`] : []),
      ...Object.entries(shape.env).map(([k, v]) => `${k}=${v}`),
    ],
    labels: projectLabels(input.project, target),
    mounts: [
      {
        source: disks.lane(shape.lane),
        target: WORKSPACE_ROOT,
        readonly: false,
      },
      ...shape.mounts.map(m => bind(m, target.pathOf)),
      ...(hostSocket === null ? [] : [{ ...hostSocket, readonly: false }]),
      ...(nested
        ? [
            {
              source: disks.nested(shape.lane),
              target: NESTED_MOUNT,
              readonly: false,
            },
          ]
        : []),
      ...(shape.states
        ? [
            {
              source: disks.states(shape.lane),
              target: STATES_MOUNT,
              readonly: true,
            },
          ]
        : []),
    ],
    network: projectNetwork(input.project),
    memory: shape.memory,
    capDrop: [],
    capAdd: [],
    securityOpt: nested
      ? [`seccomp=${input.seccomp}`, "systempaths=unconfined"]
      : ["no-new-privileges"],
    devices: nested ? ["/dev/net/tun"] : [],
    machine: null,
  }
}

/** Every container made for a project carries its key, and the target's labels. */
export const projectLabels = (
  project: string,
  target: Pick<DockerTarget, "labels">,
  more: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> => ({
  [PROJECT_LABEL]: project,
  ...target.labels,
  ...more,
})

/** A lanehost role's container: its project's, and on the Mac its slot's. */
export const lanehostContainer = (
  role: Role,
  project: string,
  target: Pick<DockerTarget, "labels">,
): string => {
  const slot = target.labels[SLOT_LABEL]
  return `pinetrie-lanehost-${role}-${project}${slot === undefined ? "" : `-${slot}`}`
}

/** What a lanehost role's container is made from. */
export interface HelperShape {
  readonly role: Role
  readonly project: string
  readonly image: string
  readonly lanesDir: string
  /** The project's root on the host: the disks role reads your folder from it. */
  readonly root: string
  /** pine·trie's install and the lane runtime, on the host: the server runs from them. */
  readonly install: string
  readonly runtime: string
}

/**
 * A lanehost role's container, without its spec label: its grant (`ROLES`),
 * the lanes directory at its own path, and the install and the runtime
 * read-only where a lane has them; the disks role, the project's root
 * read-only at `FOLDER_MOUNT`, which a read of your folder copies from. It only waits: the host starts the
 * server in it with `exec -i`.
 */
export function renderHelper(
  shape: HelperShape,
  target: Pick<DockerTarget, "labels" | "pathOf">,
): ContainerSpec {
  const spec = ROLES[shape.role]
  return {
    name: lanehostContainer(shape.role, shape.project, target),
    hostname: null,
    image: shape.image,
    cmd: ["sleep", "infinity"],
    workingDir: null,
    env: [],
    labels: projectLabels(shape.project, target, {
      [LANEHOST_LABEL]: shape.role,
    }),
    mounts: [
      {
        source: shape.lanesDir,
        target: shape.lanesDir,
        readonly: spec.lanesDir === "ro",
      },
      bind(
        { source: shape.install, target: PINETRIE_MOUNT, readonly: true },
        target.pathOf,
      ),
      bind(
        { source: shape.runtime, target: RUNTIME_MOUNT, readonly: true },
        target.pathOf,
      ),
      ...(shape.role === "disks"
        ? [
            bind(
              { source: shape.root, target: FOLDER_MOUNT, readonly: true },
              target.pathOf,
            ),
          ]
        : []),
    ],
    network: spec.network,
    memory: spec.memory,
    capDrop: spec.caps.keep === "default" ? [] : ["ALL"],
    capAdd: spec.caps.keep === "default" ? [] : spec.caps.add,
    securityOpt: ["no-new-privileges"],
    devices: [],
    machine: null,
  }
}

/** The machine role's container and image, by its version. */
export const observerContainer = (version: string): string =>
  `pinetrie-observer-${version}`
export const observerImage = (version: string): string =>
  `pinetrie-observer:${version}`

/**
 * What the machine role's container is granted, and nothing more: loading
 * and reading BPF programs (`BPF`, `PERFMON`) and an lstat through a lane's
 * first process's root (`SYS_PTRACE`), under Docker's own seccomp
 * profile; the machine's pids, which the loader reads; no
 * network, no lanes directory, a read-only root.
 */
export const OBSERVER_GRANT = {
  capAdd: ["BPF", "PERFMON", "SYS_PTRACE"],
  network: "none",
  // The kernel's ring of 64 MiB is charged to it.
  memory: "512m",
  tmpfs: ["/run"],
} as const

/**
 * The machine role's container: the observer for every project and host on
 * the machine, so it carries no project's or slot's label, and no sweep
 * takes it. It removes itself when its server exits, once idle. Its spec is
 * the version's alone, so every host of a version renders the same one and
 * joins the container another made.
 */
export function renderObserver(version: string): ContainerSpec {
  return {
    name: observerContainer(version),
    hostname: null,
    image: observerImage(version),
    // Its server, on the runtime copied into its image.
    cmd: [
      ...runtimeNode(`${PINETRIE_MOUNT}/${OBSERVER_SERVER}`),
      MACHINE_SOCKET,
      OBSERVER_LOADER,
      version,
    ],
    workingDir: null,
    env: [],
    labels: {},
    mounts: [],
    network: OBSERVER_GRANT.network,
    memory: OBSERVER_GRANT.memory,
    capDrop: ["ALL"],
    capAdd: OBSERVER_GRANT.capAdd,
    securityOpt: ["no-new-privileges"],
    devices: [],
    machine: { tmpfs: OBSERVER_GRANT.tmpfs },
  }
}

export const labelled = (spec: ContainerSpec, hash: string): ContainerSpec => ({
  ...spec,
  labels: { ...spec.labels, [SPEC_LABEL]: hash },
})

/** The `PATH` of an image that names none. */
const STANDARD_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

/** The image's `PATH`, from its own environment (`Config.Env`). */
export function imagePathOf(env: readonly string[] | null): string {
  const found = (env ?? []).find(e => e.startsWith("PATH="))
  return found === undefined ? STANDARD_PATH : found.slice("PATH=".length)
}

/**
 * Whether `dir` is on btrfs mounted with `user_subvol_rm_allowed`, from
 * `/proc/self/mountinfo`: the mount whose point is the longest prefix of it.
 * Null when no mount holds it.
 */
export function parseMountinfo(
  text: string,
  dir: string,
): { readonly btrfs: boolean; readonly rmAllowed: boolean } | null {
  let best: { point: string; fs: string; options: string } | null = null
  for (const line of text.split("\n")) {
    const [left, right] = line.split(" - ")
    if (left === undefined || right === undefined) continue
    const point = (left.split(" ")[4] ?? "").replace(/\\040/g, " ")
    const [fs = "", , superOptions = ""] = right.split(" ")
    const holds = point === "/" || dir === point || dir.startsWith(`${point}/`)
    if (holds && (best === null || point.length >= best.point.length))
      best = { point, fs, options: superOptions }
  }
  if (best === null) return null
  return {
    btrfs: best.fs === "btrfs",
    rmAllowed: best.options.split(",").includes("user_subvol_rm_allowed"),
  }
}

/** What decides whether the host's Docker can run lanes. */
export interface DockerHostFacts {
  readonly platform: NodeJS.Platform
  /** `docker version`: null when the CLI and its daemon answer, else what it said. */
  readonly docker: string | null
  /** `docker buildx version`: null when it answers, else what it said. */
  readonly buildx: string | null
  /** The lanes directory's filesystem, on Linux; null on the Mac (the VM's own). */
  readonly lanesDir: {
    readonly dir: string
    readonly fs: { readonly btrfs: boolean; readonly rmAllowed: boolean } | null
  } | null
}

export type DockerRefusal =
  | {
      readonly kind: "no-docker"
      readonly platform: NodeJS.Platform
      readonly said: string
    }
  | {
      readonly kind: "no-buildx"
      readonly platform: NodeJS.Platform
      readonly said: string
    }
  | { readonly kind: "not-btrfs"; readonly dir: string }
  | { readonly kind: "no-rm-allowed"; readonly dir: string }

/** Nothing, when Docker can run lanes here; else the first reason not. */
export function planDockerHost(f: DockerHostFacts): DockerRefusal | null {
  if (f.docker !== null)
    return { kind: "no-docker", platform: f.platform, said: f.docker }
  if (f.buildx !== null)
    return { kind: "no-buildx", platform: f.platform, said: f.buildx }
  if (f.lanesDir !== null) {
    const { dir, fs } = f.lanesDir
    if (fs === null || !fs.btrfs) return { kind: "not-btrfs", dir }
    if (!fs.rmAllowed) return { kind: "no-rm-allowed", dir }
  }
  return null
}

/** A command's own words, after a refusal's; nothing when it said nothing. */
const saidWords = (said: string): string =>
  said === "" ? "" : ` (it said: ${said})`

/** Why Docker cannot run lanes here, with how to make it. */
export function dockerWords(r: DockerRefusal): string {
  switch (r.kind) {
    case "no-docker":
      return `${
        r.platform === "darwin"
          ? "the docker CLI does not answer: `brew install docker`"
          : "Docker does not answer (`docker version`): install Docker and start it"
      }${saidWords(r.said)}`
    case "no-buildx":
      return `${
        r.platform === "darwin"
          ? 'docker buildx does not answer: `brew install docker-buildx`, then add `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]` to the docker CLI\'s config.json, in `$DOCKER_CONFIG` if it is set, else in ~/.docker'
          : "docker buildx does not answer: install Docker's buildx plugin"
      }${saidWords(r.said)}`
    case "not-btrfs":
      return `${r.dir} is not on btrfs, which lanes' disks need. Make one: \`truncate -s 256G ~/lanes.img && mkfs.btrfs ~/lanes.img && sudo mkdir -p ${r.dir} && sudo mount -o loop,user_subvol_rm_allowed ~/lanes.img ${r.dir}\``
    case "no-rm-allowed":
      return `${r.dir} is on btrfs mounted without user_subvol_rm_allowed, so a lane's disk cannot be deleted without privilege: \`sudo mount -o remount,user_subvol_rm_allowed ${r.dir}\``
  }
}

/** A container as `docker ps` lists it: its name, labels and bind sources. */
export interface Listed {
  readonly name: string
  readonly labels: Readonly<Record<string, string>>
  readonly binds: readonly string[]
}

/**
 * Before a slot is filled: every container with a bind under `root`, the
 * slot's place in Docker's machine. They belong to a host that died holding
 * the slot, its own or an extra one, and filling it would cut their mounts or
 * show them the new host's directories. Read from the binds, not a label: a
 * container's labels say only the slot its host held first.
 */
export const planSlotSweep = (
  root: string,
  containers: readonly Listed[],
): readonly string[] =>
  containers.filter(c => c.binds.some(b => b.startsWith(root))).map(c => c.name)

/**
 * At startup: the containers and disks of every project whose root is gone,
 * as the suites' throwaway projects are.
 */
export function planProjectSweep(input: {
  readonly projects: readonly {
    readonly key: string
    readonly rootExists: boolean
  }[]
  readonly containers: readonly Listed[]
}): {
  readonly containers: readonly string[]
  readonly projects: readonly string[]
} {
  const gone = new Set(
    input.projects.filter(p => !p.rootExists).map(p => p.key),
  )
  return {
    containers: input.containers
      .filter(c => gone.has(c.labels[PROJECT_LABEL] ?? ""))
      .map(c => c.name),
    projects: [...gone].sort(),
  }
}

/** Whether `docker info`'s `SecurityOptions` name rootless Docker. */
export const isRootless = (options: readonly string[]): boolean =>
  options.includes("name=rootless")
