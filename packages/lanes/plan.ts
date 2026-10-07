// lanes/plan — every decision about a lane's container and disk, as values
// (ADR-0034).
//
// Each function here is pure. What runs is a list of `LaneStep`s, carried out
// by `execute.ts`; what is gathered is gathered by `host.ts`, `disk.ts` and
// the host. So each rule below is tested without `container`, jj or git.

import { createHash } from "node:crypto"
import path from "node:path"
import {
  type BaseMerge,
  baseMessage,
  type CommitId,
  type ForkStart,
  HOST_WORKING_COPY,
  hostPathInLane,
  isWithin,
  type LaneName,
  NO_EDITOR,
  type ProjectRecord,
  type SnapshotId,
  shellWord,
  type ThreadName,
  WORKSPACE_ROOT,
} from "@pinetrie/core"

/** pinetrie's own install, read-only: the helper's code and pi's. */
export const PINETRIE_MOUNT = "/pinetrie"
/**
 * pinetrie's lane runtime, read-only: Node and its libraries (S44), and in
 * `bin/` the static programs core's `RUNTIME_PROGRAMS` lists.
 */
export const RUNTIME_MOUNT = "/pinetrie-runtime"
/** The runtime's programs, as a lane sees them: on its `PATH`, last. */
export const RUNTIME_BIN = `${RUNTIME_MOUNT}/bin`
/** The lane's own jj config, on its disk so that forks inherit it (S42 item 4). */
export const LANE_CONFIG_DIR = `${WORKSPACE_ROOT}/.pinetrie-lane`
export const LANE_JJ_CONFIG = `${LANE_CONFIG_DIR}/jj.toml`
/** The branch a commit fetched by id is put on, so jj sees it (S44 item 7). */
export const FETCHED_REF = "refs/heads/pinetrie/fetched"
/** The directory the host keeps in a project's root (`pinetrieDir`). */
export const PROJECT_DIR = ".pinetrie"
/** A new volume's size. The image is sparse: only written blocks take space. */
const DISK_SIZE = "64G"

/** The bookmark that holds a lane's newest revision, in the lane's own repo. */
export const bookmarkName = (lane: LaneName): string => `pinetrie/${lane}`

/** A revset string literal, so a bookmark name is never parsed as a revset. */
export const revsetName = (name: string): string => JSON.stringify(name)

/** The revset of one bookmark, its name quoted so it is never parsed as a revset. */
export const bookmarkRevset = (name: string): string =>
  `bookmarks(exact:${revsetName(name)})`

/**
 * A lane's history in your repo: a remote bookmark, `tip@pinetrie-<lane>`,
 * which jj keeps out of your default log and immutable with its builtin
 * config, ancestors included (S48 items 11 and 19). No git remote is added.
 */
export const LANE_REMOTE_PREFIX = "pinetrie-"
const laneRemote = (lane: LaneName): string => `${LANE_REMOTE_PREFIX}${lane}`
/** Where git keeps a lane's history in your repo: `laneTipName`'s ref. */
export const laneTipRef = (lane: LaneName): string =>
  `refs/remotes/${laneRemote(lane)}/tip`
export const laneTipName = (lane: LaneName): string => `tip@${laneRemote(lane)}`

/**
 * A split's stack (ADR-0038): the bookmark its run leaves in the lane's own
 * repo, and the remote bookmark it arrives as in yours.
 */
export const stackBookmark = (lane: LaneName): string =>
  `pinetrie/${lane}-stack`
/** Where git keeps a split's stack in your repo: `laneStackName`'s ref. */
export const laneStackRef = (lane: LaneName): string =>
  `refs/remotes/${laneRemote(lane)}/stack`
export const laneStackName = (lane: LaneName): string =>
  `stack@${laneRemote(lane)}`

/**
 * A lane's offer in your repo (ADR-0038). Not under `pinetrie/`, whose
 * bookmarks were immutable before ADR-0038 (S48 item 14).
 */
export const OFFER_PREFIX = "pinetrie-offer/"
export const offerBookmark = (name: ThreadName): string =>
  `${OFFER_PREFIX}${name}`
