// scripts/migrate-pineta — once, on the Mac, with the host stopped: what the
// host named `pineta` before b05e2252 renamed it (S114) is given the names it
// reads now. Delete this file and its test once it has run.
//
//   node scripts/migrate-pineta.ts <project root>
//
// Gather, plan (pure, below, tested), execute, in three parts:
// - the project folder, `.pineta/` and its store, when only it exists;
// - each lane's volume: `pineta-<lane>` copied to `pinetrie-<lane>` when that
//   is missing, else both kept and listed; then every `pinetrie-<lane>` gets
//   the current names on its disk (`planOldNamesOnDisk`), since a volume the
//   host restored from a snapshot since the rename holds the old ones; then
//   each copied old volume removed;
// - your repo's lane refs, `refs/remotes/pineta-<lane>/{tip,stack}`, moved;
//   each `pineta-offer/*` bookmark deleted, with its mutable revisions off
//   the line abandoned, so the host builds the offer again; and every clause
//   of your repo's jj config naming `pineta-` dropped, the current one added
//   once.
// Running it twice does nothing the second time.

import { readdir, rename, stat } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { isBusyError, openDatabase } from "../apps/pinetrie/host/store.ts"
import {
  type CommitId,
  commitId,
  isLaneName,
  type LaneName,
  NO_EDITOR,
  WORKSPACE_ROOT,
} from "../packages/core/index.ts"
import {
  bookmarkRevset,
  commitsOf,
  configJson,
  decodeLaneConfig,
  describeFailure,
  executeOrThrow,
  hostBytesRunner,
  hostRunner,
  LANE_JJ_CONFIG,
  laneStackRef,
  lines,
  mountArgs,
  oldNamesOnDisk,
  PROJECT_DIR,
  pinetrieDir,
  planOldNamesOnDisk,
  prepareHost,
  type RepoConfig,
  RUNTIME_BIN,
  RUNTIME_MOUNT,
  type Runner,
  type Runners,
  readConfigFile,
  removeLane,
  repoConfig,
  restoreVolume,
  revsetName,
  run,
  userConfigFile,
  volumeImage,
} from "../packages/lanes/index.ts"
import { laneRefSteps, startRepoOwner } from "../packages/repo/index.ts"
import { IMPORT, immutableHeads, logRevset } from "../packages/repo/plan.ts"
import { git, host, type RepoStep, you } from "../packages/repo/step.ts"

const OLD = "pineta"
const OLD_DIR = `.${OLD}`
const OLD_STORE = `${OLD}.db`
const NEW_STORE = path.basename(pinetrieDir("/").store)
const OLD_VOLUME = (lane: LaneName): string => `${OLD}-${lane}`
const NEW_VOLUME = (lane: LaneName): string => `pinetrie-${lane}`
const OLD_REF = /^refs\/remotes\/pineta-(.+)\/(tip|stack)$/
const OLD_OFFER = `${OLD}-offer/`

// ── plans, pure ────────────────────────────────────────────────────────────

/** The project folder, and the store files in the old one. */
export interface FolderFacts {
  readonly old: boolean
  readonly current: boolean
  /** The names in `.pineta/` that start with `pineta.db`. */
  readonly oldStoreFiles: readonly string[]
}

/** Renames, oldest first: the folder, then each store file inside it. */
export type FolderPlan = readonly (readonly [string, string])[]

export function planFolder(root: string, facts: FolderFacts): FolderPlan {
  if (!facts.old || facts.current) return []
  const to = path.join(root, PROJECT_DIR)
  return [
    [path.join(root, OLD_DIR), to],
    ...facts.oldStoreFiles.map(
      f =>
        [
          path.join(to, f),
          path.join(to, NEW_STORE + f.slice(OLD_STORE.length)),
        ] as const,
    ),
  ]
}

/** The lanes with a volume under each name. */
export interface VolumeFacts {
  readonly old: readonly LaneName[]
  readonly current: readonly LaneName[]
}

/**
 * An old volume alone is copied to the current name; one beside a current
 * volume is kept, both, for the person to choose. Every current volume, a
 * copy's included, has the names on its disk fixed: one the host restored
 * from a snapshot since the rename holds the old ones.
 */
