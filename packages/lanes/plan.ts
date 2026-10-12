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
  type BaseMerge,
  baseMessage,
  type CommitId,
  type ConfigWidening,
  commitId,
  type ForkStart,
  HOST_WORKING_COPY,
  hostPathInLane,
  isWithin,
  LANE_HOME,
  NO_EDITOR,
  PRODUCT_NAME,
  SHARED_ENV,
  type SnapshotId,
  shellWord,
  snapshotId,
  type ThreadId,
  type ThreadName,
  WORKSPACE_ROOT,
  wideningWords,
} from "@pinetrie/core"
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
/** The branch a commit fetched by id is put on, so jj sees it. */
export const FETCHED_REF = "refs/heads/pinetrie/fetched"
/** The directory the host keeps in a project's root (`pinetrieDir`). */
export const PROJECT_DIR = ".pinetrie"

/** The bookmark that holds a lane's newest revision, in the lane's own repo. */
export const bookmarkName = (lane: ThreadId): string => `pinetrie/${lane}`

/** A revset string literal, so a bookmark name is never parsed as a revset. */
export const revsetName = (name: string): string => JSON.stringify(name)

/** The revset of one bookmark, its name quoted so it is never parsed as a revset. */
export const bookmarkRevset = (name: string): string =>
  `bookmarks(exact:${revsetName(name)})`

/**
 * A lane's history in your repo: a remote bookmark, `tip@pinetrie-<lane>`,
 * which jj keeps out of your default log and immutable with its builtin
 * config, ancestors included. No git remote is added.
 */
export const LANE_REMOTE_PREFIX = "pinetrie-"
const laneRemote = (lane: ThreadId): string => `${LANE_REMOTE_PREFIX}${lane}`
/** Where git keeps a lane's history in your repo: `laneTipName`'s ref. */
export const laneTipRef = (lane: ThreadId): string =>
  `refs/remotes/${laneRemote(lane)}/tip`
export const laneTipName = (lane: ThreadId): string => `tip@${laneRemote(lane)}`

/**
 * A split's stack: the bookmark its run leaves in the lane's own
 * repo, and the remote bookmark it arrives as in yours.
 */
export const stackBookmark = (lane: ThreadId): string =>
  `pinetrie/${lane}-stack`
/** Where git keeps a split's stack in your repo: `laneStackName`'s ref. */
export const laneStackRef = (lane: ThreadId): string =>
  `refs/remotes/${laneRemote(lane)}/stack`
export const laneStackName = (lane: ThreadId): string =>
  `stack@${laneRemote(lane)}`

/**
 * A lane's offer in your repo. Not under `pinetrie/`, whose bookmarks were
 * immutable when offers began.
 */
export const OFFER_PREFIX = "pinetrie-offer/"
export const offerBookmark = (name: ThreadName): string =>
  `${OFFER_PREFIX}${name}`
/** Every offer's bookmark, as a revset. */
export const OFFER_BOOKMARKS = `bookmarks(glob:${revsetName(`${OFFER_PREFIX}*`)})`

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

/** A lane's spec: a thread's, unless `L` says the base's scratch lane. */
export interface LaneSpec<L extends LaneOwner = ThreadId> {
  readonly lane: L
  readonly image: string
  /** The image's own `PATH`; the runtime's `bin` is added after it. */
  readonly imagePath: string
  /** Every host path the lane sees, from `planMounts`. */
  readonly mounts: readonly Mount[]
  /** The grants that are not mounts: your ssh agent, lanes inside, named variables. */
  readonly grants: Pick<LaneGrants, "ssh" | "nested" | "hostPorts" | "env">
  readonly identity: { readonly name: string; readonly email: string }
  readonly memory: string
  /** How the lane's tool calls are observed: its variables, carried unread. */
  readonly observation: Readonly<Record<string, string>>
}

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
    ...parts.shared.map(d => ({
      source: d.source,
      target: path.posix.join(WORKSPACE_ROOT, d.path),
      readonly: false,
    })),
    ...parts.hostPaths.map(p => at(p, hostPathInLane(p))),
  ]
}

/**
 * Which host paths a lane is granted, read-only: the roots a
 * command's files live in. Nested roots collapse into the outermost. A root
 * that is, or contains, your home directory, `/` or pi's agent directory
 * (which holds `auth.json`) is refused, as is one Docker cannot mount.
 * A root inside the agent directory, such as a package it installed, is not
 * refused: it lies inside it, and does not contain it.
 */