/** Every offer's bookmark, as a revset. */
export const OFFER_BOOKMARKS = `bookmarks(glob:${revsetName(`${OFFER_PREFIX}*`)})`

/** The container and the volume of a lane share one name. */
export const laneContainer = (lane: LaneName): string => `pinetrie-${lane}`

/** What a project lets cross a lane's boundary (ADR-0034), from `pinetrie.json`. */
export interface LaneGrants {
  readonly ssh: boolean
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

export const NO_GRANTS: LaneGrants = { ssh: false, env: [], mounts: [] }

/** How the base snapshot installs a project's dependencies. */
export interface Install {
  /** A shell command, run in `/workspace`. */
  readonly command: string
  /** The file whose change makes the base snapshot install again. */
  readonly lockfile: string
}

export interface LaneSpec {
  readonly lane: LaneName
  readonly volume: string
  readonly image: string
  /** The image's own `PATH`; the runtime's `bin` is added after it. */
  readonly imagePath: string
  /** Every host path the lane sees, from `planMounts`. */
  readonly mounts: readonly Mount[]
  /** The grants that are not mounts: your ssh agent, named variables. */
  readonly grants: Pick<LaneGrants, "ssh" | "env">
  readonly identity: { readonly name: string; readonly email: string }
  readonly memory: string
}

/**
 * Every mount a lane gets, in one list:
 * - your working copy, read-only at `/mnt/host-working-copy`;
 * - pinetrie's own install at `/pinetrie` and its runtime at `/pinetrie-runtime`,
 *   and the directory of the lane's ignore file at `/pinetrie-git`, read-only;
 * - links' and grants' mounts, read-only where they say;
 * - shared directories, read-write at their place in `/workspace` (ADR-0035);
 * - granted host paths, read-only at `/mnt/host` and their path (ADR-0036).
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
 * Which host paths a lane is granted, read-only (ADR-0036): the roots a
 * command's files live in. Nested roots collapse into the outermost. A root
 * that is, or contains, your home directory, `/` or pi's agent directory
 * (which holds `auth.json`) is refused, as is one `container` cannot mount.
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
            : root.includes(",") && root.includes(":")
              ? "it has both a comma and a colon, which container cannot mount"
              : null
    if (reason === null) allowed.push(root)
    else refused.push({ path: root, reason })
  }
  const mounts = allowed
    .filter(r => !allowed.some(o => o !== r && isWithin(r, o)))
    .sort()
  return { mounts, refused }
}

/** A directory of your working copy, shared read-write into every lane (ADR-0035). */
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
/** The label a container's spec hash is kept under. */
export const SPEC_LABEL = "pinetrie.spec"

const setEnv = (name: string, value: string): string[] => [
  "-e",
  `${name}=${value}`,
]

/**
 * `container run` arguments for a lane, labelled with their own hash
 * (`specHash`), so a container made from another spec can be told apart.
 *
 * It mounts what `planMounts` listed, each through `mountArgs`: nothing of
 * your home directory unless a grant or a skill's root names it, so
 * credentials stay out of reach (S43 item 7). `--init` reaps the processes a
 * timeout or an abort kills (S39 item 6). Only variables a grant names are
 * copied from `env`.
 */
export function planRun(
  spec: LaneSpec,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const args = runArgs(spec, env)
  const [first, ...rest] = args
  return [first ?? "run", "--label", `${SPEC_LABEL}=${specHash(args)}`, ...rest]
}

/** The hash a lane's container is labelled with: of its arguments, without the label. */
export const specHash = (args: readonly string[]): string =>
  createHash("sha256").update(args.join("\0")).digest("hex").slice(0, 16)

/** The hash `planRun` labels a lane's container with. */
export const specHashOf = (
  spec: LaneSpec,
  env: Readonly<Record<string, string | undefined>>,
): string => specHash(runArgs(spec, env))

function runArgs(
  spec: LaneSpec,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const passed = spec.grants.env.flatMap(name => {
    const value = env[name]
    return value === undefined ? [] : setEnv(name, value)
  })
  return [
    "run",
    "-d",
    "--init",
    "--name",
    laneContainer(spec.lane),
    "-m",
    spec.memory,
    "-v",
    `${spec.volume}:${WORKSPACE_ROOT}`,
    ...spec.mounts.flatMap(mountArgs),
    ...(spec.grants.ssh ? ["--ssh"] : []),
    ...passed,
    ...setEnv("JJ_USER", spec.identity.name),
    ...setEnv("JJ_EMAIL", spec.identity.email),
    ...setEnv("JJ_CONFIG", LANE_JJ_CONFIG),
    // Every repo in the lane ignores what the ignore file lists, from the
    // container's first moment: git's own variables, which jj reads too
    // (S45 item 7). An exclude line written by a step would come too late
    // for a jj command that ran first (S45 item 4).
    ...setEnv("GIT_CONFIG_COUNT", "1"),
    ...setEnv("GIT_CONFIG_KEY_0", "core.excludesFile"),
    ...setEnv("GIT_CONFIG_VALUE_0", `${IGNORE_MOUNT}/${IGNORE_FILE}`),
    ...Object.entries(NO_EDITOR).flatMap(([k, v]) => setEnv(k, v)),
    // Last, so the image's own programs win: the runtime brings its
    // programs for an image that has none, and never Node.
    ...setEnv("PATH", `${spec.imagePath}:${RUNTIME_BIN}`),
    "-w",
    WORKSPACE_ROOT,
    spec.image,
    "sleep",
    "infinity",
  ]
}

/**
 * The lane's ignore file: what no repo in a lane may track. pinetrie's own
 * config, the file system's own directory, and each shared directory.
 */
export const laneIgnores = (shared: readonly string[]): string =>
  ["/.pinetrie-lane/", "/lost+found/", ...shared.map(p => `/${p}/`)]
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
  /** How the base snapshot installs; null with nothing to install. */
  readonly install: Install | null
  /** Relative paths, as written; `planShared` decides which apply. */
  readonly shared: readonly string[]
  /** The `offers` key's values, as written; null where absent (`lineConfig`). */
  readonly offers: {
    readonly onto: string | null
    readonly wipPrefix: string | null
    readonly publish: string | null
    readonly catchUp: WrittenFlag
  }
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
 * A parsed lane config, total: anything missing or malformed grants, installs
 * and shares nothing.
 * - A grant's mount source is relative to the project's root, and its target
 *   must be absolute.
 * - The install is `lanes.install` with `lanes.installWhen` (its lockfile),
 *   else pnpm for a repo with a `pnpm-lock.yaml`.
 */
export function decodeLaneConfig(
  json: unknown,
  root: string,
  pnpmLock: boolean,
): LaneConfig {
  const lanes = isRecord(json) ? json.lanes : undefined
  const offersKey = isRecord(json) ? json.offers : undefined
  const named = (v: unknown) => (typeof v === "string" ? v : null)
  const offers = isRecord(offersKey)
    ? {
        onto: named(offersKey.onto),
        wipPrefix: named(offersKey.wipPrefix),
        publish: named(offersKey.publish),
        catchUp: writtenFlag(offersKey.catchUp),
      }
    : { onto: null, wipPrefix: null, publish: null, catchUp: null }
  const pnpm: Install | null = pnpmLock
    ? { command: "pnpm install --frozen-lockfile", lockfile: "pnpm-lock.yaml" }
    : null
  if (!isRecord(lanes))
    return { grants: NO_GRANTS, install: pnpm, shared: [], offers }
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
  const install =
    typeof lanes.install === "string" &&
    lanes.install !== "" &&
    typeof lanes.installWhen === "string" &&
    lanes.installWhen !== ""
      ? { command: lanes.install, lockfile: lanes.installWhen }
      : pnpm
  return {
    grants: {
      ssh: lanes.ssh === true,
      env: strings(lanes.env).filter(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)),
      mounts,
    },
    install,
    shared: strings(lanes.shared),
    offers,
  }
}

