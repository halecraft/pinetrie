// What the real-jj tests of your repo and a lane's share: their lanes'
// names, the runners (each argument checked for length), the hooks that make
// and remove their directories, and the rigs, each set up once per file and
// copied for each test (`laneRigs`).

import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  baseMessage,
  type CommitId,
  type EntryId,
  entryId,
  NO_EDITOR,
  type ProposedSource,
  pointFromCommit,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  executeOrThrow,
  hostBytesRunner,
  hostRunner,
  LANE_JJ_CONFIG,
  type LaneAuthority,
  type LaneStep,
  laneIgnores,
  lines,
  NO_GRANTS,
  type Runner,
  run,
} from "@pinetrie/lanes"
import { afterAll, afterEach, beforeAll, expect } from "vitest"
import {
  acceptedIn,
  acceptProposedChanges,
  buildProposedChanges,
  fetchLane,
  jjLaneFor,
  knownStart as knownStartOf,
  proposedTip,
} from "./fixtures.ts"
import { readGetLatest } from "./get-latest.ts"
import { laneBase } from "./lane/base.ts"
import { readLaneBookmark } from "./lane/bookmarks.ts"
import { conflictsIn, mergeBase, mergeUpdate } from "./lane/merge.ts"
import { DEFAULT_REPO, proposedBookmark } from "./lane/names.ts"
import {
  fetchById,
  planBaseCheckout,
  planForkSetup,
  planMerge,
} from "./lane/plan.ts"
import { commitTurn, readCommits } from "./lane/revisions.ts"
import { gatherLane } from "./lane-read.ts"
import { immutableHeads, logRevset, planSetup } from "./plan.ts"
import {
  filesTouched,
  laneTipIn,
  readHostVersion,
  readProposedChanges,
  startOfProposed,
} from "./proposed.ts"
import { executeRepo, hostOps as runAsHost, hostJj as runAsYou } from "./run.ts"
import { readShared } from "./shared.ts"

/**
 * The longest argument a jj command on your repo may have. A set of commits
 * written out one by one grows with the repo, and jj parses it for longer than
 * it reads; such a set is a revset or an alias.
 */
const MAX_JJ_ARGUMENT = 4096
/** Every argument over the limit a history ran, checked after each test: a caller may catch the command's failure. */
const tooLong: string[] = []
const guarded =
  (runner: Runner): Runner =>
  args => {
    for (const a of args)
      if (a.length > MAX_JJ_ARGUMENT) tooLong.push(`${a.slice(0, 120)}…`)
    return runner(args)
  }
export const hostJj = (root: string): Runner => guarded(runAsYou(root))
export const hostOps = (root: string): Runner => guarded(runAsHost(root))

export const LANE = threadIdFor("1")
export const NAME = "amber-fox" as ThreadName
export const FORK = threadIdFor("2")
export const ROOT = threadIdFor("3")
export const TURN = { lane: LANE, title: "a turn" }

/** Where `LANE`'s proposed changes start, as commits: a test of an untraced start reads `startOfProposed` itself. */
export const knownStart = (
  jj: Runner,
  input: Omit<Parameters<typeof knownStartOf>[1], "lane">,
) => knownStartOf(jj, { ...input, lane: LANE })

/** `commitTurn` with the lane's bookmark read first, as the host reads it. */
export const turnOn = async (
  jj: Runner,
  input: {
    readonly title: string
    readonly entry: EntryId
    readonly lane: ThreadId
  },
) =>
  (
    await commitTurn(jj, {
      ...input,
      bookmark: await readLaneBookmark(jj, input.lane),
    })
  ).point

/** Your default `jj log`, as descriptions. */
export const defaultLog = async (jj: Runner): Promise<string> =>
  (
    await jj([
      "log",
      "--ignore-working-copy",
      "--no-graph",
      "-T",
      'description.first_line() ++ "\n"',
    ])
  ).stdout

// ── against jj and git themselves, in throwaway repos ──────────────────────

