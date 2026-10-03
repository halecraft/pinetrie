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
  type CommitId,
  commitId,
  type ForkStart,
  HOST_OPERATOR,
  HOST_WORKING_COPY,
  hostPathInLane,
  isLaneName,
  type LaneBase,
  type LaneName,
  NO_EDITOR,
  type ProjectRecord,
  type SnapshotId,
  shellWord,
  type ThreadName,
  TRAILERS,
  WORKSPACE_ROOT,
} from "@pineta/core"

/** Pineta's own install, read-only: the helper's code and pi's. */
export const PINETA_MOUNT = "/pineta"
/**
 * Pineta's lane runtime, read-only: Node and its libraries (S44), and in
 * `bin/` the static programs core's `RUNTIME_PROGRAMS` lists.
 */
export const RUNTIME_MOUNT = "/pineta-runtime"
/** The runtime's programs, as a lane sees them: on its `PATH`, last. */
export const RUNTIME_BIN = `${RUNTIME_MOUNT}/bin`
/** The lane's own jj config, on its disk so that forks inherit it (S42 item 4). */
export const LANE_CONFIG_DIR = `${WORKSPACE_ROOT}/.pineta-lane`
export const LANE_JJ_CONFIG = `${LANE_CONFIG_DIR}/jj.toml`
/** The branch a commit fetched by id is put on, so jj sees it (S44 item 7). */
export const FETCHED_REF = "refs/heads/pineta/fetched"
/** A new volume's size. The image is sparse: only written blocks take space. */
const DISK_SIZE = "64G"

/** The bookmark that holds a lane's newest revision, in the lane's own repo. */
export const bookmarkName = (lane: LaneName): string => `pineta/${lane}`

/** The revset of one bookmark, its name quoted so it is never parsed as a revset. */
export const bookmarkRevset = (name: string): string =>
  `bookmarks(exact:${revsetName(name)})`

/**
 * A lane's history in your repo: a remote bookmark, `tip@pineta-<lane>`,
 * which jj keeps out of your default log and immutable with its builtin
 * config, ancestors included (S48 items 11 and 19). No git remote is added.
 */
const laneRemote = (lane: LaneName): string => `pineta-${lane}`
const laneTipRef = (lane: LaneName): string =>
  `refs/remotes/${laneRemote(lane)}/tip`
export const laneTipName = (lane: LaneName): string => `tip@${laneRemote(lane)}`

/**
 * A split's stack (ADR-0038): the bookmark its run leaves in the lane's own
 * repo, and the remote bookmark it arrives as in yours.
 */
export const stackBookmark = (lane: LaneName): string => `pineta/${lane}-stack`
const laneStackRef = (lane: LaneName): string =>
  `refs/remotes/${laneRemote(lane)}/stack`
export const laneStackName = (lane: LaneName): string =>
  `stack@${laneRemote(lane)}`

/** A lane's offer in your repo (ADR-0038). Not `pineta/…`: see `PINETA_HEADS`. */
export const offerBookmark = (name: ThreadName): string =>
  `pineta-offer/${name}`

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
 * - Pineta's own install at `/pineta` and its runtime at `/pineta-runtime`,
 *   and the directory of the lane's ignore file at `/pineta-git`, read-only;
 * - links' and grants' mounts, read-only where they say;
 * - shared directories, read-write at their place in `/workspace` (ADR-0035);
 * - granted host paths, read-only at `/mnt/host` and their path (ADR-0036).
 */
