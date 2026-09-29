// lanes/plan — every decision about a lane's container and disk, as values
// (ADR-0034).
//
// Each function here is pure. What runs is a list of `LaneStep`s, carried out
// by `execute.ts`; what is gathered is gathered by `host.ts`, `disk.ts` and
// the host. So each rule below is tested without `container`, jj or git.

import { createHash } from "node:crypto"
import path from "node:path"
import {
  type CommitId,
  HOST_WORKING_COPY,
  type LaneName,
  NO_EDITOR,
  type ProjectRecord,
  type SnapshotId,
  WORKSPACE_ROOT,
} from "@pineta/core"

/** Pineta's own install, read-only: the helper's code and pi's. */
export const PINETA_MOUNT = "/pineta"
/** Pineta's lane runtime, read-only: Node and its libraries, and jj (S44). */
export const RUNTIME_MOUNT = "/pineta-runtime"
/** The lane's own jj config, on its disk so that forks inherit it (S42 item 4). */
export const LANE_CONFIG_DIR = `${WORKSPACE_ROOT}/.pineta-lane`
export const LANE_JJ_CONFIG = `${LANE_CONFIG_DIR}/jj.toml`
/** The branch a commit fetched by id is put on, so jj sees it (S44 item 7). */
export const FETCHED_REF = "refs/heads/pineta/fetched"
/** A new volume's size. The image is sparse: only written blocks take space. */
const DISK_SIZE = "64G"

/** The bookmark that holds a lane's newest revision, in its repo and in yours. */
export const bookmarkName = (lane: LaneName): string => `pineta/${lane}`

/** The container and the volume of a lane share one name. */
export const laneContainer = (lane: LaneName): string => `pineta-${lane}`

/** What a project lets cross a lane's boundary (ADR-0034), from `pineta.json`. */
export interface LaneGrants {
  readonly ssh: boolean
  /** Environment variable names passed from the host. */
  readonly env: readonly string[]
  /** Further read-only mounts. */
  readonly mounts: readonly Mount[]
}

export interface Mount {
  readonly source: string
  readonly target: string
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
  /** Your working copy's root, mounted read-only at `/mnt/host-working-copy`. */
  readonly hostWorkingCopy: string
  /** Pineta's own install, read-only at `/pineta`, for the helper. */
  readonly pineta: string
  /** Pineta's lane runtime, read-only at `/pineta-runtime`. */
  readonly runtime: string
  readonly links: readonly Mount[]
  readonly grants: LaneGrants
  readonly identity: { readonly name: string; readonly email: string }
  readonly memory: string
  /** Directories of your working copy, mounted read-write (ADR-0035). */
  readonly shared: readonly SharedDir[]
  /** The host directory holding the lane's ignore file, mounted read-only. */
  readonly ignoreDir: string
}

/** A directory of your working copy, shared read-write into every lane (ADR-0035). */
export interface SharedDir {
  /** Relative to the project's root, normalized, e.g. ".plans". */
  readonly path: string
  /** Its absolute path on the host. */
  readonly source: string
}

/** Where every lane sees its ignore file's directory. */
export const IGNORE_MOUNT = "/pineta-git"
/** The ignore file's name, in `ignoreDir` on the host and `IGNORE_MOUNT` in a lane. */
export const IGNORE_FILE = "ignore"
/** The label a container's spec hash is kept under. */
export const SPEC_LABEL = "pineta.spec"

const readonlyMount = (m: Mount): string[] => [
  "--mount",
  `type=bind,source=${m.source},target=${m.target},readonly`,
]
const writableMount = (m: Mount): string[] => [
  "--mount",
  `type=bind,source=${m.source},target=${m.target}`,
]
const setEnv = (name: string, value: string): string[] => [
  "-e",
  `${name}=${value}`,
]

/**
 * `container run` arguments for a lane, labelled with their own hash
 * (`specHash`), so a container made from another spec can be told apart.
 *
 * Your home directory is never mounted, so credentials stay out of reach
 * unless a grant names them (S43 item 7). `--init` reaps the processes a
 * timeout or an abort kills (S39 item 6). Only variables a grant names are
 * copied from `env`. Your working copy and Pineta's own directories are
 * read-only; shared directories are read-write (ADR-0035).
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
    ...readonlyMount({
      source: spec.hostWorkingCopy,
      target: HOST_WORKING_COPY,
    }),
    ...readonlyMount({ source: spec.pineta, target: PINETA_MOUNT }),
    ...readonlyMount({ source: spec.runtime, target: RUNTIME_MOUNT }),
    ...readonlyMount({ source: spec.ignoreDir, target: IGNORE_MOUNT }),
    ...spec.links.flatMap(readonlyMount),
    ...spec.grants.mounts.flatMap(readonlyMount),
    ...spec.shared.flatMap(d =>
      writableMount({
        source: d.source,
        target: path.posix.join(WORKSPACE_ROOT, d.path),
      }),
    ),
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
    // Last, so the image's own programs win: the runtime brings jj for an
    // image that has none, and never Node.
    ...setEnv("PATH", `${spec.imagePath}:${RUNTIME_MOUNT}/bin`),
    "-w",
    WORKSPACE_ROOT,
    spec.image,
    "sleep",
    "infinity",
  ]
}

/**
 * The lane's ignore file: what no repo in a lane may track. Pineta's own
 * config, the file system's own directory, and each shared directory.
 */