/**
 * A lane's steps, run on the host: `/mnt/host-working-copy` and `/workspace` are directories
 * here. Only a mount at the start of a word moves: `refs/heads/pinetrie/fetched`
 * is a ref, not a path.
 */
export const onHost = (
  steps: readonly LaneStep[],
  dirs: Record<string, string>,
) =>
  steps.map(s => ({
    ...s,
    argv: s.argv.map(a =>
      Object.entries(dirs).reduce(
        (t, [from, to]) =>
          t.replace(
            new RegExp(`(^|[\\s'])${from}(?=[/\\s']|$)`, "g"),
            `$1${to}`,
          ),
        a,
      ),
    ),
  }))

/** Where a lane's jj config is, from the lane's root. */
export const LANE_CONFIG = path.relative(WORKSPACE_ROOT, LANE_JJ_CONFIG)

/**
 * jj on the repo at `dir`, with `config` as `JJ_CONFIG` gives it in a
 * container: by default the lane's own, at `dir`.
 */
export const laneJjRunner =
  (dir: string, config = path.join(dir, LANE_CONFIG)): Runner =>
  args =>
    run("jj", ["-R", dir, "--no-pager", "--color=never", ...args], {
      env: { ...NO_EDITOR, JJ_CONFIG: config },
    })

/**
 * What a copy of `pinetrie.json` grants, as far as these tests write one: its
 * personal ssh. The host's table decodes the rest.
 */
export const sshAuthority = (text: string | null): LaneAuthority => ({
  grants: {
    ...NO_GRANTS,
    ssh:
      text !== null &&
      (JSON.parse(text) as { lanes?: { ssh?: { personal?: boolean } } }).lanes
        ?.ssh?.personal === true,
  },
  shared: [],
})

/**
 * The names of a revision's files, all at its root here. jj prints each path
 * from the process's directory, not `-R`'s.
 */
export const fileNames = async (jj: Runner, rev: string) =>
  lines((await jj(["file", "list", "-r", rev])).stdout).map(f =>
    path.basename(f),
  )

/** The directory a file's repos are made in: set by `useLaneRepos`' `beforeAll`. */
export interface LaneRepos {
  top: string
}

/**
 * The hooks of a file's `describe`: a directory for its repos, jj's and git's
 * identity and the lanes' ignore file in the environment, and after each
 * test, no argument over the limit.
 */
export function useLaneRepos(): LaneRepos {
  const repos: LaneRepos = { top: "" }
  /** Git's variables as a lane has them: every repo ignores the lane's ignore file. */
  const GIT_IGNORE_VARS = [
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
  ] as const
  beforeAll(async () => {
    repos.top = await realpath(
      await mkdtemp(path.join(tmpdir(), "pinetrie-lanes-")),
    )
    process.env.JJ_USER = "Probe"
    process.env.JJ_EMAIL = "probe@example.com"
    const ignore = path.join(repos.top, "lane-git", "ignore")
    await mkdir(path.dirname(ignore), { recursive: true })
    await writeFile(ignore, laneIgnores([".plans"]))
    process.env.GIT_CONFIG_COUNT = "1"
    process.env.GIT_CONFIG_KEY_0 = "core.excludesFile"
    process.env.GIT_CONFIG_VALUE_0 = ignore
  })
  afterAll(async () => {
    for (const name of GIT_IGNORE_VARS) delete process.env[name]
    await rm(repos.top, { recursive: true, force: true })
  })
  afterEach(() => {
    expect(tooLong.splice(0)).toEqual([])
  })
  return repos
}

/**
 * Your repo and one lane's, in `<top>/<tag>-…`, with the lane's steps run on
 * the host. Its proposed changes are built and accepted by the steps the port
 * suite's harness shares (`fixtures.ts`). `from: "copied"` takes directories
 * a copy already made (`laneRigs`).
 */
