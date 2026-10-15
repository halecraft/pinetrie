// lanes/plan — every decision about a lane's container and disk, as values.
//
// What runs is a list of `Step`s, carried out by
// `execute.ts`: commands in the lane, and `RuntimeOp`s a runtime turns into
// its own commands (`runtime-port.ts`). What is gathered is gathered by
// `host.ts` and the host. So each rule below is tested without a runtime, jj
// or git.

import { createHash } from "node:crypto"
import path from "node:path"
import {
  type ConfigWidening,
  DISK_OWN_ROOTS,
  HOST_WORKING_COPY,
  hostPathInLane,
  isWithin,
  LANE_HOME,
  NO_EDITOR,
  type PointId,
  PRODUCT_NAME,
  type ProjectKind,
  pointId,
  SHARED_ENV,
  type SnapshotId,
  shellWord,
  type ThreadId,
  WORKSPACE_ROOT,
  wideningWords,
} from "@pinetrie/core"
import type { ForkSetup } from "./history-port.ts"
import type { LaneRuntime, RuntimeOp } from "./runtime-port.ts"
/** pine·trie's own install, read-only: the helper's code and pi's. */
export const PINETRIE_MOUNT = "/pinetrie"
/**
 * pine·trie's lane runtime, read-only: Node and its libraries, and in
 * `bin/` the static programs core's `RUNTIME_PROGRAMS` lists.
 */
export const RUNTIME_MOUNT = "/pinetrie-runtime"
/** The runtime's programs, as a lane sees them: on its `PATH`, last. */
export const RUNTIME_BIN = `${RUNTIME_MOUNT}/bin`
/** The lane's own jj config, on its disk so that forks inherit it. */
export const LANE_CONFIG_DIR = `${WORKSPACE_ROOT}/.pinetrie-lane`
export const LANE_JJ_CONFIG = `${LANE_CONFIG_DIR}/jj.toml`

declare const baseLaneBrand: unique symbol
/**
 * The scratch lane a base is made in (`base.ts`): no thread's, so no
 * `ThreadId`, and nothing that takes a thread can be given it.
 */
export type BaseLane = "base-scratch" & { readonly [baseLaneBrand]: true }
export const BASE_LANE = "base-scratch" as BaseLane

/**
 * What a lane's container, disk and snapshots are named by: a thread, whose
 * id names its lane, or the base's scratch lane.
 */
export type LaneOwner = ThreadId | BaseLane

/** A lane's container's name. */
export const laneContainer = (lane: LaneOwner): string => `pinetrie-${lane}`

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

/**
 * Where a folder lane sees its states directory, read-only: `start`, the
 * state its offer is computed against, and each open conflict's versions.
 */
export const STATES_MOUNT = "/pinetrie-states"

/**
 * Every mount a lane gets, in one list:
 * - your working copy, read-only at `/mnt/host-working-copy`;
 * - pinetrie's own install at `/pinetrie` and its runtime at `/pinetrie-runtime`,
 *   and the directory of the lane's ignore file at `/pinetrie-git`, read-only;
 * - links' and grants' mounts, read-only where they say;
 * - shared directories, read-write at their place in `/workspace`;
 * - granted host paths, read-only at `/mnt/host` and their path.
 */
export function planMounts(parts: {
  readonly hostWorkingCopy: string
  readonly pinetrie: string
  readonly runtime: string
  readonly ignoreDir: string
  readonly links: readonly Mount[]
  readonly grants: readonly Mount[]
  readonly shared: readonly SharedDir[]
  readonly hostPaths: readonly string[]
}): readonly Mount[] {
  const at = (source: string, target: string): Mount => ({
    source,
    target,
    readonly: true,
  })
  return [
    at(parts.hostWorkingCopy, HOST_WORKING_COPY),
    at(parts.pinetrie, PINETRIE_MOUNT),
    at(parts.runtime, RUNTIME_MOUNT),
    at(parts.ignoreDir, IGNORE_MOUNT),
    ...parts.links,
    ...parts.grants,
    ...sharedMounts(parts.shared),
    ...parts.hostPaths.map(p => at(p, hostPathInLane(p))),
  ]
}