export function planHostMounts(input: {
  readonly roots: readonly string[]
  readonly home: string
  readonly agentDir: string
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
          : isWithin(input.agentDir, root)
            ? "it is, or holds, pi's agent directory"
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
  /** Host paths, from `planMounts`. */
  readonly mounts: readonly Mount[]
  readonly env: Readonly<Record<string, string>>
  /** Your ssh agent, forwarded. */
  readonly ssh: boolean
  /** Lanes of its own inside it: rootless Docker. */
  readonly nested: boolean
  /** Ports of the Mac's loopback it may reach (`LaneGrants.hostPorts`). */
  readonly hostPorts: readonly number[]
}

/**
 * A lane's container. It mounts what `planMounts` listed: nothing of your
 * home directory unless a grant or a skill's root names it, so credentials
 * stay out of reach. Only variables a grant names are copied
 * from `env`, first, so pine·trie's own come after them.
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
    mounts: spec.mounts,
    ssh: spec.grants.ssh,
    nested: spec.grants.nested,
    hostPorts: spec.grants.hostPorts,
    env: Object.fromEntries([
      ...passed,
      ["JJ_USER", spec.identity.name],
      ["JJ_EMAIL", spec.identity.email],
      ["JJ_CONFIG", LANE_JJ_CONFIG],
      ["HOME", LANE_HOME],
      ...Object.entries(spec.observation),
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
 * The lane's ignore file: what no repo in a lane may track. pine·trie's own
 * config, the file system's own directory, pnpm's store and each shared
 * directory.
 */
export const laneIgnores = (shared: readonly string[]): string =>
  [
    "/.pinetrie-lane/",
    "/lost+found/",
    // pnpm keeps its store at the root of the file system it installs on,
    // which in a lane is the disk's: no repo in a lane may track it.
    "/.pnpm-store/",
    ...shared.map(p => `/${p}/`),
  ]
    .map(l => `${l}\n`)
    .join("")

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []

/**
 * A JSON config file as read: the user config or a project's `pinetrie.json`.
 * `broken` is a file that exists but could not be read or parsed.
 */
export type ConfigRead =
  | { readonly kind: "read"; readonly json: unknown }
  | { readonly kind: "missing" }
  | { readonly kind: "broken"; readonly reason: string }

/** What a config's decoder is given: its JSON, else null, which decodes as empty. */
export const configJson = (read: ConfigRead): unknown =>
  read.kind === "read" ? read.json : null

/** A `lanes` key: the project's `pinetrie.json`, or the user's config. */
export interface LaneConfig {
  readonly grants: LaneGrants
  /** Relative paths, as written; `planShared` decides which apply. */
  readonly shared: readonly string[]
  /** How pine·trie uses your repo, as written (`repoConfig` decides). */
  readonly repo: WrittenRepo
  /** The machine's lane settings, as written; only the user's apply (`machineConfig`). */
  readonly machine: WrittenMachine
}

/** `lanes.vm.slots` as written: null where absent. */
export interface WrittenMachine {
  readonly slots: number | { readonly invalid: string } | null
}

const NO_MACHINE: WrittenMachine = { slots: null }

/**
 * The `accepted`, `wip` and `publish` keys' values, as written:
 * null where absent. `offers` says the config still has the key they
 * replaced, which is not read.
 */
export interface WrittenRepo {
  readonly acceptedBookmark: string | null
  readonly wipPrefix: string | null
  readonly publish: string | null
  readonly catchUp: WrittenFlag
  readonly offers: boolean
}

/**
 * A boolean config value as written: null where absent, and a non-boolean as
 * its JSON text, for the refusal that names it.
 */
export type WrittenFlag = boolean | { readonly invalid: string } | null

const writtenFlag = (v: unknown): WrittenFlag =>
  v === undefined
    ? null
    : typeof v === "boolean"
      ? v
      : { invalid: JSON.stringify(v) ?? String(v) }

/**
 * What a `pinetrie.json` decides of a lane: its grants and its shared
 * directories. A fact of a state: accepted work's copy, less what the
 * lane's own gave up (`effectiveLaneConfig`).
 */
export type LaneAuthority = Pick<LaneConfig, "grants" | "shared">

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

/**
 * A parsed lane config, total: anything missing or malformed grants and
 * shares nothing.
 * A grant's mount source is relative to the project's root, and its target
 * must be absolute.
 */
export function decodeLaneConfig(json: unknown, root: string): LaneConfig {
  const lanes = isRecord(json) ? json.lanes : undefined
  const key = (name: string): Record<string, unknown> => {
    const value = isRecord(json) ? json[name] : undefined
    return isRecord(value) ? value : {}
  }
  const named = (v: unknown) => (typeof v === "string" ? v : null)
  const publish = key("publish")
  const repo: WrittenRepo = {
    acceptedBookmark: named(key("accepted").bookmark),
    wipPrefix: named(key("wip").prefix),
    publish: named(publish.bookmark),
    catchUp: writtenFlag(publish.catchUp),
    offers: isRecord(json) && json.offers !== undefined,
  }
  if (!isRecord(lanes))
    return {
      grants: NO_GRANTS,
      shared: [],
      repo,
      machine: NO_MACHINE,
    }
  const invalid = (v: unknown) => ({ invalid: JSON.stringify(v) ?? String(v) })
  const vm = isRecord(lanes.vm) ? lanes.vm : {}
  const machine: WrittenMachine = {
    slots:
      vm.slots === undefined
        ? null
        : typeof vm.slots === "number"
          ? vm.slots
          : invalid(vm.slots),
  }
  const mounts = Array.isArray(lanes.mounts)
    ? lanes.mounts.flatMap(m =>
        isRecord(m) &&
        typeof m.source === "string" &&
        typeof m.target === "string" &&
        m.source !== "" &&
        path.posix.isAbsolute(m.target)
          ? [
              {
                source: path.resolve(root, m.source),
                target: m.target,
                readonly: true,
              },
            ]
          : [],
      )
    : []
  return {
    grants: {
      ssh: lanes.ssh === true,
      nested: lanes.nested === true,
      hostPorts: Array.isArray(lanes.hostPorts)
        ? [
            ...new Set(
              lanes.hostPorts.filter(
                (p): p is number => Number.isInteger(p) && p >= 1 && p <= 65535,
              ),
            ),
          ].sort((a, b) => a - b)
        : [],
      env: strings(lanes.env).filter(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)),
      mounts,
    },
    shared: strings(lanes.shared),
    repo,
    machine,
  }
}