/**
 * Accepted work's bookmark, the WIP bookmarks' prefix (ADR-0060), the
 * bookmark publishing moves to the line (ADR-0076), and whether a publish
 * catches your files up and accepts your commits first (ADR-0099).
 */
export interface LineConfig {
  readonly onto: string
  readonly wipPrefix: string
  readonly publish: string
  readonly catchUp: boolean
}

export const DEFAULT_LINE: LineConfig = {
  onto: "pinetrie-onto",
  wipPrefix: "wip/",
  publish: "main",
  catchUp: false,
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

/**
 * The line's config from the user's and the project's: the project's value
 * wins, since the bookmark belongs to the repo. A name that is not a bookmark,
 * or a `catchUp` that is not a boolean, falls back to the default, with why.
 * The WIP prefix is checked as the start of a name (`<prefix>x`).
 */
export function lineConfig(
  user: LaneConfig["offers"],
  project: LaneConfig["offers"],
): { readonly line: LineConfig; readonly refused: readonly string[] } {
  const refused: string[] = []
  const pick = (
    key: "onto" | "wipPrefix" | "publish",
    valid: (v: string) => boolean,
  ): string => {
    const value = project[key] ?? user[key]
    if (value === null) return DEFAULT_LINE[key]
    if (valid(value)) return value
    refused.push(
      `offers.${key} "${value}" is not a bookmark name; using "${DEFAULT_LINE[key]}"`,
    )
    return DEFAULT_LINE[key]
  }
  const flag = project.catchUp ?? user.catchUp
  let catchUp = DEFAULT_LINE.catchUp
  if (typeof flag === "boolean") catchUp = flag
  else if (flag !== null)
    refused.push(
      `offers.catchUp ${flag.invalid} is not true or false; using ${DEFAULT_LINE.catchUp}`,
    )
  return {
    line: {
      onto: pick("onto", isBookmarkName),
      wipPrefix: pick("wipPrefix", v => isBookmarkName(`${v}x`)),
      publish: pick("publish", isBookmarkName),
      catchUp,
    },
    refused,
  }
}

/** Where a shared directory may never be: repos, pinetrie's own, dependencies. */
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
 * `EXCLUDE_LINE` keeps out of the project's repo (ADR-0086).
 */
export function pinetrieDir(root: string): {
  readonly dir: string
  /** The session's SQLite file, unless `PINETRIE_STORE` names another. */
  readonly store: string
  /** Snapshots of lanes' disks (`DiskPaths.snapshots`). */
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
 * Kyneta resolve this way (S39 item 5).
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
 * your repo holds (S42 item 4). A parent's fork point is an ancestor of its
 * child's, so nothing needs reading from the lane first.
 *
 * Scoped to `repo` because `JJ_CONFIG` reaches every jj command in the lane,
 * and jj rejects the whole config in a repo that lacks the commit (S50).
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

/** One command, as data. `lane` runs through the lane's runner, `host` on the host. */
export type LaneStep =
  | {
      readonly in: "lane"
      readonly argv: readonly string[]
      /** A host file the command's stdout is written to, as bytes. */
      readonly stdoutTo?: string
    }
  | { readonly in: "host"; readonly argv: readonly string[] }

const inLane = (...argv: string[]): LaneStep => ({ in: "lane", argv })
const onHost = (...argv: string[]): LaneStep => ({ in: "host", argv })
const laneShell = (script: string): LaneStep => inLane("sh", "-c", script)

/**
 * Fetch `commits` from `from` (your working copy, at `/mnt/host-working-copy`) when the disk
 * lacks any of them. The fetch puts each on a branch, which is what makes jj
 * see it (S44 item 7), and jj imports it at once: a jj command with
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

/** Where a lane's disk and a snapshot's file are on the host. */
export interface DiskPaths {
  /** `container`'s volumes directory. */
  readonly volumes: string
  /** The project's `.pinetrie/snapshots/`. */
  readonly snapshots: string
}

export const volumeImage = (paths: DiskPaths, volume: string): string =>
  path.join(paths.volumes, volume, "volume.img")
export const snapshotFile = (paths: DiskPaths, id: SnapshotId): string =>
  path.join(paths.snapshots, `${id}.img`)

/**
 * A journaled volume: mid-write clones of one without a journal are corrupt
 * (S41), and `container`'s default has none.
 */
export const createVolume = (volume: string, size = DISK_SIZE): LaneStep =>
  onHost(
    "container",
    "volume",
    "create",
    "--opt",
    "journal=ordered",
    "--opt",
    `size=${size}`,
    volume,
  )

/**
 * A copy-on-write clone to a temporary name, renamed into place, so the file
 * at `to` is never half-written. `/bin/cp -c` is macOS's clonefile; GNU `cp`
 * has no `-c` (S36).
 */
const cloneFile = (from: string, to: string): LaneStep[] => [
  onHost("/bin/cp", "-c", from, `${to}.tmp`),
  onHost("/bin/mv", "-f", `${to}.tmp`, to),
]

/**
 * A volume made from a disk image: created, then its image replaced by a
 * clone of `source`, a snapshot's file or another volume's image.
 */
export const restoreVolume = (
  paths: DiskPaths,
  source: string,
  volume: string,
): LaneStep[] => [
  createVolume(volume),
  ...cloneFile(source, volumeImage(paths, volume)),
]

/**
 * The lane steps that start a lane on the line: an empty commit on the line's
 * commit naming it, left as `@-`. Its trailer says the thread is on the line.
 */
export const planLineStart = (onto: string, commit: CommitId): LaneStep[] => [
  fetchById([commit]),
  inLane("jj", "new", commit),
  inLane(
    "jj",
    "commit",
    "-m",
    baseMessage(`base: ${onto}`, { bookmark: onto, commit }),
  ),
]

/**
 * The lane steps that make a copy of a WIP (ADR-0060): a commit on `on`
 * with the WIP's files and a change id of its own, left as `@-`. Never the
 * WIP's own commits: the lane's tip, immutable in your repo, would make them
 * immutable (S48 item 11). Fetches nothing: the lane must hold both commits.
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
      bookmark: wip.bookmark,
      commit: wip.commit,
    }),
  ),
]

/** What an update runs in a lane before its merge, and what it merges (`mergeUpdate`). */
export interface MergePlan {
  /**
   * A fetch of the line's commit; or a fetch of the WIP's commit and its copy
   * on the lane's previous copy, left as `@-`.
   */
  readonly steps: readonly LaneStep[]
  /** The commit to merge, or the copy the steps leave as `@-`. */
  readonly source: CommitId | "copy"
  /** The line's names the base (`Pinetrie-Base`); a WIP's copy names its own; a parent's none (ADR-0072). */
  readonly message: string
  /** With nothing to merge, a commit still names the line (`BaseMerge`). */
  readonly mark: boolean
  /**
   * The commits whose titles the update lists, `<from>..<to>` without the
   * accepted-offer commits it joined (`mergeUpdate`); `from` null is the lane before the merge.
   */
  readonly came: { readonly from: CommitId | null; readonly to: CommitId }
}

/**
 * An update's steps (ADR-0060). A WIP's copy fetches only the WIP's commit:
 * the copy's parent is the lane's own. The thread it branched from is merged
 * as the line's commit is, with no `Pinetrie-Base`: it is no base, and what
 * the lane holds of it is its history (ADR-0072).
 */
export function planMerge(from: BaseMerge): MergePlan {
  if (from.kind === "line")
    return {
      steps: [fetchById([from.commit])],
      source: from.commit,
      message: baseMessage(`update: ${from.onto}`, {
        bookmark: from.onto,
        commit: from.commit,
      }),
      mark: from.mark,
      came: { from: null, to: from.commit },
    }
  if (from.kind === "parent")
    return {
      steps: [fetchById([from.commit])],
      source: from.commit,
      message: `update: ${from.name}`,
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

/** An accepted-offer commit on the line the lane lacks, and the sources its message names (`sourcesOf`). */
export interface AcceptedOfferCommitAbove {
  readonly acceptedOfferCommit: CommitId
  readonly sources: readonly CommitId[]
}

/** An accepted-offer commit to join to the sources the lane holds, before an update's merge (S102). */
export interface Join {
  readonly acceptedOfferCommit: CommitId
  /** Of its sources, those in the lane's history: a squash may name others (S77 item 6). */
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
 * merges (S102, ADR-0079), oldest first as they come: each that names a
 * source the lane holds. An accepted-offer commit is a copy of the lane's
 * work on the line, and the join says so in history, so the merge does not
 * bring that work in twice. One naming a source the lane lacks too, a
 * squash's, is joined all the same: the rest of it is the line's. Each join
 * is made on the one before, so a later one's base holds the earlier ones.
 * Pure.
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
 * other jj command runs there (S42 item 2), the lane's bookmark at its base, and
 * inherited history made immutable. Without it, the fork's first turn reuses
 * its parent's change id, and your repo sees a divergent change. A base with
 * several parents is committed once, empty, so the bookmark names one commit.
 * A lane starting on the line or a WIP's copy is based on the commit that
 * names it (ADR-0060), installing dependencies when a WIP's lockfile differs
 * from the base disk's, which is the line's (`install`).
 */
export function planForkSetup(
  lane: LaneName,
  start: ForkStart,
  install: string | null = null,
): LaneStep[] {
  const base: LaneStep[] =
    start.kind === "line"
      ? planLineStart(start.onto, start.commit)
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
    ...(install === null ? [] : [laneShell(install)]),
  ]
}

/** Start a lane's container on its existing volume. */
export const planStart = (
  spec: LaneSpec,
  env: Readonly<Record<string, string | undefined>>,
): LaneStep => onHost("container", ...planRun(spec, env))

/**
 * A lane's disk, then its container: a new volume, or one cloned from
 * snapshot `from`.
 */
export const planDisk = (input: {
  readonly paths: DiskPaths
  readonly spec: LaneSpec
  readonly env: Readonly<Record<string, string | undefined>>
  readonly from: SnapshotId | null
}): LaneStep[] => [
  ...(input.from === null
    ? [createVolume(input.spec.volume)]
    : restoreVolume(
        input.paths,
        snapshotFile(input.paths, input.from),
        input.spec.volume,
      )),
  planStart(input.spec, input.env),
]

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
 * the rename the names the host reads now. Pure; empty when nothing is old.
 * The config folder moves first, so the jj steps after it run under the
 * lane's own config: jj ignores a `JJ_CONFIG` naming no file. Bookmarks of
 * other lanes, a fork's inherited ones, are never read and are left alone.
 */
export function planOldNamesOnDisk(
  facts: OldNamesOnDisk,
  lane: LaneName,
): LaneStep[] {
  const { configDir, bookmarks } = facts
  const has = new Set(bookmarks)
  // `-R`, so the steps need no working directory: the migration runs them
  // through `container exec`.
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
  readonly paths: DiskPaths
  readonly spec: LaneSpec
  readonly env: Readonly<Record<string, string | undefined>>
  /** The install to run when your `@`'s lockfile differs from the base's. */
  readonly install?: string | null
}): LaneStep[] => [
  ...planDisk({ ...input, from: input.point.snapshot }),
  ...planForkSetup(input.spec.lane, input.point.start, input.install ?? null),
]

/**
 * A git bundle of `bookmark` in the lane, written to the host file `to`,
 * excluding what your repo already has: a bundle naming only the bookmark
 * carries the whole history, 1.1 MB against 8 KB for one commit on pinetrie's
 * repo (S43 item 8). Your repo imports it with `@pinetrie/repo`'s `planImport`.
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
 * turn, and is the turn's revision (S56): otherwise the offer would lack it,
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
 * it, unflushed files clone empty, S41), then the clone.
 */
export const planSnapshot = (input: {
  readonly volume: string
  readonly snapshot: SnapshotId
  readonly paths: DiskPaths
}): LaneStep[] => [
  inLane("sync"),
  ...cloneFile(
    volumeImage(input.paths, input.volume),
    snapshotFile(input.paths, input.snapshot),
  ),
]

/** What the base snapshot was made from, kept beside it. */
export interface BaseFacts {
  readonly commits: readonly CommitId[]
  /** The lockfile's hash when it installed; null with no install. */
  readonly lock: string | null
}

/**
 * Making or refreshing the base snapshot, run in a scratch lane. A new base
 * is `git init` and `jj git init --colocate`, not `jj git clone`: a fresh
 * volume holds `lost+found`, which `jj git clone` refuses (S44 item 6). It then
 * takes the line's commit (`yours`) by id and installs. A refresh fetches and
 * moves only when that commit moved, and installs only when the lockfile
 * changed.
 *
 * When the commit was rewritten rather than built on (a line moved with
 * `--ignore-immutable`, or your `@-` before ADR-0060), the fetched ref moves
 * sideways: the import abandons the commit it named, and rebases the base's
 * working-copy commit, a child of it, with `--ignore-working-copy`. The
 * working copy is then stale, and `jj new` refuses until `jj workspace
 * update-stale`, which does nothing when it is not (S74).
 */
export function planBaseRefresh(input: {
  readonly base: BaseFacts | null
  readonly yours: readonly CommitId[]
  readonly lock: string | null
  readonly install: Install | null
}): readonly LaneStep[] {
  const { base, yours, install } = input
  const init =
    base === null
      ? [inLane("git", "init", "-q"), inLane("jj", "git", "init", "--colocate")]
      : []
  const moved =
    base === null ||
    base.commits.length !== yours.length ||
    base.commits.some((c, i) => c !== yours[i])
  const installs =
    install !== null && (base === null || base.lock !== input.lock)
  return [
    ...init,
    ...(moved
      ? [
          fetchById(yours),
          inLane("jj", "workspace", "update-stale"),
          inLane("jj", "new", ...yours),
        ]
      : []),
    ...(installs ? [laneShell(install.command)] : []),
  ]
}

/** What the host finds about `container` and the disk it clones on. */
export interface HostFacts {
  /** The project's root, or why it has none. */
  readonly root:
    | { readonly ok: string }
    | { readonly direct: string; readonly reason: string }
  readonly installed: boolean
  readonly running: boolean
  readonly kernel: boolean
  /** A clone of a small file into `.pinetrie/snapshots/` shared its blocks. */
  readonly clones: boolean
}

/** Whether lanes can have their own containers here; else the first reason not. */
export function planHost(f: HostFacts): ProjectRecord {
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
  /** A jj repo with no git directory beside it to exclude `.pinetrie/` in (S108). */
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
 * Where lanes work, from what `planProjectDir` found in `dir`. A folder
 * refused works directly where it is, or at its root when only the exclude
 * failed. With no jj repo, lanes work directly: a lane's commits need jj on
 * both sides.
 */
export function planRoot(d: ProjectDir, dir: string): HostFacts["root"] {
  if (d.kind === "refused")
    return {
      direct: d.refusal.kind === "unexcludable" ? d.refusal.root : dir,
      reason: projectDirWords(d.refusal),
    }
  if (d.repo !== "jj")
    return {
      direct: d.root,
      reason: `${d.root} has no jj repo: \`jj git init --colocate\` gives its lanes their own copies`,
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
 * Where a lane's container, made anew, starts from: its volume if it has one;
 * else its newest snapshot (a restored root); else nothing, and the lane
 * predates lane containers.
 */
export function planStartFrom(input: {
  readonly volume: boolean
  readonly newest: SnapshotId | null
}):
  | { readonly kind: "volume" }
  | { readonly kind: "snapshot"; readonly from: SnapshotId }
  | { readonly kind: "retired" } {
  if (input.volume) return { kind: "volume" }
  return input.newest === null
    ? { kind: "retired" }
    : { kind: "snapshot", from: input.newest }
}

/** The oldest git a lane's image may have: jj's fetch needs 2.41 (S42 item 7). */
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

/** A Containerfile as read: its path and its text. */
export interface Containerfile {
  readonly file: string
  readonly content: string
}

/**
 * The images a project's lanes need (ADR-0034, ADR-0041). pinetrie's is built
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
    .digest("hex")
    .slice(0, 12)
  return { file: containerfile.file, tag: `pinetrie-lane:${hash}`, buildArgs }
}