/** Shared directories, read-write at their place in `/workspace`. */
const sharedMounts = (shared: readonly SharedDir[]): readonly Mount[] =>
  shared.map(d => ({
    source: d.source,
    target: path.posix.join(WORKSPACE_ROOT, d.path),
    readonly: false,
  }))

/**
 * Every host directory a lane of this host may mount, as the Mac's lane VM
 * shares them into its slots: the base lane's mounts, which carry no shared
 * directory, every shared directory any lane may mount, and what a lane's
 * ssh attaches. A lane that mounts one left out cannot be made.
 */
export const slotMounts = (input: {
  readonly base: readonly Mount[]
  readonly shared: readonly SharedDir[]
  readonly attached: readonly Mount[]
}): readonly Mount[] => [
  ...input.base,
  ...sharedMounts(input.shared),
  ...input.attached,
]

/**
 * Which host paths a lane is granted, read-only: the roots a
 * command's files live in. Nested roots collapse into the outermost. A root
 * that is, or holds, your home directory, `/` or one of pine·trie's own
 * directories (`own`: credentials, service keys, sessions) is refused. A
 * root inside one of those, such as a skill folder in pine·trie's config,
 * is not: it lies inside, and does not hold it.
 */
export function planHostMounts(input: {
  readonly roots: readonly string[]
  readonly home: string
  readonly own: readonly string[]
}): {
  readonly mounts: readonly string[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
} {
  const refused: { path: string; reason: string }[] = []
  const allowed: string[] = []
  for (const root of new Set(input.roots.map(r => path.resolve(r)))) {
    const reason =
      root === "/"
        ? "it is the file system's root"
        : isWithin(input.home, root)
          ? "it is, or holds, your home directory"
          : input.own.some(d => isWithin(d, root))
            ? "it is, or holds, one of pine·trie's own directories"
            : null
    if (reason === null) allowed.push(root)
    else refused.push({ path: root, reason })
  }
  const mounts = allowed
    .filter(r => !allowed.some(o => o !== r && isWithin(r, o)))
    .sort()
  return { mounts, refused }
}

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
export const specHashOf = (
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

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A grant's mount as written: its source relative to the project's root. */
export interface WrittenMount {
  readonly source: string
  readonly target: string
}

/** A grant's mount: a non-empty source, and an absolute target. Null for anything else. */
export const parseMount = (v: unknown): WrittenMount | null =>
  isRecord(v) &&
  typeof v.source === "string" &&
  typeof v.target === "string" &&
  v.source !== "" &&
  path.posix.isAbsolute(v.target)
    ? { source: v.source, target: v.target }
    : null

/** A port of the Mac's loopback: a whole number from 1 to 65535. Null for anything else. */
export const parsePort = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535
    ? v
    : null

/** Whether `name` can name an environment variable. */
export const isEnvName = (name: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)

/**
 * What a `pinetrie.json` decides of a lane: its grants and its shared
 * directories. A fact of a state: accepted work's copy, less what the
 * lane's own gave up (`effectiveLaneConfig`).
 */
export interface LaneAuthority {
  readonly grants: LaneGrants
  /** Relative paths, as written; `planShared` decides which apply. */
  readonly shared: readonly string[]
}

const sameMount = (a: Mount, b: Mount): boolean =>
  a.source === b.source && a.target === b.target && a.readonly === b.readonly

/**
 * What a lane may do and share: accepted work's config, less what the lane
 * gave up, key by key. A lane gives up what its own copy dropped from the
 * copy it started on (`base`): a grant switched off, or an item taken off a
 * list. So a lane can always ask for less, and only accepted work widens: a
 * grant accepted after the lane started reaches it, and one its own copy
 * adds never does. A lane with no copy of its own read gets accepted work's.
 */
export function effectiveLaneConfig(
  accepted: LaneAuthority,
  lane: { readonly base: LaneAuthority; readonly own: LaneAuthority } | null,
): LaneAuthority {
  if (lane === null) return accepted
  const a = accepted.grants
  const b = lane.base.grants
  const o = lane.own.grants
  /** Kept unless the lane's base had it and its own copy does not. */
  const keeps =
    <T>(base: readonly T[], own: readonly T[], same: (x: T, y: T) => boolean) =>
    (x: T) =>
      !base.some(y => same(x, y)) || own.some(y => same(x, y))
  const eq = <T>(x: T, y: T) => x === y
  return {
    grants: {
      ssh: a.ssh && (!b.ssh || o.ssh),
      nested: a.nested && (!b.nested || o.nested),
      hostPorts: a.hostPorts.filter(keeps(b.hostPorts, o.hostPorts, eq)),
      env: a.env.filter(keeps(b.env, o.env, eq)),
      mounts: a.mounts.filter(keeps(b.mounts, o.mounts, sameMount)),
    },
    shared: accepted.shared.filter(
      keeps(lane.base.shared, lane.own.shared, eq),
    ),
  }
}

/** What `after` lets a lane do or share that `before` does not, in order. */
export function configWidenings(
  before: LaneAuthority,
  after: LaneAuthority,
): readonly ConfigWidening[] {
  const b = before.grants
  const a = after.grants
  return [
    ...(a.ssh && !b.ssh ? [{ kind: "ssh" as const }] : []),
    ...(a.nested && !b.nested ? [{ kind: "nested" as const }] : []),
    ...a.env
      .filter(n => !b.env.includes(n))
      .map(name => ({ kind: "env" as const, name })),
    ...a.mounts
      .filter(m => !b.mounts.some(o => sameMount(m, o)))
      .map(m => ({ kind: "mount" as const, target: m.target })),
    ...a.hostPorts
      .filter(p => !b.hostPorts.includes(p))
      .map(port => ({ kind: "hostPort" as const, port })),
    ...after.shared
      .filter(p => !before.shared.includes(p))
      .map(path => ({ kind: "shared" as const, path })),
  ]
}

/**
 * What a lane's agent is told when it writes `pinetrie.json`: what it gave
 * up, which applies from the lane's next run, its container made anew; and
 * what it asked for beyond accepted work's, which waits until the change is
 * accepted. Null when it changes neither.
 */
export function configChangeNote(
  accepted: LaneAuthority,
  written: LaneAuthority,
): string | null {
  const dropped = configWidenings(written, accepted).map(wideningWords)
  const waiting = configWidenings(accepted, written).map(wideningWords)
  const lines = [
    ...(dropped.length === 0
      ? []
      : [
          `${PRODUCT_NAME}: this lane gives up ${dropped.join(", ")} from its next run.`,
        ]),
    ...(waiting.length === 0
      ? []
      : [
          `${PRODUCT_NAME}: this lane gets ${waiting.join(", ")} only once this change to pinetrie.json is accepted.`,
        ]),
  ]
  return lines.length === 0 ? null : lines.join("\n")
}

/** The slots a lane VM boots with when no config names any. */
export const DEFAULT_VM_SLOTS = 16
/** A VM boots with 20 share devices alongside its others, and not 24. */
export const MAX_VM_SLOTS = 20

/** Where a shared directory may never be: repos, pine·trie's own, dependencies. */
const NEVER_SHARED = [".git", ".jj", "node_modules"]

/**
 * Which shared directories apply, and what to do for them on the host, from
 * the settled list (the person's entries first, as the join puts them),
 * normalized and without duplicates. Refused: absolute paths, paths that leave the project, those
 * in `.git`, `.jj` or `node_modules`, and those holding files jj
 * tracks. A missing directory is created; one your repo does not already
 * ignore is added to its exclude file.
 */
export function planShared(facts: {
  readonly entries: readonly string[]
  /** Normalized paths that exist. */
  readonly exists: ReadonlySet<string>
  /** Normalized paths holding files jj tracks. */
  readonly tracked: ReadonlySet<string>
  /** Normalized paths your repo already ignores. */
  readonly ignored: ReadonlySet<string>
}): {
  readonly shared: readonly string[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
  readonly create: readonly string[]
  readonly exclude: readonly string[]
} {
  const { candidates, refused } = sharedCandidates(facts.entries)
  const shared = candidates.filter(p => !facts.tracked.has(p))
  return {
    shared,
    refused: [
      ...refused,
      ...candidates
        .filter(p => facts.tracked.has(p))
        .map(p => ({ path: p, reason: "it holds files jj tracks" })),
    ],
    create: shared.filter(p => !facts.exists.has(p)),
    exclude: shared.filter(p => !facts.ignored.has(p)),
  }
}

/**
 * The entries whose paths may be shared, normalized and each once, in order;
 * and those refused by their path alone. What they hold is for `planShared`
 * to judge, from what the host gathers of these candidates.
 */
export function sharedCandidates(entries: readonly string[]): {
  readonly candidates: readonly string[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
} {
  const candidates: string[] = []
  const refused: { path: string; reason: string }[] = []
  for (const given of entries) {
    const reason = sharedRefusal(given)
    if (reason !== null) refused.push({ path: given, reason })
    else if (!candidates.includes(normalShared(given)))
      candidates.push(normalShared(given))
  }
  return { candidates, refused }
}

/** What the host keeps for a session's lanes, on the host. */
export interface LaneFiles {
  /** The lane runtime, one directory per image tag. */
  readonly runtime: string
  /** The lanes' ignore file's directory (`laneIgnores`), mounted in every lane. */
  readonly laneGit: string
  /** What every lane's ssh is given, read-only (`@pinetrie/ssh`'s files). */
  readonly laneSsh: string
  /** The secret a lane's ssh token is made under. */
  readonly sshSecret: string
  /**
   * A folder project's stamps of its last read, which the next read is
   * planned from (`planRead`): written once that read's state is recorded.
   */
  readonly folderStamps: string
}

/** Every file the host keeps for a session: none of them in its project. */
export interface SessionFiles {
  /** The session's SQLite file, unless `PINETRIE_STORE` names another. */
  readonly store: string
  readonly lanes: LaneFiles
}

/** A session's files, under its data directory (`sessions/<name>/`). */
export function sessionFiles(sessionData: string): SessionFiles {
  return {
    store: path.join(sessionData, "pinetrie.db"),
    lanes: {
      runtime: path.join(sessionData, "runtime"),
      laneGit: path.join(sessionData, "lane-git"),
      laneSsh: path.join(sessionData, "lane-ssh"),
      sshSecret: path.join(sessionData, "ssh-secret"),
      folderStamps: path.join(sessionData, "folder-stamps.json"),
    },
  }
}

/** A shared path as relative, normalized, with no trailing slash. */
export const normalShared = (given: string): string =>
  path.posix.normalize(given).replace(/\/+$/, "")

function sharedRefusal(given: string): string | null {
  if (given.trim() === "") return "it is empty"
  if (path.posix.isAbsolute(given)) return "it is absolute"
  const p = normalShared(given)
  if (p === "." || p === ".." || p.startsWith("../"))
    return "it leaves the project"
  const top = p.split("/")[0] ?? ""
  return NEVER_SHARED.includes(top) ? `it is inside ${top}` : null
}

/** A symlink in your working copy, relative to its root, and its stored target. */
export interface Link {
  readonly path: string
  readonly target: string
}

/**
 * The read-only mounts that let links leaving the project resolve in a lane.
 * For each relative target outside the root, the directory beside the
 * project's that holds it is mounted where it resolves from `/workspace`: the
 * whole directory, since a linked package resolves its own dependencies
 * through the `node_modules` of its repo. pinetrie's `link:` dependencies on
 * Kyneta resolve this way.
 */
export function planLinks(root: string, links: readonly Link[]): Mount[] {
  const found = new Map<string, string>()
  for (const link of links) {
    if (path.isAbsolute(link.target)) continue
    const source = path.resolve(root, path.dirname(link.path), link.target)
    const rel = path.relative(root, source)
    if (!rel.startsWith("..")) continue
    // `../../x/y` from the root: the top is `../../x`, beside an ancestor.
    const parts = rel.split(path.sep)
    const ups = parts.findIndex(p => p !== "..")
    if (ups < 0) continue
    const top = path.resolve(root, ...parts.slice(0, ups + 1))
    found.set(
      top,
      path.posix.resolve(WORKSPACE_ROOT, ...parts.slice(0, ups + 1)),
    )
  }
  return [...found.keys()].sort().map(source => ({
    source,
    target: found.get(source) ?? source,
    readonly: true,
  }))
}

/** One command in a lane, as data, run through the lane's runner. */
export interface LaneStep {
  readonly in: "lane"
  readonly argv: readonly string[]
  /** A host file the command's stdout is written to, as bytes. */
  readonly stdoutTo?: string
}

/** A lane command, or an operation of the runtime's. */
export type Step = LaneStep | { readonly in: "runtime"; readonly op: RuntimeOp }

export const inLane = (...argv: string[]): LaneStep => ({ in: "lane", argv })
const onRuntime = (op: RuntimeOp): Step => ({ in: "runtime", op })
export const laneShell = (script: string): LaneStep =>
  inLane("sh", "-c", script)

/**
 * Ends every `ssh` process in a lane, found by its name in `/proc`, which
 * every image has. A revoke runs it after closing the lane's connections
 * through the host, for a session that went around them.
 */
export const KILL_SSH: LaneStep = laneShell(
  'cd /proc && for p in [0-9]*; do [ "$(cat "$p/comm" 2>/dev/null)" = ssh ] && kill "$p"; done; true',
)

/** Make and start a lane's container on its existing disk. */
export const planStart = (
  spec: LaneSpec<LaneOwner>,
  env: Readonly<Record<string, string | undefined>>,
): Step => onRuntime({ kind: "run", shape: planShape(spec, env) })

/**
 * A lane's disk, then its container: a new disk, or one restored from
 * snapshot `from`.
 */
export const planDisk = (input: {
  readonly spec: LaneSpec<LaneOwner>
  readonly env: Readonly<Record<string, string | undefined>>
  readonly from: SnapshotId | null
}): Step[] => {
  const { lane } = input.spec
  return [
    onRuntime(
      input.from === null
        ? { kind: "create", lane }
        : { kind: "restore", lane, from: input.from },
    ),
    planStart(input.spec, input.env),
  ]
}

/**
 * pre-rename: the lane's jj config folder before b05e2252. Snapshots taken
 * of lanes made before then still hold it, and `laneIgnores` does not list
 * it, so a turn would commit it. Remove with `planOldNamesOnDisk` once no
 * such snapshot remains.
 */
export const OLD_LANE_CONFIG_DIR = `${WORKSPACE_ROOT}/.pineta-lane`
/**
 * A fork: its disk cloned from the adapter's snapshot (`ForkSetup.from`),
 * else its source's, then the adapter's setup steps.
 */
export const planFork = (input: {
  readonly source: { readonly snapshot: SnapshotId }
  readonly spec: LaneSpec
  readonly env: Readonly<Record<string, string | undefined>>
  readonly setup: ForkSetup
}): Step[] => [
  ...planDisk({ ...input, from: input.setup.from ?? input.source.snapshot }),
  // pre-rename: before any command of the adapter's, which could snapshot
  // it into the working copy the clone carries (`OLD_LANE_CONFIG_DIR`).
  laneShell(`rm -rf ${OLD_LANE_CONFIG_DIR}`),
  ...input.setup.steps,
]

/**
 * A turn's snapshot: `sync`, so what the tools wrote is on the disk (without
 * it, unflushed files clone empty), then the snapshot.
 */
export const planSnapshot = (input: {
  readonly lane: LaneOwner
  readonly snapshot: SnapshotId
}): Step[] => [
  inLane("sync"),
  onRuntime({ kind: "snapshot", lane: input.lane, snapshot: input.snapshot }),
]

/**
 * The version of the steps a base is made with: a base made by other steps
 * is not copied, and the next one starts empty.
 */
export const BASE_FORMAT = 3

/** The files of pine·trie's own a disk holds about itself, under `.pinetrie-lane/`. */
export const BASE_FILE = "base.json"

/** What the base disk is: accepted work's states, made by `format`'s steps. */
export interface BaseFacts {
  readonly points: readonly PointId[]
  readonly format: number
}

/** `base.json` read; null when absent or not one. A base from before formats reads as format 0. */
export function parseBaseFacts(text: string | null): BaseFacts | null {
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as { commits?: unknown; format?: unknown }
    if (
      !Array.isArray(raw.commits) ||
      !raw.commits.every(c => typeof c === "string")
    )
      return null
    return {
      points: raw.commits.map(c => pointId(String(c))),
      format: typeof raw.format === "number" ? raw.format : 0,
    }
  } catch {
    return null
  }
}

/** A JSON value written to `.pinetrie-lane/<file>` on the lane's disk. */
const writeLaneFile = (file: string, value: unknown): LaneStep =>
  laneShell(
    `mkdir -p ${LANE_CONFIG_DIR} && printf %s ${shellWord(JSON.stringify(value))} > ${LANE_CONFIG_DIR}/${file}`,
  )

/** The disk's registry of derived files, under `.pinetrie-lane/`. */
export const REGISTRY_FILE = "recipes.json"

/**
 * The base's facts at `points`, written on its disk before it is
 * snapshotted. The file's field stays `commits`: a disk's file is read by
 * its format, and the strings are the same.
 */
export const planBaseFacts = (points: readonly PointId[]): LaneStep =>
  writeLaneFile(BASE_FILE, { commits: points, format: BASE_FORMAT })

/** Whether the base disk holds `accepted`, made the way it is now: then a refresh does nothing. */
export const isBaseCurrent = (
  base: BaseFacts | null,
  accepted: readonly PointId[],
): boolean =>
  isCopyableBase(base) &&
  base.points.length === accepted.length &&
  base.points.every((p, i) => p === accepted[i])

/**
 * Whether a base is one the next is copied from. One made by other steps
 * may hold what nothing records: a base from before was made on a
 * dependency layer, whose outputs no registry names.
 */
export const isCopyableBase = (base: BaseFacts | null): base is BaseFacts =>
  base !== null && base.format === BASE_FORMAT

/** What the file system, jj and git say about a project's folder. */
export interface RootFacts {
  readonly dir: string
  /** Whether `dir` is a directory; jj and git are asked only when it is. */
  readonly isDirectory: boolean
  /** The jj workspace root jj names from `dir`, or null. */
  readonly jjRoot: string | null
  /** git's top level from `dir`, asked only when jj names nothing. */
  readonly gitTop: string | null
  readonly home: string
}

/** Why a folder cannot be a project (`projectDirWords` words it). */
export type ProjectDirRefusal =
  /** Missing, or not a directory. */
  | { readonly kind: "missing"; readonly dir: string }
  /** Your home directory or `/`. */
  | { readonly kind: "unsafe"; readonly root: string }
  /** A jj repo with no git directory beside it, which lanes' history is fetched through. */
  | { readonly kind: "not-colocated"; readonly root: string }

/** A project's root and its kind, or why the folder cannot be one. */
export type ProjectDir =
  | {
      [K in ProjectKind]: { readonly kind: K; readonly root: string }
    }[ProjectKind]
  | { readonly kind: "refused"; readonly refusal: ProjectDirRefusal }

/**
 * The project's root: jj's, else git's, else the folder. Never your home
 * directory or `/`: a home directory that is a dotfiles repo is what git
 * names for any project below it with no repo of its own.
 */
export function planProjectDir(f: RootFacts): ProjectDir {
  if (!f.isDirectory)
    return { kind: "refused", refusal: { kind: "missing", dir: f.dir } }
  const root = f.jjRoot ?? f.gitTop ?? f.dir
  if (
    path.resolve(root) === path.resolve(f.home) ||
    path.resolve(root) === path.parse(root).root
  )
    return { kind: "refused", refusal: { kind: "unsafe", root } }
  return { kind: f.jjRoot !== null ? "jj" : "folder", root }
}

/** A refusal's words, for the log, `ProjectRecord.reason` and the command line. */
export function projectDirWords(r: ProjectDirRefusal): string {
  switch (r.kind) {
    case "missing":
      return `${r.dir} is not a directory`
    case "unsafe":
      return `${r.root} is your home directory or the file system's root`
    case "not-colocated":
      return `${r.root} has no git directory beside its jj repo, and lanes' work reaches your repo through git: \`jj git init --colocate\` makes one`
  }
}

/**
 * Your repo's exclude file with each of `lines` in it, appended in order, or
 * null when they are all there already. Shared directories are added as
 * `/<path>/`.
 */
export function planExclude(
  current: string,
  lines: readonly string[],
): string | null {
  const have = new Set(current.split("\n").map(l => l.trim()))
  const missing = lines.filter(l => !have.has(l))
  if (missing.length === 0) return null
  const base =
    current === "" || current.endsWith("\n") ? current : `${current}\n`
  return `${base}${missing.map(l => `${l}\n`).join("")}`
}

/** What starting a lane's container takes, from its state and label. */
export type ContainerPlan = "create" | "recreate" | "start" | "running"

/**
 * Missing: create it. Its label differs, or it has none: recreate it on the
 * same volume, since it was made from another spec (another image, mounts
 * or grants). Stopped: start it. The container holds nothing its volume
 * does not, so recreating it loses nothing.
 */
export function planContainer(input: {
  readonly facts: {
    readonly state: "running" | "stopped" | "missing"
    readonly label: string | null
  }
  readonly want: string
}): ContainerPlan {
  const { state, label } = input.facts
  if (state === "missing") return "create"
  if (label !== input.want) return "recreate"
  return state === "running" ? "running" : "start"
}

/**
 * Where a lane's container, made anew, starts from: its disk if it has one;
 * else its newest snapshot (a restored root); else nothing, and the lane
 * is retired: a branch from it continues.
 */
export function planStartFrom(input: {
  readonly disk: boolean
  readonly newest: SnapshotId | null
}):
  | { readonly kind: "disk" }
  | { readonly kind: "snapshot"; readonly from: SnapshotId }
  | { readonly kind: "retired" } {
  if (input.disk) return { kind: "disk" }
  return input.newest === null
    ? { kind: "retired" }
    : { kind: "snapshot", from: input.newest }
}

/** The oldest git a lane's image may have: jj's fetch needs 2.41. */
const MIN_GIT: readonly [number, number] = [2, 41]

/**
 * Why an image cannot host a lane, from `git --version`'s output (empty when
 * git is missing), or null when it can.
 */
export function imageRefusal(gitVersion: string): string | null {
  const m = /git version (\d+)\.(\d+)/.exec(gitVersion)
  if (m === null)
    return "the lane's image has no git; a project image needs git 2.41 or later"
  const [major, minor] = [Number(m[1]), Number(m[2])]
  const ok = major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1])
  return ok
    ? null
    : `the lane's image has git ${major}.${minor}; it needs 2.41 or later`
}

/** An image to build: its Containerfile, and the tag its content decides. */
export interface ImagePlan {
  readonly file: string
  readonly tag: string
  readonly buildArgs: readonly string[]
}

/**
 * A Containerfile as read: its path, its text, and the text of each file it
 * copies in from beside it, which decide the image as much as it does.
 */
export interface Containerfile {
  readonly file: string
  readonly content: string
  readonly sources: readonly string[]
}

/**
 * The images a project's lanes need. pine·trie's is built
 * with the host's jj version and the app's Playwright version, so its jj and
 * its browser match what drives them. A project's own image gets the jj
 * version only. Each is tagged by a hash of its Containerfile and build
 * arguments, so a change of either builds it again.
 */
export function planImages(input: {
  readonly pinetrie: Containerfile
  /** The project's `pinetrie.Containerfile`, or null when it has none. */
  readonly project: Containerfile | null
  readonly jjVersion: string
  readonly playwrightVersion: string
}): { readonly pinetrie: ImagePlan; readonly project: ImagePlan | null } {
  const jj = `JJ_VERSION=${input.jjVersion}`
  return {
    pinetrie: imagePlan(input.pinetrie, [
      jj,
      `PLAYWRIGHT_VERSION=${input.playwrightVersion}`,
    ]),
    project: input.project === null ? null : imagePlan(input.project, [jj]),
  }
}

function imagePlan(
  containerfile: Containerfile,
  buildArgs: readonly string[],
): ImagePlan {
  const hash = createHash("sha256")
    .update(containerfile.content)
    .update("\0")
    .update(buildArgs.join("\0"))
    .update("\0")
    .update(containerfile.sources.join("\0"))
    .digest("hex")
    .slice(0, 12)
  return { file: containerfile.file, tag: `pinetrie-lane:${hash}`, buildArgs }
}