/** The slots a lane VM boots with when the user config names none. */
export const DEFAULT_VM_SLOTS = 16
/** A VM boots with 20 share devices alongside its others, and not 24. */
export const MAX_VM_SLOTS = 20

/** This machine's lane settings, from the user's config; each bad value refused, naming why. */
export interface MachineConfig {
  readonly slots: number
}

/**
 * The VM's slots, from the user's config only: a person's machine setting,
 * not a project's. A value that cannot be used is refused, with why, and
 * the default holds.
 */
export function machineConfig(user: WrittenMachine): {
  readonly machine: MachineConfig
  readonly refused: readonly string[]
} {
  const refused: string[] = []
  let slots = DEFAULT_VM_SLOTS
  const n = user.slots
  if (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= 1 &&
    n <= MAX_VM_SLOTS
  )
    slots = n
  else if (n !== null)
    refused.push(
      `lanes.vm.slots ${typeof n === "number" ? n : n.invalid} is not a whole number from 1 to ${MAX_VM_SLOTS}: a VM boots with at most ${MAX_VM_SLOTS} share devices beside its others; using ${DEFAULT_VM_SLOTS}`,
    )
  return { machine: { slots }, refused }
}

/**
 * How pine·trie uses your repo: accepted work's bookmark, the WIP bookmarks'
 * prefix, the bookmark publishing moves to accepted work, and whether a
 * publish catches the working copy up and accepts your commits first.
 */
export interface RepoConfig {
  readonly acceptedBookmark: string
  readonly wipPrefix: string
  readonly publish: string
  readonly publishCatchesUp: boolean
}

export const DEFAULT_REPO: RepoConfig = {
  acceptedBookmark: "pinetrie-accepted",
  wipPrefix: "wip/",
  publish: "main",
  publishCatchesUp: false,
}

/**
 * Whether `name` is usable as a bookmark, by git's ref-name rules, which a
 * colocated repo's bookmarks must meet: no space or control character, none
 * of `~^:?*[\\@{`, no `..`, no `//`, not starting with `-` or `/`, not ending
 * with `/`, `.` or `.lock`.
 */