export function planVolumes(facts: VolumeFacts): {
  readonly copy: LaneName[]
  readonly keep: LaneName[]
  readonly fix: LaneName[]
} {
  const current = new Set(facts.current)
  const copy = facts.old.filter(l => !current.has(l))
  return {
    copy,
    keep: facts.old.filter(l => current.has(l)),
    fix: [...new Set([...facts.current, ...copy])].sort(),
  }
}

/** What of your repo carries the old names. */
export interface RepoFacts {
  /** Every ref under `refs/remotes/`, with its commit. */
  readonly refs: readonly { readonly ref: string; readonly commit: CommitId }[]
  /**
   * Each `pineta-offer/*` bookmark, with the revisions to abandon: not on the
   * line, not under your `@` (abandoning one would leave your working copy
   * stale, since the host never snapshots it), and mutable: a lane's own
   * commits under it are not.
   */
  readonly offers: readonly {
    readonly bookmark: string
    readonly revisions: readonly CommitId[]
  }[]
  /** `immutable_heads()` and `revsets.log` as jj resolves them; null when unset. */
  readonly config: {
    readonly heads: string | null
    readonly log: string | null
  }
}

/**
 * A revset's top-level `|` operands without those naming `pineta-`; null
 * when none is left. Parentheses and quotes are kept whole.
 */
export function withoutOldClauses(revset: string): string | null {
  const operands: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < revset.length; i++) {
    const c = revset[i]
    if (c === '"' && revset[i - 1] !== "\\") quoted = !quoted
    else if (quoted) continue
    else if (c === "(") depth++
    else if (c === ")") depth--
    else if (c === "|" && depth === 0) {
      operands.push(revset.slice(start, i))
      start = i + 1
    }
  }
  operands.push(revset.slice(start))
  const kept = operands
    .map(o => o.trim())
    .filter(o => o !== "" && !o.includes(`${OLD}-`))
  return kept.length === 0 ? null : kept.join(" | ")
}

/** Your repo's steps: refs moved, config rewritten, then old offers dropped. */
export function planRepo(facts: RepoFacts, repoConfig: RepoConfig): RepoStep[] {
  const old = facts.refs.flatMap(r => {
    const m = OLD_REF.exec(r.ref)
    const lane = m?.[1]
    return lane !== undefined && isLaneName(lane)
      ? [{ ...r, lane, kind: m?.[2] === "stack" ? "stack" : "tip" }]
      : []
  })
  const tips = laneRefSteps(
    old
      .filter(r => r.kind === "tip")
      .map(r => ({ lane: r.lane, commit: r.commit })),
  )
  const refs: RepoStep[] =
    old.length === 0
      ? []
      : [
          ...old
            .filter(r => r.kind === "stack")
            .map(r => git("update-ref", laneStackRef(r.lane), r.commit)),
          ...old.map(r => git("update-ref", "-d", r.ref)),
          ...(tips.length === 0 ? [IMPORT] : tips),
        ]
  const { heads, log } = facts.config
  const config: RepoStep[] = [
    ...(heads?.includes(`${OLD}-`)
      ? [
          you(
            "config",
            "set",
            "--repo",
            'revset-aliases."immutable_heads()"',
            immutableHeads(repoConfig, withoutOldClauses(heads)),
          ),
        ]
      : []),
    ...(log?.includes(`${OLD}-`)
      ? [
          you(
            "config",
            "set",
            "--repo",
            "revsets.log",
            logRevset(withoutOldClauses(log)),
          ),
        ]
      : []),
  ]
  const offers = facts.offers.flatMap(o => [
    ...(o.revisions.length === 0 ? [] : [host("abandon", ...o.revisions)]),
    host("bookmark", "delete", o.bookmark),
  ])
  return [...refs, ...config, ...offers]
}

// ── the shell ──────────────────────────────────────────────────────────────

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

const say = (line: string) => process.stdout.write(`${line}\n`)