export const laneIgnores = (shared: readonly string[]): string =>
  ["/.pineta-lane/", "/lost+found/", ...shared.map(p => `/${p}/`)]
    .map(l => `${l}\n`)
    .join("")

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []

/** A `lanes` key: the project's `pineta.json`, or the user's config. */
export interface LaneConfig {
  readonly grants: LaneGrants
  /** How the base snapshot installs; null with nothing to install. */
  readonly install: Install | null
  /** Relative paths, as written; `planShared` decides which apply. */
  readonly shared: readonly string[]
}

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
  const pnpm: Install | null = pnpmLock
    ? { command: "pnpm install --frozen-lockfile", lockfile: "pnpm-lock.yaml" }
    : null
  if (!isRecord(lanes)) return { grants: NO_GRANTS, install: pnpm, shared: [] }
  const mounts = Array.isArray(lanes.mounts)
    ? lanes.mounts.flatMap(m =>
        isRecord(m) &&
        typeof m.source === "string" &&
        typeof m.target === "string" &&
        m.source !== "" &&
        path.posix.isAbsolute(m.target)
          ? [{ source: path.resolve(root, m.source), target: m.target }]
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
  }
}

/** Where a shared directory may never be: repos, Pineta's own, dependencies. */
const NEVER_SHARED = [".git", ".jj", ".pineta", "node_modules"]

/**
 * Which shared directories apply, and what to do for them on the host. The
 * user's entries come first, then the project's, normalized and without
 * duplicates. Refused: absolute paths, paths that leave the project, those
 * in `.git`, `.jj`, `.pineta` or `node_modules`, and those holding files jj
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

/** Where the host keeps a project's lane ignore file (`laneIgnores`). */
export const laneIgnoreDir = (root: string): string =>
  path.join(root, ".pineta", "lane-git")

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
 * through the `node_modules` of its repo. Pineta's `link:` dependencies on
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
  return [...found.keys()]
    .sort()
    .map(source => ({ source, target: found.get(source) ?? source }))
}

export const PINETA_HEADS = 'bookmarks(glob:"pineta/*")'

/**
 * Your repo's `immutable_heads()` with `heads` added, keeping whatever it
 * already was; null when they are already there.
 */
export function extendImmutable(current: string, heads: string): string | null {
  const now = current.trim()
  if (now.includes(heads)) return null
  return now === "" ? heads : `(${now}) | ${heads}`
}

/**
 * A fork's whole jj config: everything at or above its fork point is
 * immutable, so the lane cannot rewrite a commit its parent or your repo
 * holds (S42 item 4). A parent's fork point is an ancestor of its child's, so
 * nothing needs reading from the lane first.
 */
export const forkConfig = (commits: readonly CommitId[]): string =>
  `[revset-aliases]\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\n`

/** One command, as data. `lane` runs through the lane's runner, `host` on the host. */
export type LaneStep =
  | {
      readonly in: "lane"
      readonly argv: readonly string[]
      /** A host file the command's stdout is written to, as bytes. */
      readonly stdoutTo?: string
    }
  | { readonly in: "host"; readonly argv: readonly string[] }

