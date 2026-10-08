// docker/plan — Docker as a lane runtime: every decision, pure (ADR-0103).
//
// Each lane's disk is a btrfs subvolume on Docker's machine, under the
// project's own directory there, so a project's disks are deleted with it:
//   <lanesDir>/projects/<projectKey>/root            the project's root path
//   <lanesDir>/projects/<projectKey>/lanes/<lane>    each lane's subvolume
//   <lanesDir>/projects/<projectKey>/snapshots/<id>  snapshots, the base too
//   <lanesDir>/projects/<projectKey>/nested/<lane>   a nested lane's inner lanes

import { createHash } from "node:crypto"
import { type LaneName, type SnapshotId, WORKSPACE_ROOT } from "@pinetrie/core"
import type {
  ContainerFacts,
  ContainerShape,
  DiskOp,
  Mount,
} from "@pinetrie/lanes"
import type { DockerTarget } from "./target.ts"

/** Every container made for a project carries its key. */
export const PROJECT_LABEL = "pinetrie.project"
/** On the Mac, every container carries its host's slot. */
export const SLOT_LABEL = "pinetrie.slot"
/** The helper container every disk operation runs in. */
export const DISKS_CONTAINER = "pinetrie-disks"
/** Where a nested lane's inner lanes are, inside it. */
export const NESTED_MOUNT = "/var/lib/pinetrie-lanes"
/** The user rootless Docker runs as in a nested lane, who owns its inner lanes' disks. */
export const ROOTLESS_UID = 1000
/** The inner Docker's socket, which a nested lane's own host uses. */
export const INNER_DOCKER_HOST = `unix:///run/user/${ROOTLESS_UID}/docker.sock`
/** Where a lane granted ssh finds the agent. */
export const SSH_AGENT_IN_LANE = "/run/pinetrie/ssh-agent.sock"
/**
 * A nested lane's command: its inner Docker, then the lane's own wait. The
 * inner Docker starts in a subshell that exits at once, so `--init` adopts
 * it and reaps it when it ends: `sleep` would leave it a zombie.
 */
export const NESTED_COMMAND = "(pinetrie-inner-docker &); exec sleep infinity"

/** Each project's lanes are on a network of their own, so a grant is its project's. */
export const projectNetwork = (key: string): string => `pinetrie-${key}`

/** The variables a lane is told the host's granted ports by. */
export const HOST_ENV = "PINETRIE_HOST"
export const HOST_PORTS_ENV = "PINETRIE_HOST_PORTS"

/** A project's key on Docker's machine: a hash of its root. */
export const projectKey = (root: string): string =>
  createHash("sha256").update(root).digest("hex").slice(0, 16)

/** Where one project's disks are on Docker's machine. */
export function projectDisks(lanesDir: string, key: string) {
  const dir = `${lanesDir}/projects/${key}`
  return {
    dir,
    root: `${dir}/root`,
    lane: (lane: LaneName) => `${dir}/lanes/${lane}`,
    nested: (lane: LaneName) => `${dir}/nested/${lane}`,
    snapshot: (id: SnapshotId) => `${dir}/snapshots/${id}`,
  }
}
export type ProjectDisks = ReturnType<typeof projectDisks>

/**
 * A bind mount's `docker run` arguments. `--mount` separates its fields with
 * commas and `-v` with colons, so a path with a comma takes `-v`;
 * `planHostMounts` refuses one with both.
 */
export function mountArgs(source: string, m: Mount): readonly string[] {
  const paths = `${source}${m.target}`
  if (!paths.includes(","))
    return [
      "--mount",
      `type=bind,source=${source},target=${m.target}${m.readonly ? ",readonly" : ""}`,
    ]
  return ["-v", `${source}:${m.target}${m.readonly ? ":ro" : ""}`]
}