export const isBookmarkName = (name: string): boolean =>
  name !== "" &&
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the rule is about them
  !/[\x00-\x20\x7f~^:?*[\\@{]/.test(name) &&
  !name.includes("..") &&
  !name.includes("//") &&
  !name.startsWith("-") &&
  !name.startsWith("/") &&
  !name.endsWith("/") &&
  !name.endsWith(".") &&
  !name.endsWith(".lock")

/** Each written value's key in the config, as a refusal names it. */
const KEYS = {
  acceptedBookmark: "accepted.bookmark",
  wipPrefix: "wip.prefix",
  publish: "publish.bookmark",
} as const

/**
 * How pine·trie uses your repo, from the user's config and the project's: the
 * project's value wins, since the bookmarks belong to the repo. A name that
 * is not a bookmark, or a `publish.catchUp` that is not a boolean, falls back
 * to the default, with why; a config's `offers`, which is no longer read, is
 * named too. The WIP prefix is checked as the start of a name (`<prefix>x`).
 */
export function repoConfig(
  user: WrittenRepo,
  project: WrittenRepo,
): { readonly repoConfig: RepoConfig; readonly refused: readonly string[] } {
  const refused: string[] = [
    ...(user.offers ? ["your config"] : []),
    ...(project.offers ? ["pinetrie.json"] : []),
  ].map(
    file =>
      `${file}: offers is no longer read; use accepted.bookmark, wip.prefix, publish.bookmark and publish.catchUp`,
  )
  const pick = (
    key: keyof typeof KEYS,
    valid: (v: string) => boolean,
  ): string => {
    const value = project[key] ?? user[key]
    if (value === null) return DEFAULT_REPO[key]
    if (valid(value)) return value
    refused.push(
      `${KEYS[key]} "${value}" is not a bookmark name; using "${DEFAULT_REPO[key]}"`,
    )
    return DEFAULT_REPO[key]
  }
  const flag = project.catchUp ?? user.catchUp
  let catchUp = DEFAULT_REPO.publishCatchesUp
  if (typeof flag === "boolean") catchUp = flag
  else if (flag !== null)
    refused.push(
      `publish.catchUp ${flag.invalid} is not true or false; using ${DEFAULT_REPO.publishCatchesUp}`,
    )
  return {
    repoConfig: {
      acceptedBookmark: pick("acceptedBookmark", isBookmarkName),
      wipPrefix: pick("wipPrefix", v => isBookmarkName(`${v}x`)),
      publish: pick("publish", isBookmarkName),
      publishCatchesUp: catchUp,
    },
    refused,
  }
}

/** Where a shared directory may never be: repos, pine·trie's own, dependencies. */
const NEVER_SHARED = [".git", ".jj", PROJECT_DIR, "node_modules"]

/**
 * Which shared directories apply, and what to do for them on the host. The
 * user's entries come first, then the project's, normalized and without
 * duplicates. Refused: absolute paths, paths that leave the project, those
 * in `.git`, `.jj`, `.pinetrie` or `node_modules`, and those holding files jj
 * tracks. A missing directory is created; one your repo does not already
 * ignore is added to its exclude file.
 */
export function planShared(facts: {
  readonly user: readonly string[]
  readonly project: readonly string[]
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
  const { candidates, refused } = sharedCandidates(facts)
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
 * The entries whose paths may be shared, normalized and each once, the user's
 * first; and those refused by their path alone. What they hold is for
 * `planShared` to judge, from what the host gathers of these candidates.
 */
export function sharedCandidates(entries: {
  readonly user: readonly string[]
  readonly project: readonly string[]
}): {
  readonly candidates: readonly string[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
} {
  const candidates: string[] = []
  const refused: { path: string; reason: string }[] = []
  for (const given of [...entries.user, ...entries.project]) {
    const reason = sharedRefusal(given)
    if (reason !== null) refused.push({ path: given, reason })
    else if (!candidates.includes(normalShared(given)))
      candidates.push(normalShared(given))
  }
  return { candidates, refused }
}

/** The line in your repo's exclude file that keeps `pinetrieDir` out of it. */
export const EXCLUDE_LINE = `/${PROJECT_DIR}/`

/**
 * What the host keeps in a project, all under `.pinetrie/` at its root, which
 * `EXCLUDE_LINE` keeps out of the project's repo.
 */
export function pinetrieDir(root: string): {
  readonly dir: string
  /** The session's SQLite file, unless `PINETRIE_STORE` names another. */
  readonly store: string
  /** `base.json`; Docker keeps lanes' snapshots in its lanes directory. */
  readonly snapshots: string
  /** The lane runtime, one directory per image tag. */
  readonly runtime: string
  /** The lanes' ignore file's directory (`laneIgnores`). */
  readonly laneGit: string
} {
  const dir = path.join(root, PROJECT_DIR)
  return {
    dir,
    store: path.join(dir, "pinetrie.db"),
    snapshots: path.join(dir, "snapshots"),
    runtime: path.join(dir, "runtime"),
    laneGit: path.join(dir, "lane-git"),
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

/**
 * A fork's whole jj config: in the repo at `repo`, everything at or above its
 * fork point is immutable, so the lane cannot rewrite a commit its parent or
 * your repo holds. A parent's fork point is an ancestor of its
 * child's, so nothing needs reading from the lane first.
 *
 * Scoped to `repo` because `JJ_CONFIG` reaches every jj command in the lane,
 * and jj rejects the whole config in a repo that lacks the commit.
 * `repo` is a plain path, written into TOML unescaped.
 */
export const forkConfig = (
  repo: string,
  commits: readonly CommitId[],
): string =>
  `[[--scope]]\n--when.repositories = ["${repo}"]\n[--scope.revset-aliases]\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\n`

/**
 * `forkConfig` with the repo and its one commit left to `printf`'s two `%s`,
 * in that order.
 */
const FORK_CONFIG_TEMPLATE = forkConfig("%s", ["%s" as CommitId])

/** One command in a lane, as data, run through the lane's runner. */
export interface LaneStep {
  readonly in: "lane"
  readonly argv: readonly string[]
  /** A host file the command's stdout is written to, as bytes. */
  readonly stdoutTo?: string
}

/** A lane command, or an operation of the runtime's. */
export type Step = LaneStep | { readonly in: "runtime"; readonly op: RuntimeOp }

const inLane = (...argv: string[]): LaneStep => ({ in: "lane", argv })
const onRuntime = (op: RuntimeOp): Step => ({ in: "runtime", op })
const laneShell = (script: string): LaneStep => inLane("sh", "-c", script)

/**
 * Fetch `commits` from `from` (your working copy, at `/mnt/host-working-copy`) when the disk
 * lacks any of them. The fetch puts each on a branch, which is what makes jj
 * see it, and jj imports it at once: a jj command with
 * `--ignore-working-copy` imports nothing. A commit a fork's disk already
 * holds needs no fetch.
 */
export function fetchById(
  commits: readonly CommitId[],
  from: string = HOST_WORKING_COPY,
): LaneStep {
  const has = commits.map(c => `git cat-file -e ${c}^{commit}`).join(" && ")
  const refs = commits.map((c, i) => `+${c}:${FETCHED_REF}/${i}`).join(" ")
  return laneShell(
    `{ ${has}; } 2>/dev/null || { git fetch -q ${shellWord(from)} ${refs} && jj --ignore-working-copy git import --quiet; }`,
  )
}

/**
 * The lane steps that start a lane on accepted work: an empty commit on
 * accepted work's commit, left as `@-`, whose trailer says the thread is on
 * accepted work.
 */
export const planAcceptedStart = (commit: CommitId): LaneStep[] => [
  fetchById([commit]),
  inLane("jj", "new", commit),
  inLane(
    "jj",
    "commit",
    "-m",
    baseMessage("base: accepted work", { kind: "accepted", commit }),
  ),
]

/**
 * The lane steps that make a copy of a WIP: a commit on `on`
 * with the WIP's files and a change id of its own, left as `@-`. Never the
 * WIP's own commits: the lane's tip, immutable in your repo, would make them
 * immutable. Fetches nothing: the lane must hold both commits.
 */
export const planWipCopy = (
  wip: { readonly bookmark: string; readonly commit: CommitId },
  on: CommitId,
): LaneStep[] => [
  inLane("jj", "new", on),
  inLane("jj", "restore", "--from", wip.commit),
  inLane(
    "jj",
    "commit",
    "-m",
    baseMessage(`copy of ${wip.bookmark}`, {
      kind: "wip",
      bookmark: wip.bookmark,
      commit: wip.commit,
    }),
  ),
]

/** What an update runs in a lane before its merge, and what it merges (`mergeUpdate`). */
export interface MergePlan {
  /**
   * A fetch of accepted work's commit; or a fetch of the WIP's commit and its copy
   * on the lane's previous copy, left as `@-`.
   */
  readonly steps: readonly LaneStep[]
  /** The commit to merge, or the copy the steps leave as `@-`. */
  readonly source: CommitId | "copy"
  /** Accepted work's names the base (`Pinetrie-Base`); a WIP's copy names its own; a parent's none. */
  readonly message: string
  /** With nothing to merge, a commit still names accepted work (`BaseMerge`). */
  readonly mark: boolean
  /**
   * The commits whose titles the update lists, `<from>..<to>` without the
   * accepted-offer commits it joined (`mergeUpdate`); `from` null is the lane before the merge.
   */
  readonly came: { readonly from: CommitId | null; readonly to: CommitId }
}

/**
 * An update's steps. A WIP's copy fetches only the WIP's commit:
 * the copy's parent is the lane's own. The thread it branched from is merged
 * as accepted work's commit is, with no `Pinetrie-Base`: it is no base, and what
 * the lane holds of it is its history.
 */
export function planMerge(from: BaseMerge): MergePlan {
  if (from.kind === "accepted")
    return {
      steps: [fetchById([from.commit])],
      source: from.commit,
      message: baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: from.commit,
      }),
      mark: from.mark,
      came: { from: null, to: from.commit },
    }
  if (from.kind === "parent")
    return {
      steps: [fetchById([from.commit])],
      source: from.commit,
      message: `catch up: ${from.name}`,
      mark: false,
      came: { from: from.caughtUpWith, to: from.commit },
    }
  return {
    steps: [fetchById([from.commit]), ...planWipCopy(from, from.on)],
    source: "copy",
    message: `update: ${from.bookmark}`,
    mark: false,
    came: { from: from.under, to: from.commit },
  }
}

/** An accepted-offer commit on accepted work the lane lacks, and the sources its message names (`sourcesOf`). */
export interface AcceptedOfferCommitAbove {
  readonly acceptedOfferCommit: CommitId
  readonly sources: readonly CommitId[]
}

/** An accepted-offer commit to join to the sources the lane holds, before an update's merge. */
export interface Join {
  readonly acceptedOfferCommit: CommitId
  /** Of its sources, those in the lane's history: a squash may name others. */
  readonly sources: readonly CommitId[]
  /**
   * The join's message. It carries no trailer: the host finds bases and
   * accepted-offer commits by their trailers (`newestBase`,
   * `acceptedOfferCommitsRevset`), and a join is neither.
   */
  readonly message: string
}

/**
 * The accepted-offer commits an update joins to their sources before it
 * merges, oldest first as they come: each that names a
 * source the lane holds. An accepted-offer commit is a copy of the lane's
 * work on accepted work, and the join says so in history, so the merge does not
 * bring that work in twice. One naming a source the lane lacks too, a
 * squash's, is joined all the same: the rest of it is accepted work's. Each join
 * is made on the one before, so a later one's base holds the earlier ones.
 */
export function planJoins(
  accepted: readonly AcceptedOfferCommitAbove[],
  held: ReadonlySet<CommitId>,
): readonly Join[] {
  return accepted.flatMap(({ acceptedOfferCommit, sources }) => {
    const ours = sources.filter(s => held.has(s))
    return ours.length === 0
      ? []
      : [
          {
            acceptedOfferCommit,
            sources: ours,
            message: `join: ${acceptedOfferCommit} holds ${ours.join(" ")}`,
          },
        ]
  })
}

/**
 * The lane steps that make a disk a fork: a change of its own, before any
 * other jj command runs there, the lane's bookmark at its base, and
 * inherited history made immutable. Without it, the fork's first turn reuses
 * its parent's change id, and your repo sees a divergent change. A base with
 * several parents is committed once, empty, so the bookmark names one commit.
 * A lane starting on accepted work or a WIP's copy is based on the commit that
 * names it.
 */
export function planForkSetup(lane: ThreadId, start: ForkStart): LaneStep[] {
  const base: LaneStep[] =
    start.kind === "accepted"
      ? planAcceptedStart(start.commit)
      : start.kind === "wip"
        ? [
            fetchById([start.commit, start.under]),
            ...planWipCopy(start, start.under),
          ]
        : [
            fetchById(start.commits),
            inLane("jj", "new", ...start.commits),
            ...(start.commits.length > 1
              ? [inLane("jj", "commit", "-m", `base: ${lane}`)]
              : []),
          ]
  // A start made here is known only once made: the config reads @-.
  const immutable =
    start.kind !== "commits" || start.commits.length > 1
      ? `"$(jj --ignore-working-copy log --no-graph -r @- -T commit_id)"`
      : shellWord(start.commits[0] ?? "")
  return [
    // pre-rename: before any jj command, which would snapshot it into the
    // working copy the clone carries (`OLD_LANE_CONFIG_DIR`).
    laneShell(`rm -rf ${OLD_LANE_CONFIG_DIR}`),
    ...base,
    inLane(
      "jj",
      "bookmark",
      "set",
      "--allow-backwards",
      bookmarkName(lane),
      "-r",
      "@-",
    ),
    laneShell(
      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,
    ),
  ]
}

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
/** pre-rename: the prefix of the lane's bookmarks before b05e2252. */
const OLD_BOOKMARK_PREFIX = "pineta/"

/** pre-rename: what of the names before the rename is on a lane's disk. */
export interface OldNamesOnDisk {
  readonly configDir: { readonly old: boolean; readonly current: boolean }
  /** Every bookmark in the lane's repo. */
  readonly bookmarks: readonly string[]
}

/**
 * pre-rename: the steps that give a disk cloned from a snapshot taken before
 * the rename the names the host reads now; empty when nothing is old.
 * The config folder moves first, so the jj steps after it run under the
 * lane's own config: jj ignores a `JJ_CONFIG` naming no file. Bookmarks of
 * other lanes, a fork's inherited ones, are never read and are left alone.
 */
export function planOldNamesOnDisk(
  facts: OldNamesOnDisk,
  lane: ThreadId,
): LaneStep[] {
  const { configDir, bookmarks } = facts
  const has = new Set(bookmarks)
  // `-R`, so the steps need no working directory.
  const bookmark = (...args: string[]) =>
    inLane(
      "jj",
      "-R",
      WORKSPACE_ROOT,
      "--ignore-working-copy",
      "bookmark",
      ...args,
    )
  const folder = !configDir.old
    ? []
    : [
        laneShell(
          configDir.current
            ? `rm -rf ${OLD_LANE_CONFIG_DIR}`
            : `mv ${OLD_LANE_CONFIG_DIR} ${LANE_CONFIG_DIR}`,
        ),
      ]
  const pairs: readonly (readonly [string, string])[] = [
    [`${OLD_BOOKMARK_PREFIX}${lane}`, bookmarkName(lane)],
    [`${OLD_BOOKMARK_PREFIX}${lane}-stack`, stackBookmark(lane)],
  ]
  const renames = pairs
    .filter(([old]) => has.has(old))
    .map(([old, now]) =>
      has.has(now) ? bookmark("delete", old) : bookmark("rename", old, now),
    )
  const fetched = bookmarks.filter(b =>
    b.startsWith(`${OLD_BOOKMARK_PREFIX}fetched/`),
  )
  return [
    ...folder,
    ...renames,
    ...(fetched.length === 0 ? [] : [bookmark("delete", ...fetched)]),
  ]
}

/** A fork: its disk cloned from the fork point's snapshot, then `planForkSetup`. */
export const planFork = (input: {
  readonly point: {
    readonly snapshot: SnapshotId
    readonly start: ForkStart
  }
  readonly spec: LaneSpec
  readonly env: Readonly<Record<string, string | undefined>>
}): Step[] => [
  ...planDisk({ ...input, from: input.point.snapshot }),
  ...planForkSetup(input.spec.lane, input.point.start),
]

/**
 * A git bundle of `bookmark` in the lane, written to the host file `to`,
 * excluding what your repo already has: a bundle naming only the bookmark
 * carries the whole history, 1.1 MB against 8 KB for one commit on pine·trie's
 * repo. Your repo imports it with `@pinetrie/repo`'s `planImport`.
 */
export const planBundle = (input: {
  readonly bookmark: string
  readonly have: readonly CommitId[]
  readonly to: string
}): LaneStep => ({
  in: "lane",
  argv: [
    "git",
    "bundle",
    "create",
    "-",
    `refs/heads/${input.bookmark}`,
    ...input.have.map(c => `^${c}`),
  ],
  stdoutTo: input.to,
})

/** What a turn's revision is: a commit of `@`, a commit the agent made, or none. */
export type TurnCommit =
  | { readonly kind: "commit" }
  | { readonly kind: "adopt"; readonly commit: CommitId }
  | { readonly kind: "none" }

/**
 * A turn whose `@` has changes commits them. With `@` empty, a single parent
 * that descends from the lane's bookmark is a commit the agent made in the
 * turn, and is the turn's revision: otherwise the offer would lack it,
 * and a branch's `jj new` would put the bookmark's files back. A parent on
 * another line, such as a stack's, or a merge, is left alone.
 */
export function planTurnCommit(facts: {
  readonly atEmpty: boolean
  /** `@-`: one commit, or several after `jj new a b`. */
  readonly parents: readonly CommitId[]
  readonly bookmark: CommitId | null
  /** The bookmark is an ancestor of `@-`, or `@-` itself. */
  readonly parentDescends: boolean
}): TurnCommit {
  if (!facts.atEmpty) return { kind: "commit" }
  const [parent, ...others] = facts.parents
  if (parent === undefined || others.length > 0) return { kind: "none" }
  if (facts.bookmark === null || parent === facts.bookmark)
    return { kind: "none" }
  return facts.parentDescends
    ? { kind: "adopt", commit: parent }
    : { kind: "none" }
}

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

/** What the base disk is: accepted work's commits, made by `format`'s steps. */
export interface BaseFacts {
  readonly commits: readonly CommitId[]
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
      commits: raw.commits.map(c => commitId(String(c))),
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
 * A base's checkout of accepted work's commits (`yours`), by id. On a fresh
 * disk, `git init` and `jj git init --colocate` first, not `jj git clone`: a
 * fresh volume holds `lost+found`, which `jj git clone` refuses.
 *
 * On a base copied from the one before, made at other commits, the fetched
 * ref moves sideways when your `@-` was rewritten rather than built
 * on: the import abandons the commit it named, and rebases the working-copy
 * commit, a child of it, with `--ignore-working-copy`. The working copy is
 * then stale, and `jj new` refuses until `jj workspace update-stale`, which
 * does nothing when it is not.
 */
export function planBaseCheckout(input: {
  readonly yours: readonly CommitId[]
  readonly fresh: boolean
}): readonly LaneStep[] {
  return [
    ...(input.fresh
      ? [inLane("git", "init", "-q"), inLane("jj", "git", "init", "--colocate")]
      : []),
    fetchById(input.yours),
    ...(input.fresh ? [] : [inLane("jj", "workspace", "update-stale")]),
    inLane("jj", "new", ...input.yours),
  ]
}

/** The base's facts at `commits`, written on its disk before it is snapshotted. */
export const planBaseFacts = (commits: readonly CommitId[]): LaneStep =>
  writeLaneFile(BASE_FILE, { commits, format: BASE_FORMAT })

/** Whether the base disk holds `yours`, made the way it is now: then a refresh does nothing. */
export const isBaseCurrent = (
  base: BaseFacts | null,
  yours: readonly CommitId[],
): boolean =>
  isCopyableBase(base) &&
  base.commits.length === yours.length &&
  base.commits.every((c, i) => c === yours[i])

/**
 * Whether a base is one the next is copied from. One made by other steps
 * may hold what nothing records: a base from before was made on a
 * dependency layer, whose outputs no registry names.
 */
export const isCopyableBase = (base: BaseFacts | null): base is BaseFacts =>
  base !== null && base.format === BASE_FORMAT

/**
 * pre-layers: the dependency layers bases were once made on (`deps-<key>`),
 * which nothing reads now. Remove once no host has one.
 */
export const planLeftoverLayers = (
  snapshots: readonly { readonly id: string }[],
): readonly SnapshotId[] =>
  snapshots.filter(s => s.id.startsWith("deps-")).map(s => snapshotId(s.id))

/** A project's root for lanes, or why its folder cannot have them. */
export type ProjectRoot = { readonly ok: string } | { readonly refused: string }

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
  /** A jj repo with no git directory beside it to exclude `.pinetrie/` in. */
  | { readonly kind: "unexcludable"; readonly root: string }

/** A project's root and the repo there, or why the folder cannot be one. */
export type ProjectDir =
  | {
      readonly kind: "found"
      readonly root: string
      readonly repo: "jj" | "git" | null
    }
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
  const repo = f.jjRoot !== null ? "jj" : f.gitTop !== null ? "git" : null
  return { kind: "found", root, repo }
}

/** A refusal's words, for the log, `ProjectRecord.reason` and the command line. */
export function projectDirWords(r: ProjectDirRefusal): string {
  switch (r.kind) {
    case "missing":
      return `${r.dir} is not a directory`
    case "unsafe":
      return `${r.root} is your home directory or the file system's root`
    case "unexcludable":
      return `${r.root} has no git directory beside its jj repo to exclude .pinetrie/ in: \`jj git init --colocate\` makes one, or PINETRIE_STORE can name a store elsewhere`
  }
}

/**
 * The root lanes work from, from what `planProjectDir` found: a folder it
 * refused, or one with no jj repo, cannot have lanes (a lane's commits need
 * jj on both sides), and the refusal says how to make one.
 */
export function planRoot(d: ProjectDir): ProjectRoot {
  if (d.kind === "refused") return { refused: projectDirWords(d.refusal) }
  if (d.repo !== "jj")
    return {
      refused: `${d.root} has no jj repo: \`jj git init --colocate\` makes one, and gives its threads' agents their lanes`,
    }
  return { ok: d.root }
}

/**
 * Your repo's exclude file with each of `lines` in it, appended in order, or
 * null when they are all there already. `/.pinetrie/` holds what `pinetrieDir`
 * lays out; shared directories are added as `/<path>/`.
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