/** `s` as one POSIX shell word. */
export const shellWord = (s: string): string =>
  /^[A-Za-z0-9_./:=@+-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`

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
  /** The project's `.pineta/snapshots/`. */
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

/** A volume made from a snapshot: created, then its image replaced by a clone. */
const restoreVolume = (
  paths: DiskPaths,
  id: SnapshotId,
  volume: string,
): LaneStep[] => [
  createVolume(volume),
  ...cloneFile(snapshotFile(paths, id), volumeImage(paths, volume)),
]

/**
 * The lane steps that make a disk a fork at `commits`: a change of its own on
 * them, before anything else runs there (S42 item 2), the lane's bookmark at
 * its base, and inherited history made immutable. Without `jj new`, the fork's
 * first turn reuses its parent's change id, and your repo sees a divergent
 * change. A base with several parents (your `@` is a merge) is committed once,
 * empty, so the bookmark names one commit.
 */
export function planForkSetup(
  lane: LaneName,
  commits: readonly CommitId[],
): LaneStep[] {
  return [
    fetchById(commits),
    inLane("jj", "new", ...commits),
    ...(commits.length > 1
      ? [inLane("jj", "commit", "-m", `base: ${lane}`)]
      : []),
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
      `mkdir -p ${LANE_CONFIG_DIR} && printf '%s' ${shellWord(forkConfig(commits))} > ${LANE_JJ_CONFIG}`,
    ),
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
    : restoreVolume(input.paths, input.from, input.spec.volume)),
  planStart(input.spec, input.env),
]

/** A fork: its disk cloned from the fork point's snapshot, then `planForkSetup`. */
export const planFork = (input: {
  readonly point: {
    readonly snapshot: SnapshotId
    readonly commits: readonly CommitId[]
  }
  readonly paths: DiskPaths
  readonly spec: LaneSpec
  readonly env: Readonly<Record<string, string | undefined>>
}): LaneStep[] => [
  ...planDisk({ ...input, from: input.point.snapshot }),
  ...planForkSetup(input.spec.lane, input.point.commits),
]

/**
 * A git bundle of the lane's bookmark, excluding what your repo already has:
 * a bundle naming only the bookmark carries the whole history, 1.1 MB against
 * 8 KB for one commit on Pineta's repo (S43 item 8).
 */
export const planBundle = (
  lane: LaneName,
  have: readonly CommitId[],
): readonly string[] => [
  "git",
  "bundle",
  "create",
  "-",
  `refs/heads/${bookmarkName(lane)}`,
  ...have.map(c => `^${c}`),
]

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

/**
 * The lane's bookmark into your repo: the lane's bundle to a host file, your
 * repo fetching the bookmark from it, and jj importing it.
 */
export function planFetch(input: {
  readonly lane: LaneName
  /** What your repo has of the lane: its previous commit, else its fork point. */
  readonly have: readonly CommitId[]
  /** Your working copy's root. */
  readonly root: string
  /** A host file for the bundle. */
  readonly bundle: string
}): LaneStep[] {
  const ref = `refs/heads/${bookmarkName(input.lane)}`
  return [
    {
      in: "lane",
      argv: planBundle(input.lane, input.have),
      stdoutTo: input.bundle,
    },
    onHost(
      "git",
      "-C",
      input.root,
      "fetch",
      "-q",
      input.bundle,
      `+${ref}:${ref}`,
    ),
    // A jj command with `--ignore-working-copy` imports no git refs, so
    // import at once. With the flag, the import leaves your working copy
    // unsnapshotted: 12-47 ms, where a plain `jj git import` snapshots it
    // too (about 100 ms, S44 item 8).
    onHost("jj", "-R", input.root, "--ignore-working-copy", "git", "import"),
    onHost("rm", "-f", input.bundle),
  ]
}

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
 * takes your `@-` by id and installs. A refresh fetches and moves only when
 * your `@-` moved, and installs only when the lockfile changed.
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
    ...(moved ? [fetchById(yours), inLane("jj", "new", ...yours)] : []),
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
  /** A clone of a small file into `.pineta/snapshots/` shared its blocks. */
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
          ? `${root}/.pineta/snapshots cannot clone copy-on-write: it must be on the same APFS volume as \`container\`'s data`
          : null
  return reason === null
    ? { kind: "lanes", root, rootDefault: "own" }
    : { kind: "direct", root, reason }
}

/** What jj and git say about where the host runs. */
export interface RootFacts {
  readonly dir: string
  /** The jj workspace root jj names from `dir`, or null. */
  readonly jjRoot: string | null
  /** git's top level from `dir`, asked only when jj names nothing. */
  readonly gitTop: string | null
  readonly home: string
}

/**
 * The project's root: jj's, else git's. Never your home directory or `/`: a
 * home directory that is a dotfiles repo is what git names for any project
 * below it with no repo of its own. With no jj repo, lanes work directly: a
 * lane's commits need jj on both sides.
 */
export function planRoot(f: RootFacts): HostFacts["root"] {
  const target = f.jjRoot ?? f.gitTop ?? f.dir
  const unsafe =
    path.resolve(target) === path.resolve(f.home) ||
    path.resolve(target) === path.parse(target).root
  if (unsafe)
    return {
      direct: f.dir,
      reason: `${target} is your home directory or the file system's root`,
    }
  if (f.jjRoot === null)
    return {
      direct: target,
      reason: `${target} has no jj repo: \`jj git init --colocate\` gives its lanes their own copies`,
    }
  return { ok: f.jjRoot }
}

/**
 * Your repo's exclude file with each of `lines` in it, appended in order, or
 * null when they are all there already. `/.pineta/` holds snapshots and the
 * runtime; shared directories are added as `/<path>/`.
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