/**
 * A lane's shape as `docker run`'s arguments, without its spec label. Never
 * `--privileged`, `--cap-add` or a Docker socket (ADR-0103): a lane with the
 * VM's socket reads every lane's disk (S125). A nested lane gets the narrow
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
    /** The nested seccomp profile's path on the host, which the docker CLI reads. */
    readonly seccomp: string
  },
): readonly string[] {
  const { target, disks } = input
  const ssh =
    shape.ssh && target.sshAgent !== null
      ? [
          ...mountArgs(target.sshAgent, {
            source: target.sshAgent,
            target: SSH_AGENT_IN_LANE,
            readonly: false,
          }),
          "-e",
          `SSH_AUTH_SOCK=${SSH_AGENT_IN_LANE}`,
        ]
      : []
  const nested = shape.nested
    ? [
        "--security-opt",
        `seccomp=${input.seccomp}`,
        "--security-opt",
        "systempaths=unconfined",
        "--device",
        "/dev/net/tun",
        ...mountArgs(disks.nested(shape.lane), {
          source: disks.nested(shape.lane),
          target: NESTED_MOUNT,
          readonly: false,
        }),
        "-e",
        `DOCKER_HOST=${INNER_DOCKER_HOST}`,
      ]
    : ["--security-opt", "no-new-privileges"]
  const labels = { [PROJECT_LABEL]: input.project, ...target.labels }
  const hostPorts =
    target.hostAddress !== null && shape.hostPorts.length > 0
      ? [
          "-e",
          `${HOST_ENV}=${target.hostAddress}`,
          "-e",
          `${HOST_PORTS_ENV}=${shape.hostPorts.join(",")}`,
        ]
      : []
  return [
    "run",
    "-d",
    "--init",
    "--name",
    shape.name,
    // A lane's hostname is its container's name; Docker's own would be the
    // container's id.
    "--hostname",
    shape.name,
    "-m",
    shape.memory,
    "--network",
    projectNetwork(input.project),
    ...Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
    ...mountArgs(disks.lane(shape.lane), {
      source: disks.lane(shape.lane),
      target: WORKSPACE_ROOT,
      readonly: false,
    }),
    ...shape.mounts.flatMap(m => mountArgs(target.pathOf(m.source), m)),
    ...ssh,
    ...hostPorts,
    ...nested,
    ...Object.entries(shape.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-w",
    WORKSPACE_ROOT,
    shape.image,
    ...(shape.nested ? ["sh", "-c", NESTED_COMMAND] : ["sleep", "infinity"]),
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

/** A shell script and its arguments, run in the helper. */
const sh = (script: string, ...args: string[]): readonly string[] => [
  "sh",
  "-c",
  `set -e\n${script}`,
  "sh",
  ...args,
]

/** Delete the subvolume at "$1" if it is there. */
const DELETE_ONE =
  'if [ -e "$1" ]; then btrfs -q subvolume delete "$1" 2>/dev/null || rm -rf "$1"; fi'

/**
 * A disk operation as one command in the helper, which has the lanes
 * directory and no added capability: the volume is mounted with
 * `user_subvol_rm_allowed` (S125, S127).
 * - Snapshots are writable. Without `CAP_SYS_ADMIN`, btrfs deletes a
 *   subvolume only for a process that may write its root
 *   (`btrfs_ioctl_snap_destroy`), which a read-only one refuses; no spike
 *   has measured it yet. Nothing mounts a snapshot but to restore it.
 * - A snapshot is taken to `<id>.tmp`, then renamed over the old one, so a
 *   snapshot read is never half-made: the base's is replaced each refresh.
 * - A lane's delete takes its inner lanes' subvolume too. An inner Docker
 *   makes subvolumes inside it, which `rm -rf` deletes: `rmdir` of an empty
 *   subvolume is a delete with `user_subvol_rm_allowed`.
 */
export function planDiskCommand(
  op: DiskOp,
  disks: ProjectDisks,
): readonly string[] {
  switch (op.kind) {
    case "create":
      return sh(
        'mkdir -p "$(dirname "$1")"\nbtrfs -q subvolume create "$1"',
        disks.lane(op.lane),
      )
    case "restore":
      return sh(
        'mkdir -p "$(dirname "$2")"\nbtrfs -q subvolume snapshot "$1" "$2"',
        disks.snapshot(op.from),
        disks.lane(op.lane),
      )
    case "snapshot":
      return sh(
        [
          'mkdir -p "$(dirname "$2")"',
          'gone() { if [ -e "$1" ]; then btrfs -q subvolume delete "$1"; fi; }',
          'gone "$2.tmp"',
          'btrfs -q subvolume snapshot "$1" "$2.tmp"',
          'gone "$2"',
          'mv "$2.tmp" "$2"',
        ].join("\n"),
        disks.lane(op.lane),
        disks.snapshot(op.snapshot),
      )
    case "delete":
      return sh(
        `${DELETE_ONE}\nrm -rf "$2"`,
        disks.lane(op.lane),
        disks.nested(op.lane),
      )
    case "deleteSnapshots":
      return sh(
        `for s in "$@"; do set -- "$s"; ${DELETE_ONE}; done`,
        ...op.ids.map(disks.snapshot),
      )
  }
}

/** Whether the subvolume at a path is there: a subvolume's root is inode 256 (S125). */
export const subvolumeCheck = (at: string): readonly string[] => [
  "stat",
  "-c",
  "%i",
  at,
]
export const isSubvolume = (statOut: string): boolean =>
  statOut.trim() === "256"

/** A nested lane's inner lanes' subvolume, made if missing, owned by the rootless user. */
export const planNestedDisk = (
  disks: ProjectDisks,
  lane: LaneName,
): readonly string[] =>
  sh(
    `mkdir -p "$(dirname "$1")"\n[ -e "$1" ] || btrfs -q subvolume create "$1"\nchown ${ROOTLESS_UID}:${ROOTLESS_UID} "$1"`,
    disks.nested(lane),
  )

/** The project's root, written once, for the sweep. */
export const planProjectRecord = (
  disks: ProjectDisks,
  root: string,
): readonly string[] =>
  sh('mkdir -p "$(dirname "$1")"\nprintf %s "$2" > "$1"', disks.root, root)

/**
 * The helper container's arguments, without its spec label: the lanes
 * directory at its own path, no added capability, no network.
 */
export function planDisksHelper(
  lanesDir: string,
  image: string,
): readonly string[] {
  return [
    "run",
    "-d",
    "--init",
    "--name",
    DISKS_CONTAINER,
    "--network",
    "none",
    "--security-opt",
    "no-new-privileges",
    "-m",
    "256m",
    ...mountArgs(lanesDir, {
      source: lanesDir,
      target: lanesDir,
      readonly: false,
    }),
    image,
    "sleep",
    "infinity",
  ]
}

/** A container's state and spec label from `docker inspect`'s output; missing when unreadable. */
export function parseInspect(stdout: string, label: string): ContainerFacts {
  const missing: ContainerFacts = { state: "missing", label: null }
  try {
    const [found] = JSON.parse(stdout) as {
      State?: { Running?: boolean }
      Config?: { Labels?: Record<string, unknown> | null }
    }[]
    if (found === undefined) return missing
    const value = found.Config?.Labels?.[label]
    return {
      state: found.State?.Running === true ? "running" : "stopped",
      label: typeof value === "string" ? value : null,
    }
  } catch {
    return missing
  }
}

/** The `PATH` of an image that names none. */
const STANDARD_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

/** The image's `PATH` from `docker image inspect -f '{{json .Config.Env}}'`. */
export function parseImagePath(stdout: string): string {
  try {
    const env = JSON.parse(stdout) as string[] | null
    const found = (env ?? []).find(e => e.startsWith("PATH="))
    return found === undefined ? STANDARD_PATH : found.slice("PATH=".length)
  } catch {
    return STANDARD_PATH
  }
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

/** The firewall chain of one project's grant in the lane VM. */
export const grantChain = (key: string): string => `PT-${key.slice(0, 16)}`

/**
 * One project's `lanes.hostPorts` as a script for the lane VM's firewall,
 * run by the host in a container on the VM's own network with
 * `CAP_NET_ADMIN`. Its earlier rules are removed first, so a host's start
 * replaces them. Each granted port is accepted only from the project's
 * network (`subnet`), to the host's address, over TCP, above the init's
 * fence, which rejects the rest (`packages/vm/image/init`). With no ports,
 * only the removal.
 */
export function planHostPortRules(input: {
  readonly key: string
  readonly subnet: string
  readonly hostAddress: string
  readonly ports: readonly number[]
}): readonly string[] {
  const chain = grantChain(input.key)
  const clear = [
    `iptables -S DOCKER-USER | grep -- '-j ${chain}$' | sed 's/^-A /-D /' | while read -r rule; do eval iptables "$rule"; done`,
    `iptables -F ${chain} 2>/dev/null || iptables -N ${chain}`,
  ]
  const grant =
    input.ports.length === 0
      ? [`iptables -X ${chain}`]
      : [
          ...input.ports.map(
            p =>
              `iptables -A ${chain} -d ${input.hostAddress} -p tcp --dport ${p} -j ACCEPT`,
          ),
          `iptables -I DOCKER-USER -s ${input.subnet} -j ${chain}`,
        ]
  return ["sh", "-c", ["set -e", ...clear, ...grant].join("\n")]
}

/** A container as `docker ps` lists it: its name and labels. */
export interface Listed {
  readonly name: string
  readonly labels: Readonly<Record<string, string>>
}

/**
 * Before a slot is filled: every container labelled with it. They belong to
 * a host that died holding the slot, and filling it would cut their mounts
 * or show them the new host's directories (S130).
 */
export const planSlotSweep = (
  slot: number,
  containers: readonly Listed[],
): readonly string[] =>
  containers.filter(c => c.labels[SLOT_LABEL] === String(slot)).map(c => c.name)

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

/** `docker ps --format '{{json .}}'`'s lines as names and labels. */
export function parsePs(stdout: string): readonly Listed[] {
  const out: Listed[] = []
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    try {
      const row = JSON.parse(line) as { Names?: string; Labels?: string }
      const labels: Record<string, string> = {}
      for (const pair of (row.Labels ?? "").split(",")) {
        const i = pair.indexOf("=")
        if (i > 0) labels[pair.slice(0, i)] = pair.slice(i + 1)
      }
      if (row.Names !== undefined) out.push({ name: row.Names, labels })
    } catch {}
  }
  return out
}