export async function proposedRigIn(
  repos: LaneRepos,
  tag: string,
  from: "new" | "copied" = "new",
) {
  const repoDir = path.join(repos.top, `${tag}-yours`)
  const laneDir = path.join(repos.top, `${tag}-lane`)
  if (from === "new") {
    await run("mkdir", ["-p", repoDir, laneDir])
    await run("jj", ["git", "init", "--colocate", repoDir])
  }
  const repoJj = hostJj(repoDir)
  const ops = hostOps(repoDir)
  const laneJj = laneJjRunner(laneDir)
  const line = DEFAULT_REPO
  const runnersAt = (dir: string) => ({
    lane: hostRunner(dir),
    laneBytes: hostBytesRunner(dir),
  })
  const runners = runnersAt(laneDir)
  /** A lane's steps, in the lane's directory, or in `dir` for a fork. */
  const inLane = (steps: readonly LaneStep[], dir = laneDir) =>
    executeOrThrow(
      onHost(steps, {
        "/mnt/host-working-copy": repoDir,
        "/workspace": dir,
      }),
      runnersAt(dir),
    )
  const fetch = (have: readonly CommitId[]) =>
    fetchLane(runners, repoDir, {
      lane: LANE,
      have,
      bundle: path.join(repos.top, `${tag}.bundle`),
    })
  const edit = async (dir: string, file: string, text: string) =>
    writeFile(path.join(dir, file), text)
  /** Accepted work's commit now. */
  const acceptedNow = () => acceptedIn(ops, line)
  /** Set accepted work up at your `@-`, as the host does on your command. */
  const setUpAccepted = () =>
    executeRepo(
      repoDir,
      planSetup({
        acceptedBookmark: line.acceptedBookmark,
        heads: immutableHeads(line, null),
        log: logRevset(null),
      }),
    )
  const build = (sources: readonly ProposedSource[], name: ThreadName = NAME) =>
    buildProposedChanges(repoDir, {
      lane: LANE,
      name,
      sources,
      repoConfig: line,
    })
  let entry = 0
  const turn = async () => {
    const t = await turnOn(laneJj, {
      ...TURN,
      entry: entryId(`e-${tag}-${++entry}`),
    })
    if (t === null) throw new Error("the turn committed nothing")
    return t
  }
  /** "Bring up to date" on accepted work: its commit merged into the lane. Returns the files it left conflicted. */
  const update = async () => {
    const commit = await acceptedNow()
    await inLane([fetchById([commit])])
    await mergeBase(
      laneJj,
      LANE,
      commit,
      baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit,
      }),
    )
    return conflictsIn(laneJj)
  }
  /**
   * "Bring up to date" with accepted work as the host runs it, in the lane at
   * `dir`: `planMerge`, then `mergeUpdate`, which joins the accepted thread
   * commits it holds first.
   */
  const getLatest = async (dir = laneDir, lane: ThreadId = LANE) => {
    const commit = await acceptedNow()
    const plan = planMerge(jjLaneFor(LANE), {
      kind: "accepted",
      point: pointFromCommit(commit),
      mark: false,
    })
    // The plan's fetch names your repo by its path in a lane: run it here.
    await inLane(plan.steps, dir)
    return mergeUpdate(laneJjRunner(dir), runnersAt(dir), lane, {
      ...plan,
      steps: [],
    })
  }
  /**
   * The one batched read (`gatherLane`) says what the separate reads say: the
   * lane's tip, base and start, the proposed changes, whether its work
   * changes any file, and what catching up would change. Returns that read.
   */
  const agrees = async () => {
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const shared = await readShared(op, ops, line)
    const gathered = await gatherLane(ops, {
      lane: LANE,
      name: NAME,
      repoConfig: line,
      shared,
      known: null,
    })
    const tip = await laneTipIn(ops, LANE)
    const base = tip === null ? null : await laneBase(ops, tip, line)
    if (tip === null || base === null) {
      expect(gathered).toBe("none")
      return gathered
    }
    if (base.base.kind === "unfinished") {
      expect(gathered).toBe("unfinished")
      return gathered
    }
    const target = await acceptedNow()
    const start = await startOfProposed(ops, {
      tip,
      base,
      repoConfig: line,
      lane: LANE,
    })
    const proposed = await readProposedChanges(ops, { name: NAME, target })
    expect(gathered).toEqual({
      tip,
      base,
      target,
      start,
      proposed,
      hostLeft:
        proposed === null &&
        (await readHostVersion(ops, proposedBookmark(NAME))) !== null,
      work: await filesTouched(ops, { start, tip }),
      getLatest: await readGetLatest(ops, {
        base,
        start,
        target: { kind: "accepted", commit: target },
        tip,
        known: null,
      }),
    })
    return gathered
  }
  /** Proposed changes of the lane's tip, fetched from `from`, its ledger naming the tip. */
  const proposed = async (from: readonly CommitId[]) => {
    await fetch(from)
    const built = await proposedTip(repoDir, {
      lane: LANE,
      name: NAME,
      repoConfig: line,
    })
    const [commit] = built.commits
    if (commit === undefined) throw new Error("no proposed changes")
    return {
      built,
      conflicted:
        (await readCommits(ops, `${commit} & conflicts()`)).length > 0,
      files: lines((await ops(["diff", "-r", commit, "--name-only"])).stdout),
    }
  }
  /** Accept `proposed` into accepted work: its bookmark moved forward, as the host. */
  const accept = async (proposed: {
    readonly built: { readonly changeIds: readonly string[] }
  }) => {
    const [changeId] = proposed.built.changeIds
    if (changeId === undefined) throw new Error("no proposed changes")
    await acceptProposedChanges(repoDir, {
      name: NAME,
      top: changeId,
      repoConfig: line,
    })
  }
  return {
    agrees,
    repoDir,
    laneDir,
    repoJj,
    ops,
    laneJj,
    line,
    inLane,
    fetch,
    edit,
    acceptedNow,
    setUpAccepted,
    build,
    turn,
    update,
    getLatest,
    proposed,
    accept,
  }
}