export function planMounts(parts: {
  readonly hostWorkingCopy: string
  readonly pineta: string
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
    at(parts.pineta, PINETA_MOUNT),
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
  const contains = (outer: string, inner: string) =>
    inner === outer ||
    inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`)
  const refused: { path: string; reason: string }[] = []
  const allowed: string[] = []
  for (const root of new Set(input.roots.map(r => path.resolve(r)))) {
    const reason =
      root === "/"
        ? "it is the file system's root"
        : contains(root, input.home)
          ? "it is, or holds, your home directory"
          : contains(root, input.agentDir)
            ? "it is, or holds, pi's agent directory"
            : root.includes(",") && root.includes(":")
              ? "it has both a comma and a colon, which container cannot mount"
              : null
    if (reason === null) allowed.push(root)
    else refused.push({ path: root, reason })
  }
  const mounts = allowed
    .filter(r => !allowed.some(o => o !== r && contains(o, r)))
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
export const IGNORE_MOUNT = "/pineta-git"
/** The ignore file's name, in `ignoreDir` on the host and `IGNORE_MOUNT` in a lane. */
export const IGNORE_FILE = "ignore"
/** The label a container's spec hash is kept under. */
export const SPEC_LABEL = "pineta.spec"

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
  /** The `offers` key's names, as written; null where absent (`lineConfig`). */
  readonly offers: {
    readonly onto: string | null
    readonly wipPrefix: string | null
  }
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
  const offersKey = isRecord(json) ? json.offers : undefined
  const named = (v: unknown) => (typeof v === "string" ? v : null)
  const offers = isRecord(offersKey)
    ? { onto: named(offersKey.onto), wipPrefix: named(offersKey.wipPrefix) }
    : { onto: null, wipPrefix: null }
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

/** The integration line's bookmark and the WIP bookmarks' prefix (ADR-0060). */
export interface LineConfig {
  readonly onto: string
  readonly wipPrefix: string
}

export const DEFAULT_LINE: LineConfig = {
  onto: "pineta-onto",
  wipPrefix: "wip/",
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
 * The line's names from the user's config and the project's: the project's
 * value wins, since the bookmark belongs to the repo. A name that is not a
 * bookmark falls back to the default, with why. The WIP prefix is checked as
 * the start of a name (`<prefix>x`).
 */
export function lineConfig(
  user: LaneConfig["offers"],
  project: LaneConfig["offers"],
): { readonly line: LineConfig; readonly refused: readonly string[] } {
  const refused: string[] = []
  const pick = (
    key: keyof LaneConfig["offers"],
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
  return {
    line: {
      onto: pick("onto", isBookmarkName),
      wipPrefix: pick("wipPrefix", v => isBookmarkName(`${v}x`)),
    },
    refused,
  }
}

/**
 * Your repo's `immutable_heads()` with the line and the offers on it added
 * (ADR-0060): `current` is the definition the repo has, null for jj's
 * builtin. `present()`, or a repo with no line fails every jj command
 * (S77). An offer is immutable only while its parent is the line, so nothing
 * of yours above the line is frozen. Given its own output, it returns it.
 */
export function immutableHeads(
  line: LineConfig,
  current: string | null,
): string {
  const onto = `present(${revsetName(line.onto)})`
  const added = `${onto} | (bookmarks(glob:${revsetName("pineta-offer/*")}) & children(${onto}))`
  const base = (current ?? "builtin_immutable_heads()").trim()
  return base.endsWith(added) ? base : `${base} | ${added}`
}

/**
 * Your repo's `revsets.log` with the offers added (ADR-0060): `current` is
 * the definition the repo has, null for jj's default. An offer on the line is
 * an immutable head, which `builtin_log()` leaves out, so jj and jjui would
 * not show it (S77 item 8). Given its own output, it returns it.
 */
export function logRevset(current: string | null): string {
  const added = `bookmarks(glob:${revsetName("pineta-offer/*")})`
  const base = (current ?? "builtin_log()").trim()
  return base.endsWith(added) ? base : `${base} | ${added}`
}

/**
 * Set up the integration line (ADR-0060): its bookmark at your `@-`, as the
 * host, then your repo's `immutable_heads()` (`immutableHeads`), written in
 * the repo's own config. Run only on your command, after you saw `heads`.
 */
export const planLineSetup = (input: {
  readonly root: string
  readonly onto: string
  readonly heads: string
  readonly log: string
}): LaneStep[] => [
  hostOp(input.root, "bookmark", "create", input.onto, "-r", "@-"),
  onHost(
    "jj",
    "-R",
    input.root,
    "config",
    "set",
    "--repo",
    'revset-aliases."immutable_heads()"',
    input.heads,
  ),
  onHost(
    "jj",
    "-R",
    input.root,
    "config",
    "set",
    "--repo",
    "revsets.log",
    input.log,
  ),
]

/**
 * Land your work (ADR-0060): the line moved to your `@-`, as you, since it is
 * your act. Without `--allow-backwards`, jj refuses a move that is not
 * forward (S77 item 1).
 */
export const planLand = (input: {
  readonly root: string
  readonly onto: string
}): LaneStep[] => [
  onHost("jj", "-R", input.root, "bookmark", "move", input.onto, "--to", "@-"),
]

/**
 * Update your files from the line (ADR-0061): your work above it rebased onto
 * it, as you, since it changes your files; jj snapshots them first. `-b @`
 * moves every head on your work with `@` (S80 item 1); `-r` would strip
 * them of the commits under them. A conflict is recorded, not refused.
 */
export const planFollow = (input: {
  readonly root: string
  readonly onto: string
}): LaneStep[] => [
  onHost(
    "jj",
    "-R",
    input.root,
    "rebase",
    "-b",
    "@",
    "-d",
    revsetName(input.onto),
  ),
]

/** A revset string literal, so a bookmark name is never parsed as a revset. */
export const revsetName = (name: string): string => JSON.stringify(name)

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
  return [...found.keys()].sort().map(source => ({
    source,
    target: found.get(source) ?? source,
    readonly: true,
  }))
}

/**
 * What Pineta added to your repo's `immutable_heads()` before ADR-0038, to
 * keep lane bookmarks immutable. Remote bookmarks need no line, and a
 * bookmark under `pineta/` is immutable while it is there, so offers are
 * named outside it (S48 item 14).
 */
export const PINETA_HEADS = 'bookmarks(glob:"pineta/*")'

/**
 * Your repo's `immutable_heads()` without Pineta's line, keeping anything
 * else in it: null when the line is not there, "" when only jj's builtin
 * would remain, so the setting is unset (S48 item 21).
 */
export function withoutPinetaHeads(current: string): string | null {
  const now = current.trim()
  if (!now.includes(PINETA_HEADS)) return null
  const rest = now
    .split("|")
    .map(p => p.trim())
    .filter(p => p !== PINETA_HEADS && p !== "")
    .map(p => p.replace(/^\((.*)\)$/, "$1").trim())
    .join(" | ")
  return rest === "" || rest === "builtin_immutable_heads()" ? "" : rest
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
 * A commit's message that names a lane's base (ADR-0060): the line or a WIP
 * bookmark, and the commit it pointed at. The newest such commit in a lane's
 * history is the thread's base (`laneBase`).
 */
export const baseMessage = (
  title: string,
  base: { readonly bookmark: string; readonly commit: CommitId },
): string => `${title}\n\n${TRAILERS.base}: ${base.bookmark}@${base.commit}\n`

/** `<bookmark>@<commit>`, a `Pineta-Base` value, read back; null if malformed. */
export function parseBase(
  value: string,
): { readonly bookmark: string; readonly commit: CommitId } | null {
  const at = value.lastIndexOf("@")
  if (at <= 0 || at === value.length - 1) return null
  return { bookmark: value.slice(0, at), commit: commitId(value.slice(at + 1)) }
}

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
  /** The line's names the base (`Pineta-Base`); a WIP's copy names its own. */
  readonly message: string
  /** With nothing to merge, a commit still names the line (`BaseMerge`). */
  readonly mark: boolean
  /**
   * The commits whose titles the update lists, `<from>..<to>`; `from` null is
   * the lane before the merge.
   */
  readonly came: { readonly from: CommitId | null; readonly to: CommitId }
}

/**
 * An update's steps (ADR-0060). A WIP's copy fetches only the WIP's commit:
 * the copy's parent is the lane's own.
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
  return {
    steps: [fetchById([from.commit]), ...planWipCopy(from, from.on)],
    source: "copy",
    message: `update: ${from.bookmark}`,
    mark: false,
    came: { from: from.under, to: from.commit },
  }
}

/**
 * The lane steps that make a disk a fork: a change of its own, before
 * anything else runs there (S42 item 2), the lane's bookmark at its base, and
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
    : restoreVolume(input.paths, input.from, input.spec.volume)),
  planStart(input.spec, input.env),
]

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
 * A git bundle of the lane's bookmark, excluding what your repo already has:
 * a bundle naming only the bookmark carries the whole history, 1.1 MB against
 * 8 KB for one commit on Pineta's repo (S43 item 8).
 */
export const planBundle = (
  lane: LaneName,
  have: readonly CommitId[],
  bookmark: string = bookmarkName(lane),
): readonly string[] => [
  "git",
  "bundle",
  "create",
  "-",
  `refs/heads/${bookmark}`,
  ...have.map(c => `^${c}`),
]

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

/**
 * The lane's bookmark into your repo, as its remote bookmark: the lane's
 * bundle to a host file, your repo fetching the bookmark from it into
 * `laneTipRef`, and jj importing it.
 */
export function planFetch(input: {
  readonly lane: LaneName
  /** What your repo has of the lane: its previous commit, else its fork point. */
  readonly have: readonly CommitId[]
  /** Your working copy's root. */
  readonly root: string
  /** A host file for the bundle. */
  readonly bundle: string
  /** A split's stack instead of the lane's tip (`stackBookmark`). */
  readonly stack?: boolean
}): LaneStep[] {
  const bookmark = input.stack
    ? stackBookmark(input.lane)
    : bookmarkName(input.lane)
  const to = input.stack ? laneStackRef(input.lane) : laneTipRef(input.lane)
  return [
    {
      in: "lane",
      argv: planBundle(input.lane, input.have, bookmark),
      stdoutTo: input.bundle,
    },
    onHost(
      "git",
      "-C",
      input.root,
      "fetch",
      "-q",
      input.bundle,
      `+refs/heads/${bookmark}:${to}`,
    ),
    importInto(input.root),
    onHost("rm", "-f", input.bundle),
  ]
}

/**
 * `jj git import` into your repo. A jj command with `--ignore-working-copy`
 * imports no git refs, so every ref Pineta writes is imported at once. With
 * the flag, the import leaves your working copy unsnapshotted: 12-47 ms,
 * where a plain `jj git import` snapshots it too (about 100 ms, S44 item 8).
 */
const importInto = (root: string): LaneStep =>
  onHost("jj", "-R", root, "--ignore-working-copy", "git", "import")

/**
 * Point lanes' remote bookmarks in your repo at commits, or delete them
 * (null), then import: the one writer of `laneTipRef` besides the fetch.
 * Archiving a root deletes its lanes' refs; restoring it writes them back
 * (S48 item 20).
 */
export const laneRefSteps = (
  root: string,
  updates: readonly {
    readonly lane: LaneName
    readonly commit: CommitId | null
  }[],
): LaneStep[] =>
  updates.length === 0
    ? []
    : [
        ...updates.map(u =>
          u.commit === null
            ? onHost("git", "-C", root, "update-ref", "-d", laneTipRef(u.lane))
            : onHost(
                "git",
                "-C",
                root,
                "update-ref",
                laneTipRef(u.lane),
                u.commit,
              ),
        ),
        importInto(root),
      ]

/**
 * jj on your repo as the host acts on it: never snapshotting your working
 * copy, and every operation marked as the host's (S48 items 1 and 8).
 */
export const hostOp = (root: string, ...args: string[]): LaneStep =>
  onHost(
    "jj",
    "-R",
    root,
    "--ignore-working-copy",
    "--config",
    `operation.username=${HOST_OPERATOR}`,
    ...args,
  )

/**
 * Where an offer starts, as a revset (ADR-0060): the newest ancestors of the
 * lane's tip you already have. That is the commit the lane's base names
 * (`start`: the line's commit, or the WIP's copy), and every lane commit a
 * taken offer's `Pineta-Source` names above what the base holds
 * (`takenRevset`), with their history: a parent lane's work taken after this
 * lane forked, or a branch of this lane taken whole. Each source is
 * `present()`: one not fetched here names nothing you have. Several heads
 * start the offer from their merge.
 */
export function offerStart(input: {
  readonly tip: CommitId
  readonly start: CommitId
  readonly sources: readonly CommitId[]
}): string {
  const sources = input.sources.map(c => `present(${c})`).join(" | ")
  const had = sources === "" ? input.start : `${input.start} | ::(${sources})`
  return `heads(::${input.tip} & (${had}))`
}

/**
 * The commits whose `Pineta-Source` trailers `offerStart` reads: those in
 * `::<onto>`, and in `::<wip>` for a lane on a WIP, but not in the history
 * of the base's `source` (S81). The lane merged that commit, so it holds
 * what was taken below it. An offer keeps the diff from the merge of its
 * start to the tip, so a source the target holds as another commit would be
 * subtracted from the target, and conflict where the line changed it since.
 * The source is `present()`: a commit gone from your repo excludes nothing.
 */
export function takenRevset(input: {
  readonly line: LineConfig
  readonly base: LaneBase
}): string {
  const { base } = input.base
  const heads = [
    `present(${revsetName(input.line.onto)})`,
    ...(base.kind === "wip" ? [`present(${revsetName(base.bookmark)})`] : []),
  ].join(" | ")
  return `(::(${heads}) ~ ::present(${input.base.source})) & description(regex:"(?m)^${TRAILERS.source}: ")`
}

/** One version of a commit in `jj evolog`: who made it, and from what. */
export interface EvologEntry {
  readonly commit: CommitId
  readonly change: string
  /** The operation that made it was the host's (`HOST_OPERATOR`). */
  readonly byHost: boolean
  readonly predecessors: readonly {
    readonly commit: CommitId
    readonly change: string
  }[]
}

/**
 * The template `parseEvolog` reads: one entry a line, its fields split by
 * tabs, each predecessor as `<commit>:<change>`. An entry whose operation
 * jj no longer holds prints an empty user, which is not the host's.
 */
export const EVOLOG_ENTRY =
  'commit.commit_id() ++ "\t" ++ commit.change_id() ++ "\t" ++ if(operation, operation.user(), "") ++ "\t" ++ predecessors.map(|p| p.commit_id() ++ ":" ++ p.change_id()).join(",") ++ "\n"'

/** Whether an operation's user (`<user>@<hostname>`) is the host's. */
export const isHostUser = (user: string): boolean =>
  user.startsWith(`${HOST_OPERATOR}@`)

/** `jj evolog -T EVOLOG_ENTRY`'s output -> its entries, newest first. */
export function parseEvolog(stdout: string): EvologEntry[] {
  return stdout
    .split("\n")
    .filter(line => line !== "")
    .map(line => {
      const [commit = "", change = "", user = "", preds = ""] = line.split("\t")
      return {
        commit: commitId(commit),
        change,
        byHost: isHostUser(user),
        predecessors: preds
          .split(",")
          .filter(p => p !== "")
          .map(p => {
            const [c = "", ch = ""] = p.split(":")
            return { commit: commitId(c), change: ch }
          }),
      }
    })
}

/**
 * The versions of a revision since the host's newest: walking back from
 * `from` through each entry's predecessor of the same change, until a
 * version the host made (`reached`). It stops, not `reached`, at an entry
 * with no such predecessor, one the read did not return, or a cycle.
 * `yours` are the versions an operation not the host's made, each with the
 * version before it: only those can be your edit. The evolog says who made
 * each version, so nothing the host remembers is needed (S73).
 */
export function walkToHost(
  entries: readonly EvologEntry[],
  from: CommitId,
): {
  readonly reached: boolean
  readonly yours: readonly { readonly from: CommitId; readonly to: CommitId }[]
} {
  const byCommit = new Map(entries.map(e => [e.commit, e]))
  const yours: { from: CommitId; to: CommitId }[] = []
  const seen = new Set<CommitId>()
  let at = from
  for (;;) {
    const entry = byCommit.get(at)
    if (entry === undefined || seen.has(at)) return { reached: false, yours }
    if (entry.byHost) return { reached: true, yours }
    seen.add(at)
    const before = entry.predecessors.find(p => p.change === entry.change)
    if (before === undefined) return { reached: false, yours }
    yours.push({ from: before.commit, to: at })
    at = before.commit
  }
}

/** One revision of an offer: the lane commit whose files it has, and its message. */
export interface OfferSource {
  readonly commit: CommitId
  readonly description: string
}

/**
 * A host operation that rewrites an offer. An offer on the line is immutable
 * (ADR-0060), so the host's own rewrites of it pass `--ignore-immutable`; a
 * bookmark move rewrites no commit and needs none (S77 item 7).
 */
const hostRewrite = (root: string, ...args: string[]): LaneStep =>
  hostOp(root, "--ignore-immutable", ...args)

/**
 * The revset naming the `i`th commit an offer's plan makes, until the plan's
 * last steps describe it. `jj new` has no template, so a commit it makes can
 * be found again only by something unique the plan chose (S48 item 18).
 */
export const nonceRevset = (nonce: string, i: number): string =>
  `description(exact:"${nonce}-${i}\n")`

/**
 * An offer in your repo: for each source, a commit on the one before (the
 * first on `start`, a merge when it names several heads), with that source's
 * files restored into it; the whole of it rebased onto `target`; the top
 * bookmarked; then each described, which retires its nonce. A single offer
 * has one source, the lane's tip; a stack has one per lane revision
 * (ADR-0038, S48 items 16 and 18). Every step is the host's, by nonce, never
 * a commit id kept across steps (S48 item 2).
 */
export function planOffer(input: {
  readonly root: string
  readonly name: ThreadName
  readonly start: readonly CommitId[]
  readonly sources: readonly OfferSource[]
  readonly target: string
  readonly nonce: string
}): LaneStep[] {
  const { root, nonce, sources } = input
  const at = (i: number) => nonceRevset(nonce, i)
  const made = sources.flatMap((source, i) => [
    hostOp(
      root,
      "new",
      "--no-edit",
      ...(i === 0 ? input.start : [at(i - 1)]),
      "-m",
      `${nonce}-${i}`,
    ),
    hostRewrite(root, "restore", "--from", source.commit, "--into", at(i)),
  ])
  const top = sources.length - 1
  return [
    ...made,
    ...planRefreshOffer(root, at(0), input.target),
    hostOp(
      root,
      "bookmark",
      "set",
      "--allow-backwards",
      offerBookmark(input.name),
      "-r",
      at(top),
    ),
    ...sources.map((source, i) =>
      hostRewrite(root, "describe", "-r", at(i), "-m", source.description),
    ),
  ]
}

/** An offer moved onto the target: its bottom, and the rest with it. */
export const planRefreshOffer = (
  root: string,
  bottom: string,
  target: string,
): LaneStep[] => [hostRewrite(root, "rebase", "-s", bottom, "-o", target)]

/**
 * A single offer following its lane in place (ADR-0039): back onto where it
 * starts now, the lane's tip restored into it, onto the target again. Its
 * tree is then your target plus the lane's change since the start, which the
 * tip's files cannot give where it sits; its change id and bookmark stay
 * (S49). With `description`, it is described again: the WIP line, when the
 * agent's message no longer describes it.
 */
export function planFollowOffer(input: {
  readonly root: string
  readonly change: string
  readonly start: readonly CommitId[]
  readonly tip: CommitId
  readonly target: string
  readonly description: string | null
}): LaneStep[] {
  const { root, change } = input
  return [
    hostRewrite(
      root,
      "rebase",
      "-s",
      change,
      ...input.start.flatMap(c => ["-o", c]),
    ),
    hostRewrite(root, "restore", "--from", input.tip, "--into", change),
    ...planRefreshOffer(root, change, input.target),
    ...(input.description === null
      ? []
      : planDescribe(root, change, input.description)),
  ]
}

/** An offer's revisions abandoned, to build it again. */
export const planAbandonOffer = (
  root: string,
  changes: readonly string[],
): LaneStep[] =>
  changes.length === 0 ? [] : [hostRewrite(root, "abandon", ...changes)]

/** One revision of an offer described again (an agent's commit message). */
export const planDescribe = (
  root: string,
  change: string,
  message: string,
): LaneStep[] => [hostRewrite(root, "describe", "-r", change, "-m", message)]

/**
 * After a race left a revision divergent: abandon the commit the host's own
 * operation made, and point the offer's bookmark at yours (S48 item 8).
 */
export const planRepair = (input: {
  readonly root: string
  /** The offer's bookmark, as its record holds it. */
  readonly bookmark: string
  readonly hosts: CommitId
  readonly yours: CommitId
  readonly top: boolean
}): LaneStep[] => [
  hostRewrite(input.root, "abandon", input.hosts),
  ...(input.top
    ? [
        hostOp(
          input.root,
          "bookmark",
          "set",
          "--allow-backwards",
          input.bookmark,
          "-r",
          input.yours,
        ),
      ]
    : []),
]

/**
 * Take an offer (ADR-0060): its destination bookmark moved forward to its
 * top, as the host, then the offer's bookmark deleted. Never a rebase, and
 * never your `@`. Without `--allow-backwards`, jj itself refuses a move that
 * is not forward (S77 item 1), so a take planned on stale facts fails rather
 * than moving the bookmark anywhere else.
 */
export function planTakeOffer(input: {
  readonly root: string
  /** The offer's bookmark, as its record holds it. */
  readonly bookmark: string
  readonly top: string
  /** The bookmark the take moves: the line, or a WIP. */
  readonly destination: string
}): LaneStep[] {
  return [
    hostOp(
      input.root,
      "bookmark",
      "move",
      input.destination,
      "--to",
      input.top,
    ),
    hostOp(input.root, "bookmark", "delete", input.bookmark),
  ]
}

/**
 * Retire what Pineta wrote into your repo before ADR-0038, in S48 item 21's
 * order: each local `pineta/<lane>` becomes the lane's remote bookmark, then
 * the local bookmarks go, then Pineta's line leaves `immutable_heads()`.
 * Deleting first would leave the lanes' commits in your default log. A
 * config change is not a jj operation.
 */
export function planRetire(input: {
  readonly root: string
  readonly bookmarks: readonly {
    readonly name: string
    readonly commit: CommitId
  }[]
  readonly heads: string
}): LaneStep[] {
  const { root } = input
  const lanes = input.bookmarks.flatMap(b => {
    const lane = b.name.startsWith("pineta/") ? b.name.slice(7) : ""
    return isLaneName(lane) ? [{ lane, commit: b.commit }] : []
  })
  const next = withoutPinetaHeads(input.heads)
  const key = 'revset-aliases."immutable_heads()"'
  return [
    ...laneRefSteps(root, lanes),
    ...(input.bookmarks.length === 0
      ? []
      : [hostOp(root, "bookmark", "delete", "glob:pineta/*")]),
    ...(next === null
      ? []
      : next === ""
        ? [onHost("jj", "-R", root, "config", "unset", "--repo", key)]
        : [onHost("jj", "-R", root, "config", "set", "--repo", key, next)]),
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
 * The images a project's lanes need (ADR-0034, ADR-0041). Pineta's is built
 * with the host's jj version and the app's Playwright version, so its jj and
 * its browser match what drives them. A project's own image gets the jj
 * version only. Each is tagged by a hash of its Containerfile and build
 * arguments, so a change of either builds it again.
 */
export function planImages(input: {
  readonly pineta: Containerfile
  /** The project's `pineta.Containerfile`, or null when it has none. */
  readonly project: Containerfile | null
  readonly jjVersion: string
  readonly playwrightVersion: string
}): { readonly pineta: ImagePlan; readonly project: ImagePlan | null } {
  const jj = `JJ_VERSION=${input.jjVersion}`
  return {
    pineta: imagePlan(input.pineta, [
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
  return { file: containerfile.file, tag: `pineta-lane:${hash}`, buildArgs }
}