/** Take the store's lock, or exit 2 naming who holds it. */
function lockStore(file: string) {
  try {
    return openDatabase(file, { busyTimeoutMs: 0 })
  } catch (error) {
    const busy = error instanceof Error && isBusyError(error.cause)
    process.stderr.write(
      `${busy ? "stop the host first: " : ""}${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(2)
  }
}

async function gatherFolder(root: string): Promise<FolderFacts> {
  const old = await exists(path.join(root, OLD_DIR))
  return {
    old,
    current: await exists(path.join(root, PROJECT_DIR)),
    oldStoreFiles: old
      ? (await readdir(path.join(root, OLD_DIR))).filter(f =>
          f.startsWith(OLD_STORE),
        )
      : [],
  }
}

/** The default lane image, from the one runtime the host keeps (`ensureRuntime`). */
async function laneImage(
  root: string,
): Promise<{ readonly image: string; readonly runtime: string }> {
  const dir = pinetrieDir(root).runtime
  const [name] = (await readdir(dir).catch(() => [])).filter(n =>
    /^pinetrie-lane-[0-9a-f]+$/.test(n),
  )
  if (name === undefined)
    throw new Error(
      `no lane runtime in ${dir}: start the host once on this code, stop it, and run this again`,
    )
  return {
    image: name.replace(/^pinetrie-lane-/, "pinetrie-lane:"),
    runtime: path.join(dir, name),
  }
}

/**
 * Fix the names on `pinetrie-<lane>`'s disk, in a container of its own that
 * mounts the disk and the runtime's jj, then removed.
 */
async function fixDisk(
  lane: LaneName,
  lanes: { readonly image: string; readonly runtime: string },
): Promise<number> {
  const name = `pinetrie-migrate-${lane}`
  // One a run that stopped part-way left behind.
  await run("container", ["rm", "-f", name])
  await run("container", ["stop", NEW_VOLUME(lane)])
  const env = {
    PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${RUNTIME_BIN}`,
    JJ_CONFIG: LANE_JJ_CONFIG,
    ...NO_EDITOR,
  }
  const started = await run("container", [
    "run",
    "-d",
    "--name",
    name,
    "-v",
    `${NEW_VOLUME(lane)}:${WORKSPACE_ROOT}`,
    ...mountArgs({
      source: lanes.runtime,
      target: RUNTIME_MOUNT,
      readonly: true,
    }),
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-w",
    WORKSPACE_ROOT,
    lanes.image,
    "sleep",
    "infinity",
  ])
  if (!started.ok) throw new Error(describeFailure("container run", started))
  try {
    const inDisk: Runner = argv => run("container", ["exec", name, ...argv])
    const runners: Runners = {
      host: hostRunner(),
      lane: inDisk,
      laneBytes: hostBytesRunner(),
    }
    const steps = planOldNamesOnDisk(await oldNamesOnDisk(inDisk), lane)
    await executeOrThrow(steps, runners)
    return steps.length
  } finally {
    await run("container", ["rm", "-f", name])
  }
}

async function gatherRepo(
  jj: Runner,
  gitRunner: Runner,
  repoConfig: RepoConfig,
): Promise<RepoFacts> {
  const refs = await gitRunner([
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/remotes/",
  ])
  if (!refs.ok) throw new Error(describeFailure("git for-each-ref", refs))
  const listed = await jj(["bookmark", "list", "-T", 'name ++ "\\n"'])
  if (!listed.ok) throw new Error(describeFailure("jj bookmark list", listed))
  const acceptedBookmark = `present(${revsetName(repoConfig.acceptedBookmark)})`
  const offers = await Promise.all(
    [...new Set(lines(listed.stdout))]
      .filter(b => b.startsWith(OLD_OFFER))
      .map(async bookmark => ({
        bookmark,
        revisions: await commitsOf(
          jj,
          `(::${bookmarkRevset(bookmark)} ~ ::${acceptedBookmark} ~ ::@) & mutable()`,
        ),
      })),
  )
  const config = async (key: string) => {
    const got = await jj(["config", "get", key])
    return got.ok ? got.stdout.trim() : null
  }
  return {
    refs: lines(refs.stdout).flatMap(l => {
      const [ref = "", commit = ""] = l.split(" ")
      return ref === "" ? [] : [{ ref, commit: commitId(commit) }]
    }),
    offers,
    config: {
      heads: await config('revset-aliases."immutable_heads()"'),
      log: await config("revsets.log"),
    },
  }
}

async function main(given: string | undefined): Promise<void> {
  if (given === undefined) {
    process.stderr.write(
      "usage: node scripts/migrate-pineta.ts <project root>\n",
    )
    process.exit(2)
  }
  const root = path.resolve(given)

  // The project folder, under the store's lock in either place.
  const folder = await gatherFolder(root)
  if (!folder.old && !folder.current) {
    process.stderr.write(
      `${root} has neither ${OLD_DIR}/ nor ${PROJECT_DIR}/\n`,
    )
    process.exit(2)
  }
  const renames = planFolder(root, folder)
  const before = lockStore(
    folder.current
      ? pinetrieDir(root).store
      : path.join(root, OLD_DIR, OLD_STORE),
  )
  before.close()
  for (const [from, to] of renames) {
    await rename(from, to)
    say(`renamed ${from} -> ${to}`)
  }
  if (folder.old && folder.current)
    say(`left ${OLD_DIR}/ alone: ${PROJECT_DIR}/ is there too`)
  const store = lockStore(pinetrieDir(root).store)

  try {
    const { project, paths } = await prepareHost(root)
    if (project.kind !== "lanes" || paths === null)
      throw new Error(
        `lanes of their own are off here (${project.kind === "direct" ? project.reason : "no disks"}): \`container\` must be running`,
      )

    // Each lane's volume.
    const named = await readdir(paths.volumes)
    const lanesUnder = (prefix: string) =>
      named
        .filter(v => v.startsWith(prefix))
        .map(v => v.slice(prefix.length))
        .filter(isLaneName)
    const { copy, keep, fix } = planVolumes({
      old: lanesUnder(`${OLD}-`),
      current: lanesUnder("pinetrie-"),
    })
    const onHost: Runners = {
      host: hostRunner(),
      lane: hostRunner(),
      laneBytes: hostBytesRunner(),
    }
    for (const lane of copy) {
      await run("container", ["stop", OLD_VOLUME(lane)])
      await executeOrThrow(
        restoreVolume(
          paths,
          volumeImage(paths, OLD_VOLUME(lane)),
          NEW_VOLUME(lane),
        ),
        onHost,
      )
      say(`volume ${OLD_VOLUME(lane)} copied to ${NEW_VOLUME(lane)}`)
    }
    if (fix.length > 0) {
      const image = await laneImage(root)
      for (const lane of fix) {
        const fixed = await fixDisk(lane, image)
        if (fixed > 0)
          say(`${NEW_VOLUME(lane)}: ${fixed} name fixes on its disk`)
      }
    }
    for (const lane of copy) {
      await removeLane(OLD_VOLUME(lane))
      say(`volume ${OLD_VOLUME(lane)} removed`)
    }
    for (const lane of keep)
      say(
        `KEPT BOTH: ${OLD_VOLUME(lane)} and ${NEW_VOLUME(lane)}: decide which disk is ahead, then \`container volume rm\` the other`,
      )

    // Your repo, through the owner, as the host writes it.
    const user = decodeLaneConfig(
      configJson(await readConfigFile(userConfigFile())),
      root,
      false,
    )
    const own = decodeLaneConfig(
      configJson(await readConfigFile(path.join(root, "pinetrie.json"))),
      root,
      false,
    )
    const { repoConfig: line } = repoConfig(user.offers, own.offers)
    const owner = startRepoOwner({ root, repoConfig: line })
    try {
      const steps = await owner.command(async ops => {
        const facts = await gatherRepo(ops.jj, ops.git, line)
        const planned = planRepo(facts, line)
        await ops.execute(planned)
        for (const o of facts.offers)
          say(
            `offer ${o.bookmark} deleted${o.revisions.length === 0 ? "" : `, its revisions abandoned: ${o.revisions.join(" ")}`}`,
          )
        return planned
      })
      say(`your repo: ${steps.length} steps`)
    } finally {
      owner.close()
    }
  } finally {
    store.close()
  }
}

if (import.meta.main)
  await main(process.argv[2]).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