export type ProposedRig = Awaited<ReturnType<typeof proposedRigIn>>

/** Your base commit as accepted work, the lane started on it, and a first turn writing `a.txt`. */
export async function setUpTurn(rig: ProposedRig) {
  await rig.edit(rig.repoDir, "base.txt", "base\n")
  await rig.repoJj(["commit", "-m", "your base"])
  const base = await readCommits(rig.repoJj, "@-")
  const [line] = base
  if (line === undefined) throw new Error("no base")
  await rig.setUpAccepted()
  await rig.inLane(planBaseCheckout({ accepted: base, fresh: true }))
  await rig.inLane(
    planForkSetup(jjLaneFor(LANE), {
      kind: "accepted",
      point: pointFromCommit(line),
    }),
  )
  await rig.edit(rig.laneDir, "a.txt", "a\n")
  const first = await turnOn(rig.laneJj, { ...TURN, entry: entryId("e-1") })
  if (first === null) throw new Error("the first turn committed nothing")
  return { base, first }
}

/**
 * The rigs of one file. A set-up runs once, on a rig tagged `<key>-template`,
 * and each test copies its two directories, as a fork copies a lane: nothing
 * in them names their own path. What a set-up returns must be values a copy
 * keeps (commit ids), never a closure over the template's directories.
 */
export function laneRigs(repos: LaneRepos) {
  const templates = new Map<string, Promise<unknown>>()
  const copiedRig = async <X extends object>(
    key: string,
    tag: string,
    setUp: (rig: ProposedRig) => Promise<X>,
  ): Promise<ProposedRig & X> => {
    const template = `${key}-template`
    let made = templates.get(key) as Promise<X> | undefined
    if (made === undefined) {
      made = proposedRigIn(repos, template).then(setUp)
      templates.set(key, made)
    }
    const values = await made
    for (const side of ["yours", "lane"])
      await cp(
        path.join(repos.top, `${template}-${side}`),
        path.join(repos.top, `${tag}-${side}`),
        { recursive: true, verbatimSymlinks: true },
      )
    return { ...(await proposedRigIn(repos, tag, "copied")), ...values }
  }
  return {
    proposedRig: (tag: string) => proposedRigIn(repos, tag),
    /** `proposedRig`, then `setUpTurn`. */
    turnRig: (tag: string) => copiedRig("turn", tag, setUpTurn),
    copiedRig,
  }
}
