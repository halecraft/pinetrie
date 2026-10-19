import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  baseMessage,
  type CommitId,
  commitId,
  type EntryId,
  entryId,
  entryOfMessage,
  firstLine,
  type GetLatestRead,
  hasTrailer,
  NO_EDITOR,
  type ProposedSource,
  pointFromCommit,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  trailerRevset,
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
  laneShell,
  lines,
  NO_GRANTS,
  OLD_LANE_CONFIG_DIR,
  type Runner,
  run,
  type TouchedRevision,
} from "@pinetrie/lanes"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest"
import { acceptedFacts } from "./accepted.ts"
import {
  acceptedIn,
  acceptProposedChanges,
  buildProposedChanges,
  fetchLane,
  jjLaneFor,
  knownStart as knownStartOf,
  proposedTip,
} from "./fixtures.ts"
import { getLatestFiles, readGetLatest } from "./get-latest.ts"
import { laneBase } from "./lane/base.ts"
import { readLaneBookmark } from "./lane/bookmarks.ts"
import {
  conflictContent,
  conflictsIn,
  mergeBase,
  mergeUpdate,
  newestBase,
  revisionsIn,
} from "./lane/merge.ts"
import {
  bookmarkName,
  bookmarkRevset,
  DEFAULT_REPO,
  HOST_REMOTE,
  hostProposedRef,
  proposedBookmark,
  revsetName,
  stackBookmark,
} from "./lane/names.ts"
import {
  fetchById,
  planBaseCheckout,
  planForkSetup,
  planMerge,
  planOldNamesOnDisk,
  planUnfinishedCopy,
} from "./lane/plan.ts"
import {
  ACCEPTED_THREAD_COMMIT_ROW,
  changedPaths,
  commitTurn,
  copyFacts,
  oldNamesOnDisk,
  parseAcceptedThreadCommits,
  readCommits,
  readConflictedFiles,
} from "./lane/revisions.ts"
import { gatherLane } from "./lane-read.ts"
import {
  forgetSteps,
  IMPORT,
  immutableHeads,
  laneRefSteps,
  logRevset,
  markSteps,
  planAbandonProposed,
  planAcceptanceSteps,
  planDescribe,
  planGetLatestUndo,
  planProposedChanges,
  planPublishGetLatest,
  planPublishMove,
  planRebuildProposed,
  planRefreshProposed,
  planSetup,
} from "./plan.ts"
import {
  fileDiff,
  filesTouched,
  hostCommitIn,
  laneTipIn,
  proposedRevisions,
  readChangeId,
  readHostVersion,
  readProposedChanges,
  revisionRead,
  startOfProposed,
} from "./proposed.ts"
import {
  gatherAcceptance,
  gatherPlace,
  gatherProposedChanges,
  gatherStack,
} from "./proposed-gather.ts"
import { repairProposedChanges } from "./proposed-repair.ts"
import { jjFileBytes } from "./review-content.ts"
import {
  bytesFor,
  executeRepo,
  hostOps as runAsHost,
  hostJj as runAsYou,
} from "./run.ts"
import { readShared } from "./shared.ts"
import { git, host } from "./step.ts"

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
const hostJj = (root: string): Runner => guarded(runAsYou(root))
const hostOps = (root: string): Runner => guarded(runAsHost(root))
afterEach(() => {
  expect(tooLong.splice(0)).toEqual([])
})

const LANE = threadIdFor("1")
const NAME = "amber-fox" as ThreadName
const FORK = threadIdFor("2")
const ROOT = threadIdFor("3")
const TURN = { lane: LANE, title: "a turn" }

/** Where `LANE`'s proposed changes start, as commits: a test of an untraced start reads `startOfProposed` itself. */
const knownStart = (
  jj: Runner,
  input: Omit<Parameters<typeof knownStartOf>[1], "lane">,
) => knownStartOf(jj, { ...input, lane: LANE })

/** `commitTurn` with the lane's bookmark read first, as the host reads it. */
const turnOn = async (
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
const defaultLog = async (jj: Runner): Promise<string> =>
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
const onHost = (steps: readonly LaneStep[], dirs: Record<string, string>) =>
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
const LANE_CONFIG = path.relative(WORKSPACE_ROOT, LANE_JJ_CONFIG)

/**
 * jj on the repo at `dir`, with `config` as `JJ_CONFIG` gives it in a
 * container: by default the lane's own, at `dir`.
 */
const laneJjAt =
  (dir: string, config = path.join(dir, LANE_CONFIG)): Runner =>
  args =>
    run("jj", ["-R", dir, "--no-pager", "--color=never", ...args], {
      env: { ...NO_EDITOR, JJ_CONFIG: config },
    })

/**
 * What a copy of `pinetrie.json` grants, as far as these tests write one: its
 * personal ssh. The host's table decodes the rest.
 */
const sshAuthority = (text: string | null): LaneAuthority => ({
  grants: {
    ...NO_GRANTS,
    ssh:
      text !== null &&
      (JSON.parse(text) as { lanes?: { ssh?: { personal?: boolean } } }).lanes
        ?.ssh?.personal === true,
  },
  shared: [],
})

describe("a lane's repo, with jj", () => {
  let top = ""
  /** Git's variables as a lane has them: every repo ignores the lane's ignore file. */
  const GIT_IGNORE_VARS = [
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
  ] as const
  beforeAll(async () => {
    top = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-lanes-")))
    process.env.JJ_USER = "Probe"
    process.env.JJ_EMAIL = "probe@example.com"
    const ignore = path.join(top, "lane-git", "ignore")
    await mkdir(path.dirname(ignore), { recursive: true })
    await writeFile(ignore, laneIgnores([".plans"]))
    process.env.GIT_CONFIG_COUNT = "1"
    process.env.GIT_CONFIG_KEY_0 = "core.excludesFile"
    process.env.GIT_CONFIG_VALUE_0 = ignore
  })
  afterAll(async () => {
    for (const name of GIT_IGNORE_VARS) delete process.env[name]
    await rm(top, { recursive: true, force: true })
  })

  test("the whole life of a lane: base, turn, fetch, update, fork", async () => {
    const repoDir = path.join(top, "yours")
    const laneDir = path.join(top, "lane")
    const forkDir = path.join(top, "fork")
    const rootDir = path.join(top, "root-fork")
    await run("mkdir", ["-p", repoDir, laneDir])
    await run("jj", ["git", "init", "--colocate", repoDir])
    const repoJj = hostJj(repoDir)
    const repoOps = hostOps(repoDir)
    const laneJj = laneJjAt(laneDir)
    const runners = (dir: string) => ({
      lane: hostRunner(dir),
      laneBytes: hostBytesRunner(dir),
    })
    const inLane = (dir: string, steps: readonly LaneStep[]) =>
      executeOrThrow(
        onHost(steps, {
          "/mnt/host-working-copy": repoDir,
          "/workspace": dir,
        }),
        runners(dir),
      )
    /** The lane's commits into your repo, by bundle, as after a turn. */
    const fetchInto = (
      dir: string,
      lane: typeof LANE,
      have: readonly CommitId[],
    ) =>
      fetchLane(runners(dir), repoDir, {
        lane,
        have,
        bundle: path.join(top, `${lane}.bundle`),
      })

    // Your committed work: a file with three lines.
    await writeFile(path.join(repoDir, "shared.txt"), "one\ntwo\nthree\n")
    await repoJj(["commit", "-m", "your base"])
    const base = await readCommits(repoJj, "@-")
    expect(base).toHaveLength(1)

    // The base disk: git and jj initialized, your @- fetched by id, jj new.
    await inLane(laneDir, planBaseCheckout({ accepted: base, fresh: true }))
    await inLane(
      laneDir,
      planForkSetup(jjLaneFor(LANE), {
        kind: "recorded",
        points: base.map(pointFromCommit),
      }),
    )
    expect(await readFile(path.join(laneDir, "shared.txt"), "utf8")).toContain(
      "two",
    )
    expect(await readLaneBookmark(laneJj, LANE)).toBe(base[0])
    // The same change ids on both sides.
    expect(await readChangeId(laneJj, base[0] ?? "")).toBe(
      await readChangeId(repoOps, base[0] ?? ""),
    )

    // A turn that changed nothing records nothing; one that did, commits.
    const turn = { entry: entryId("e-1"), lane: LANE, title: "edit line two" }
    expect(await turnOn(laneJj, turn)).toBeNull()
    await writeFile(
      path.join(laneDir, "shared.txt"),
      "one\ntwo (lane)\nthree\n",
    )
    // A shared directory, as a lane's mount would put it: never committed.
    await mkdir(path.join(laneDir, ".plans"), { recursive: true })
    await writeFile(path.join(laneDir, ".plans", "a.md"), "a plan\n")
    const r1 = await turnOn(laneJj, turn)
    if (r1 === null) throw new Error("the turn committed nothing")
    expect(await readLaneBookmark(laneJj, LANE)).toBe(r1)
    const committed = await laneJj([
      "file",
      "list",
      "--ignore-working-copy",
      "-r",
      r1,
    ])
    expect(committed.stdout).toContain("shared.txt")
    expect(committed.stdout).not.toContain(".plans")
    // The turn's paths, from the lane's root, as its revision records them:
    // what jj says changed, from the bookmark before it.
    expect(await changedPaths(laneJj, base[0] ?? null, r1)).toEqual([
      "shared.txt",
    ])
    expect(await changedPaths(laneJj, null, r1)).toEqual(["shared.txt"])

    // Your repo fetches it by bundle, as the lane's remote bookmark: out of
    // your default log, and immutable with jj's builtin config, your commit
    // below it included.
    await fetchInto(laneDir, LANE, base)
    expect(await laneTipIn(repoOps, LANE)).toBe(r1)
    // The import is the host's operation, as every write of the host's is.
    expect(
      (await repoOps(["op", "log", "--no-graph", "-n", "1", "-T", "user"]))
        .stdout,
    ).toMatch(/^pinetrie-host@/)
    expect(await readCommits(repoJj, 'bookmarks(glob:"pinetrie/*")')).toEqual(
      [],
    )
    expect(await defaultLog(repoJj)).not.toContain("edit line two")
    expect((await repoJj(["describe", "-r", r1, "-m", "rewritten"])).ok).toBe(
      false,
    )
    // Nor can the lane rewrite what it inherited.
    expect(
      (await laneJj(["describe", "-r", base[0] ?? "", "-m", "x"])).ok,
    ).toBe(false)

    // You change the same line on a WIP, and commit.
    await repoJj(["new"])
    await writeFile(path.join(repoDir, "shared.txt"), "one\ntwo (you)\nthree\n")
    await repoJj(["commit", "-m", "you edit line two"])
    await repoJj(["bookmark", "create", "wip/x", "-r", "@-"])
    const unfinishedNow = async () => {
      const [commit] = await readCommits(repoJj, "wip/x")
      if (commit === undefined) throw new Error("no wip")
      return { bookmark: "wip/x", commit, under: base[0] ?? commit }
    }

    // An update: a copy of the WIP made in the lane, on accepted commit
    // under it, merged; accepted work conflicts.
    const unfinished1 = await unfinishedNow()
    await inLane(laneDir, [
      fetchById([unfinished1.commit, unfinished1.under]),
      ...planUnfinishedCopy(unfinished1, unfinished1.under),
    ])
    const [copy] = await readCommits(laneJj, "@-")
    if (copy === undefined) throw new Error("no copy")
    expect(
      (await laneJj(["file", "show", "-r", copy, 'root:"shared.txt"'])).stdout,
    ).toContain("two (you)")
    // The copy is no commit of yours: your WIP stays yours.
    expect(
      await readCommits(laneJj, `${copy} & ${unfinished1.commit}`),
    ).toEqual([])
    expect(await newestBase(laneJj, copy, "wip/")).toEqual({
      at: copy,
      kind: "unfinished",
      bookmark: "wip/x",
      commit: unfinished1.commit,
    })
    const { ours, merge } = await mergeBase(laneJj, LANE, copy, "update: wip/x")
    expect(merge).not.toBeNull()
    expect(await conflictsIn(laneJj)).toEqual(["shared.txt"])
    expect(await conflictContent(laneJj, "shared.txt")).toContain("<<<<<<<")
    expect(
      (await revisionsIn(laneJj, `${copy}..${ours}`, ["shared.txt"])).map(r =>
        entryOfMessage(r.description),
      ),
    ).toEqual(["e-1"])
    expect(
      (await revisionsIn(laneJj, `${ours}..${copy}`, ["shared.txt"])).map(
        r => r.description.split("\n")[0],
      ),
    ).toEqual(["copy of wip/x"])

    // The agent resolves; the resolution is a turn; nothing conflicts.
    await writeFile(
      path.join(laneDir, "shared.txt"),
      "one\ntwo (you, and lane)\nthree\n",
    )
    const resolved = await turnOn(laneJj, {
      ...turn,
      entry: entryId("e-2"),
    })
    if (resolved === null) throw new Error("the resolution committed nothing")
    expect(await conflictsIn(laneJj)).toEqual([])
    // Updating again finds the WIP already there.
    expect(
      (await mergeBase(laneJj, LANE, copy, "update: wip/x")).merge,
    ).toBeNull()

    // A clean update: the merge is committed even with nothing to resolve,
    // so the lane's newest revision holds your work, and its own.
    await writeFile(path.join(laneDir, "lane-only.txt"), "lane\n")
    await turnOn(laneJj, { ...turn, entry: entryId("e-3") })
    await repoJj(["new"])
    await writeFile(path.join(repoDir, "yours-only.txt"), "yours\n")
    await repoJj(["commit", "-m", "you add a file"])
    await repoJj(["bookmark", "move", "wip/x", "--to", "@-"])
    // The next copy sits on the last one: the merge brings in only what
    // the WIP changed since, not accepted work two the lane already resolved.
    const unfinished2 = await unfinishedNow()
    await inLane(laneDir, [
      fetchById([unfinished2.commit]),
      ...planUnfinishedCopy(unfinished2, copy),
    ])
    const [cleanCopy] = await readCommits(laneJj, "@-")
    if (cleanCopy === undefined) throw new Error("no copy")
    const updated = await mergeBase(laneJj, LANE, cleanCopy, "update: wip/x")
    expect(updated.merge).not.toBeNull()
    expect(await conflictsIn(laneJj)).toEqual([])
    const newest = await readLaneBookmark(laneJj, LANE)
    expect(
      (
        await readCommits(
          laneJj,
          `(${cleanCopy} | ${updated.ours}) & ::${newest}`,
        )
      ).sort(),
    ).toEqual([cleanCopy, updated.ours].sort())

    // A fork: the lane's whole directory cloned, ignored files too, then its
    // own change on the fork commit. Both sides then work on.
    await writeFile(path.join(laneDir, "cache.bin"), "ignored state\n")
    await writeFile(path.join(laneDir, ".gitignore"), "cache.bin\n")
    const point = await turnOn(laneJj, { ...turn, entry: entryId("e-4") })
    if (point === null) throw new Error("the fork point committed nothing")
    await fetchInto(laneDir, LANE, [r1])
    await cp(laneDir, forkDir, { recursive: true, verbatimSymlinks: true })
    await inLane(
      forkDir,
      planForkSetup(jjLaneFor(FORK), {
        kind: "recorded",
        points: [point].map(pointFromCommit),
      }),
    )
    const forkJj = laneJjAt(forkDir)
    expect(await readFile(path.join(forkDir, "cache.bin"), "utf8")).toBe(
      "ignored state\n",
    )

    await writeFile(path.join(laneDir, "shared.txt"), "parent\n")
    const parentNext = await turnOn(laneJj, {
      ...turn,
      entry: entryId("e-5"),
    })
    await writeFile(path.join(forkDir, "shared.txt"), "fork\n")
    const forkNext = await turnOn(forkJj, {
      ...turn,
      lane: FORK,
      entry: entryId("e-6"),
    })
    if (parentNext === null || forkNext === null)
      throw new Error("a turn committed nothing")
    await fetchInto(laneDir, LANE, [point])
    await fetchInto(forkDir, FORK, [point])
    // Your repo sees two changes, never one divergent change.
    expect(await readCommits(repoJj, "divergent()")).toEqual([])
    expect(await laneTipIn(repoOps, FORK)).toBe(forkNext)
    // The fork's writes never reach its parent.
    expect(await readFile(path.join(laneDir, "shared.txt"), "utf8")).toBe(
      "parent\n",
    )
    // The fork cannot rewrite what it inherited.
    expect((await forkJj(["describe", "-r", point, "-m", "x"])).ok).toBe(false)

    // A root fork from a copy of the WIP: it sees the WIP's
    // files, and its work back in your repo makes nothing divergent.
    await cp(laneDir, rootDir, { recursive: true, verbatimSymlinks: true })
    await inLane(
      rootDir,
      planForkSetup(jjLaneFor(ROOT), {
        kind: "unfinished",
        ...(await unfinishedNow()),
      }),
    )
    const rootJj = laneJjAt(rootDir)
    expect(await readFile(path.join(rootDir, "yours-only.txt"), "utf8")).toBe(
      "yours\n",
    )
    const [rootCopy] = await readCommits(
      rootJj,
      `bookmarks(exact:"pinetrie/${ROOT}")`,
    )
    // Its fork point is immutable in the lane.
    expect(
      (await rootJj(["describe", "-r", rootCopy ?? "", "-m", "x"])).ok,
    ).toBe(false)
    // Only in the lane's repo: another repo under the same config lacks the
    // fork point, and would fail every command if the config reached it.
    const scratch = path.join(top, "scratch")
    await run("jj", ["git", "init", scratch])
    expect(
      (
        await laneJjAt(
          scratch,
          path.join(rootDir, LANE_CONFIG),
        )(["commit", "-m", "x"])
      ).ok,
    ).toBe(true)
    await writeFile(path.join(rootDir, "root.txt"), "root\n")
    await turnOn(rootJj, { ...turn, lane: ROOT, entry: entryId("e-7") })
    await fetchInto(rootDir, ROOT, [])
    expect(await readCommits(repoJj, "divergent()")).toEqual([])
  }, 60_000)

  /**
   * The names of a revision's files, all at its root here. jj prints each path
   * from the process's directory, not `-R`'s.
   */
  const filesAt = async (jj: Runner, rev: string) =>
    lines((await jj(["file", "list", "-r", rev])).stdout).map(f =>
      path.basename(f),
    )

  // The agent commits in a turn, with jj or with git. The turn's revision is
  // its commit: the proposed changes hold it, and a branch at that turn starts
  // with it.
  for (const how of ["jj", "git"] as const)
    test(`a commit the agent makes itself is the turn's revision (${how})`, async () => {
      const { laneDir, laneJj, ops, inLane, fetch, edit, base, first } =
        await turnRig(`self-${how}`)
      await edit(laneDir, "b.txt", "b\n")
      if (how === "jj") await laneJj(["commit", "-m", "mine"])
      else {
        const who = {
          GIT_AUTHOR_NAME: "Agent",
          GIT_AUTHOR_EMAIL: "agent@example.com",
          GIT_COMMITTER_NAME: "Agent",
          GIT_COMMITTER_EMAIL: "agent@example.com",
        }
        await run("git", ["-C", laneDir, "add", "b.txt"], { env: who })
        const made = await run("git", ["-C", laneDir, "commit", "-m", "mine"], {
          env: who,
        })
        expect(made.ok, made.stderr).toBe(true)
      }
      const turn = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
      const [mine] = await readCommits(
        laneJj,
        `description(exact:"mine\n") & ::@`,
      )
      expect(turn).toBe(mine)
      expect(await readLaneBookmark(laneJj, LANE)).toBe(mine)

      // The proposed changes: your repo fetches the lane's bookmark, which
      // holds b.txt.
      await fetch(base)
      const tip = await laneTipIn(ops, LANE)
      expect(await filesAt(ops, tip ?? "none()")).toContain("b.txt")

      // A branch at that turn: the lane's disk cloned, then `jj new` on the
      // turn's commit, or the one before it when the turn recorded none.
      const forkDir = path.join(top, `self-${how}-fork`)
      await cp(laneDir, forkDir, { recursive: true, verbatimSymlinks: true })
      await inLane(
        planForkSetup(jjLaneFor(FORK), {
          kind: "recorded",
          points: [turn ?? first].map(pointFromCommit),
        }),
        forkDir,
      )
      expect(await readFile(path.join(forkDir, "b.txt"), "utf8")).toBe("b\n")
    }, 60_000)

  test("an update in jj, end to end: clean, conflicted, nothing, a move to accepted work, and a WIP's copies", async () => {
    const {
      repoDir,
      laneDir,
      repoJj,
      laneJj,
      line,
      edit,
      setUpAccepted,
      acceptedNow,
    } = await proposedRig("update")
    const dirs = { "/mnt/host-working-copy": repoDir, "/workspace": laneDir }
    // The lane's runners as a lane has them: its root and your working copy
    // where the steps name them.
    const runners = {
      lane: (args: readonly string[]) =>
        hostRunner(laneDir)(
          onHost([{ in: "lane", argv: args }], dirs)[0]?.argv ?? args,
        ),
      laneBytes: hostBytesRunner(laneDir),
    }
    const acceptedMerge = async (mark = false) =>
      planMerge(jjLaneFor(LANE), {
        kind: "accepted",
        point: pointFromCommit(await acceptedNow()),
        mark,
      })
    const commitInRepo = async (file: string, text: string, title: string) => {
      await edit(repoDir, file, text)
      await repoJj(["commit", "-m", title])
    }
    const moveAccepted = () =>
      repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const titled = (revisions: readonly TouchedRevision[]) =>
      revisions.map(r => ({
        title: firstLine(r.description, 200),
        paths: r.paths,
      }))
    const baseOfLane = () =>
      laneBase(laneJj, bookmarkRevset(bookmarkName(LANE)), line)
    /** jj on the lane's repo from its root, so the paths it prints are the repo's. */
    const laneRoot: Runner = args =>
      run("jj", ["-R", laneDir, "--ignore-working-copy", ...args], {
        cwd: laneDir,
      })
    /** The lane's head now. */
    const head = async (): Promise<CommitId> => {
      const at = await readLaneBookmark(laneJj, LANE)
      if (at === null) throw new Error("no lane head")
      return at
    }

    await edit(repoDir, "a.txt", "a\n")
    await edit(repoDir, "b.txt", "b\n")
    await commitInRepo("c.txt", "c\n", "your base")
    await setUpAccepted()
    const [base] = await readCommits(repoJj, "@-")
    if (base === undefined) throw new Error("no base")
    await executeOrThrow(
      planBaseCheckout({ accepted: [base], fresh: true }),
      runners,
    )
    await executeOrThrow(
      planForkSetup(jjLaneFor(LANE), {
        kind: "recorded",
        points: [base].map(pointFromCommit),
      }),
      runners,
    )
    // A lane from before accepted work has no `Pinetrie-Base`; its own repo has no
    // line bookmark to find a start on.
    expect(await baseOfLane()).toBeNull()

    // (a) Clean: the lane changed b.txt, you changed a.txt and c.txt.
    await edit(laneDir, "b.txt", "b (lane)\n")
    await turnOn(laneJj, { ...TURN, entry: entryId("e-1") })
    await commitInRepo("a.txt", "a (yours)\n", "yours one")
    await commitInRepo("c.txt", "c (yours)\n", "yours two\n\nwith a body")
    await moveAccepted()
    const line1 = await acceptedNow()
    const before = await head()
    const clean = await mergeUpdate(
      laneJj,
      runners,
      LANE,
      await acceptedMerge(),
    )
    expect(clean).toMatchObject({
      kind: "clean",
      from: line1,
      commits: ["yours two", "yours one"],
    })
    if (clean.kind !== "clean") throw new Error("not clean")
    expect([...clean.files].sort()).toEqual(["a.txt", "c.txt"])
    // What `getLatestFiles` said catching up would change, it changed.
    expect(
      (
        await getLatestFiles(laneRoot, {
          holds: [base],
          to: line1,
          tip: before,
        })
      )?.sort(),
    ).toEqual(["a.txt", "c.txt"])
    expect(await baseOfLane()).toEqual({
      base: { kind: "accepted" },
      start: line1,
      source: line1,
    })

    // (b) Conflicted, on two files: each revision with only the conflicted
    // files it touched.
    await edit(laneDir, "a.txt", "a (lane)\n")
    await turnOn(laneJj, { ...TURN, title: "lane a", entry: entryId("e-2") })
    await edit(laneDir, "b.txt", "b (lane, again)\n")
    await turnOn(laneJj, { ...TURN, title: "lane b", entry: entryId("e-3") })
    await commitInRepo("a.txt", "a (yours, again)\n", "yours a")
    await edit(repoDir, "c.txt", "c (yours, again)\n")
    await commitInRepo("b.txt", "b (yours)\n", "yours b and c")
    await moveAccepted()
    const conflicted = await mergeUpdate(
      laneJj,
      runners,
      LANE,
      await acceptedMerge(),
    )
    if (conflicted.kind !== "conflicted") throw new Error("not conflicted")
    expect(conflicted.contents.map(c => c.path)).toEqual(["a.txt", "b.txt"])
    expect(conflicted.contents.every(c => c.content.includes("<<<<<<<"))).toBe(
      true,
    )
    expect(titled(conflicted.ours)).toEqual([
      { title: "a turn", paths: ["b.txt"] },
      { title: "lane a", paths: ["a.txt"] },
      { title: "lane b", paths: ["b.txt"] },
    ])
    expect(titled(conflicted.theirs)).toEqual([
      { title: "yours a", paths: ["a.txt"] },
      { title: "yours b and c", paths: ["b.txt"] },
    ])

    // (c) Nothing to merge: no mark, unless the thread moves to accepted work.
    await edit(laneDir, "a.txt", "a (both)\n")
    await edit(laneDir, "b.txt", "b (both)\n")
    await turnOn(laneJj, { ...TURN, title: "resolved", entry: entryId("e-4") })
    const ours = await readLaneBookmark(laneJj, LANE)
    expect(
      await mergeUpdate(laneJj, runners, LANE, await acceptedMerge()),
    ).toEqual({ kind: "nothing", ours, mark: null })
    const moved = await mergeUpdate(
      laneJj,
      runners,
      LANE,
      await acceptedMerge(true),
    )
    if (moved.kind !== "nothing" || moved.mark === null)
      throw new Error("no mark")
    expect(await readLaneBookmark(laneJj, LANE)).toBe(moved.mark)
    expect(
      await newestBase(laneJj, bookmarkRevset(bookmarkName(LANE)), "wip/"),
    ).toEqual({
      at: moved.mark,
      kind: "accepted",
      commit: await acceptedNow(),
    })

    // (d) A WIP's copy, then the next on it: a commit only the lane has.
    const line2 = await acceptedNow()
    await repoJj(["new", line2])
    await commitInRepo("w.txt", "w1\n", "wip one")
    await repoJj(["bookmark", "create", "wip/x", "-r", "@-"])
    const [w1] = await readCommits(repoJj, "@-")
    if (w1 === undefined) throw new Error("no wip")
    const unfinishedMerge = (commit: CommitId, on: CommitId) =>
      planMerge(jjLaneFor(LANE), {
        kind: "unfinished",
        bookmark: "wip/x",
        commit,
        under: line2,
        on: pointFromCommit(on),
      })
    const beforeFirst = await head()
    const first = await mergeUpdate(
      laneJj,
      runners,
      LANE,
      unfinishedMerge(w1, line2),
    )
    expect(first).toMatchObject({
      kind: "clean",
      files: ["w.txt"],
      commits: ["wip one"],
    })
    if (first.kind !== "clean") throw new Error("not clean")
    expect(
      await getLatestFiles(laneRoot, {
        holds: [line2],
        to: w1,
        tip: beforeFirst,
      }),
    ).toEqual(["w.txt"])
    await commitInRepo("w.txt", "w2\n", "wip two")
    await repoJj(["bookmark", "move", "wip/x", "--to", "@-"])
    const [w2] = await readCommits(repoJj, "@-")
    if (w2 === undefined) throw new Error("no wip")
    expect(await readCommits(repoJj, `present(${first.from})`)).toEqual([])
    const beforeNext = await head()
    const next = await mergeUpdate(
      laneJj,
      runners,
      LANE,
      unfinishedMerge(w2, first.from),
    )
    expect(next).toMatchObject({
      kind: "clean",
      files: ["w.txt"],
      commits: ["wip two", "wip one"],
    })
    if (next.kind !== "clean") throw new Error("not clean")
    expect(await readCommits(laneJj, `${next.from}-`)).toEqual([first.from])
    // From the lane's copy, the WIP's base start, to the WIP's commit.
    expect(
      await getLatestFiles(laneRoot, {
        holds: [first.from],
        to: w2,
        tip: beforeNext,
      }),
    ).toEqual(["w.txt"])
  }, 60_000)

  test("an update merges on an adopted commit; a stack's commits are never adopted", async () => {
    const {
      laneDir,
      repoJj,
      repoDir,
      laneJj,
      inLane,
      edit,
      base,
      acceptedNow,
    } = await turnRig("adopt")
    await edit(laneDir, "b.txt", "b\n")
    await laneJj(["commit", "-m", "mine"])
    const mine = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (mine === null) throw new Error("the agent's commit was not adopted")

    // An update merges accepted work into the lane at its bookmark: on the
    // agent's commit, so the merge keeps b.txt.
    await edit(repoDir, "yours.txt", "yours\n")
    await repoJj(["commit", "-m", "you add a file"])
    await repoJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
    const line = await acceptedNow()
    await inLane([fetchById([line])])
    const { ours, merge } = await mergeBase(laneJj, LANE, line, "update")
    expect(ours).toBe(mine)
    expect(await filesAt(laneJj, merge ?? "none()")).toEqual(
      expect.arrayContaining(["b.txt", "yours.txt"]),
    )

    // A stack, as a split builds one: revisions on the proposed changes' start,
    // below the lane's bookmark, under a bookmark of their own. No turn adopts
    // them, so the lane's own bookmark stays where it was.
    await laneJj(["new", base[0] ?? ""])
    await edit(laneDir, "s.txt", "s\n")
    await laneJj(["commit", "-m", "s1: s.txt"])
    await laneJj(["bookmark", "set", stackBookmark(LANE), "-r", "@-"])
    expect(await turnOn(laneJj, { ...TURN, entry: entryId("e-3") })).toBeNull()
    expect(await readLaneBookmark(laneJj, LANE)).toBe(merge)
  }, 60_000)

  test("a review reads proposed changes' commit: its description, files and one file's diff", async () => {
    const { laneDir, repoDir, repoJj, ops, laneJj, fetch, edit, build, base } =
      await turnRig("review")
    const reads = { jj: ops, jjBytes: bytesFor(repoDir, "host") }
    // An image: its row is media, with its size, read from its bytes.
    const PNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1,
    ])
    await writeFile(path.join(laneDir, "a.png"), PNG)
    // Names the template and the fileset must quote, a file under a
    // directory, and a rename.
    await run("mkdir", ["-p", path.join(laneDir, "dir")])
    await edit(laneDir, "a b.txt", "space\n")
    await edit(laneDir, 'we"ird', "quote\n")
    await edit(laneDir, "dir/f.txt", "under\n")
    await edit(laneDir, "a.txt", "a\nmore\n")
    // A grant the base's copy does not make: a widening, once accepted.
    await edit(
      laneDir,
      "pinetrie.json",
      JSON.stringify({ lanes: { ssh: { personal: true } } }),
    )
    await run("mv", [
      path.join(laneDir, "base.txt"),
      path.join(laneDir, "moved.txt"),
    ])
    await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    await fetch(base)
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const proposed = await build([
      { commit: tip, description: "feat: lane\n\nwhy\n" },
    ])
    const [w] = proposed.commits
    const [changeId] = proposed.changeIds
    if (w === undefined || changeId === undefined)
      throw new Error("no proposed changes")

    const span = { kind: "revision", commit: w } as const
    const read = await revisionRead(reads, span, sshAuthority)
    expect(read).toEqual({
      description: "feat: lane\n\nwhy\n",
      files: expect.arrayContaining([
        {
          path: "a b.txt",
          shown: "a b.txt",
          change: "added",
          added: 1,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: 'we"ird',
          shown: 'we"ird',
          change: "added",
          added: 1,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "dir/f.txt",
          shown: "dir/f.txt",
          change: "added",
          added: 1,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "a.txt",
          shown: "a.txt",
          change: "added",
          added: 2,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "moved.txt",
          shown: "{base.txt => moved.txt}",
          change: "renamed",
          added: 0,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "a.png",
          shown: "a.png",
          change: "added",
          added: 0,
          removed: 0,
          content: {
            kind: "media",
            before: null,
            after: { content: "image/png", size: 10 },
          },
        },
      ]),
      widenings: [{ kind: "ssh" }],
    })
    expect(await fileDiff(ops, span, 'we"ird')).toContain("+quote")
    expect(await fileDiff(ops, span, "a b.txt")).toContain("+space")
    // An image's bytes, typed by them; none where the side holds no file.
    const png = await jjFileBytes(reads.jjBytes, w, "a.png")
    const served: Uint8Array[] = []
    for await (const c of png?.bytes ?? []) served.push(c)
    expect([png?.content, Buffer.concat(served)]).toEqual(["image/png", PNG])
    expect(await jjFileBytes(reads.jjBytes, `${w}-`, "a.png")).toBeNull()
    // One file exactly: a directory's name names none of its files.
    expect(await fileDiff(ops, span, "dir")).toBe("")
    expect(await fileDiff(ops, span, "dir/f.txt")).toContain("+under")

    // A range reads the same files, with no description, its counts from
    // the range's git diff: here the range is the revision.
    const [parent] = await readCommits(ops, `${w}-`)
    if (parent === undefined) throw new Error("no parent")
    const range = { kind: "range", from: parent, to: w } as const
    const byPath = (r: unknown) =>
      [...((r as { files: { path: string }[] } | null)?.files ?? [])].sort(
        (a, b) => a.path.localeCompare(b.path),
      )
    const ranged = await revisionRead(reads, range, sshAuthority)
    expect(ranged).toMatchObject({
      description: "",
      widenings: [{ kind: "ssh" }],
    })
    expect(byPath(ranged)).toEqual(byPath(read))
    expect(await fileDiff(ops, range, 'we"ird')).toContain("+quote")

    // You reword the proposed changes: its commit changes, and the review of
    // the new one reads your words. `readProposedChanges` finds it by its
    // bookmark.
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      changeId,
      "-m",
      "feat: as I want it",
    ])
    const facts = await readProposedChanges(ops, {
      name: NAME,
      target: "pinetrie-accepted",
    })
    const [now] = facts?.kind === "present" ? facts.revisions : []
    if (now === undefined) throw new Error("no commit")
    expect(now.commit).not.toBe(w)
    expect(
      await revisionRead(
        reads,
        { kind: "revision", commit: now.commit },
        sshAuthority,
      ),
    ).toMatchObject({
      description: "feat: as I want it\n",
    })
    expect(
      await revisionRead(
        reads,
        { kind: "revision", commit: commitId("1".repeat(40)) },
        sshAuthority,
      ),
    ).toBeNull()
  }, 60_000)

  /**
   * Your repo and one lane's, in `top/<tag>-…`, with the lane's steps run on
   * the host. Its proposed changes are built and accepted by the steps the port
   * suite's harness shares (`fixtures.ts`); `proposed` and `accept` check
   * after each that the batched read agrees (`agrees`).
   */
  const proposedRig = async (tag: string) => {
    const repoDir = path.join(top, `${tag}-yours`)
    const laneDir = path.join(top, `${tag}-lane`)
    await run("mkdir", ["-p", repoDir, laneDir])
    await run("jj", ["git", "init", "--colocate", repoDir])
    const repoJj = hostJj(repoDir)
    const ops = hostOps(repoDir)
    const laneJj = laneJjAt(laneDir)
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
        bundle: path.join(top, `${tag}.bundle`),
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
    const build = (
      sources: readonly ProposedSource[],
      name: ThreadName = NAME,
    ) =>
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
      return mergeUpdate(laneJjAt(dir), runnersAt(dir), lane, {
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
      await agrees()
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
      await agrees()
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

  /** `proposedRig`, with your base commit as accepted work, the lane started on it, and a first turn writing `a.txt`. */
  const turnRig = async (tag: string) => {
    const rig = await proposedRig(tag)
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
    return { ...rig, base, first }
  }

  test("proposed changes on accepted work: built, immutable, refreshed, followed, accepted by a forward move, and the next one", async () => {
    const {
      repoDir,
      laneDir,
      repoJj,
      ops,
      laneJj,
      line,
      fetch,
      edit,
      build,
      acceptedNow,
      accept,
      proposed,
      base,
      agrees,
    } = await turnRig("proposed")
    const bookmark = proposedBookmark(NAME)
    await fetch(base)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You work on above accepted work: your stack is yours, and mutable.
    await edit(repoDir, "c.txt", "c yours\n")
    await repoJj(["commit", "-m", "yours: c.txt"])
    await edit(repoDir, "wip.txt", "wip\n")

    // Built by the host on accepted work: immutable, so you cannot edit it by
    // accident; the host's own rewrites pass `--ignore-immutable`.
    const one = await build([
      {
        commit: t1,
        description: `proposed changes: lane\n\nPinetrie-Source: ${t1}\nPinetrie-Start: ${base[0]}\n`,
      },
    ])
    const [c1] = one.changeIds
    const [w1] = one.commits
    if (c1 === undefined || w1 === undefined)
      throw new Error("no proposed changes")
    expect(one.read).toMatchObject({
      files: ["a.txt"],
      onTarget: true,
      placed: true,
      // Its ledger, read from its message: no record needed.
      ledger: { source: t1, start: base },
    })
    expect((await repoJj(["describe", "-r", c1, "-m", "mine"])).ok).toBe(false)
    // Yet your log shows it: setup added the proposed changes to `revsets.log`,
    // since jj's default leaves an immutable head out.
    expect(
      (
        await repoJj([
          "log",
          "--no-graph",
          "-T",
          'description.first_line() ++ "\\n"',
        ])
      ).stdout,
    ).toContain("proposed changes: lane")
    expect(
      (await readCommits(repoJj, `${c1} & immutable()`)).length,
    ).toBeGreaterThan(0)
    expect(
      (
        await readCommits(
          repoJj,
          `description(exact:"yours: c.txt\n") & mutable()`,
        )
      ).length,
    ).toBe(1)
    await executeRepo(repoDir, planDescribe(c1, "proposed changes: described"))

    // The host rewrote it, and nothing recorded that: its newest version is
    // the host's, so it is not yours.
    const sinceNow = async () => {
      const read = await readProposedChanges(ops, {
        name: NAME,
        target: await acceptedNow(),
      })
      return read?.kind === "present" ? read.revisions.map(r => r.since) : null
    }
    expect(await sinceNow()).toEqual([{ reached: true, othersChanged: false }])
    // Your reword of the proposed changes, on purpose: a change of yours, an
    // edit.
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      c1,
      "-m",
      "as I want",
    ])
    expect(await sinceNow()).toEqual([{ reached: true, othersChanged: true }])
    await executeRepo(
      repoDir,
      planDescribe(c1, `proposed changes: lane\n\nPinetrie-Source: ${t1}\n`),
    )

    // A race: your edit and a host rewrite from the same operation make it
    // divergent. The host keeps yours.
    const opNow = async () =>
      (
        await repoJj([
          "op",
          "log",
          "--ignore-working-copy",
          "--no-graph",
          "-n",
          "1",
          "-T",
          "id",
        ])
      ).stdout.trim()
    const op = await opNow()
    await repoJj(["describe", "--ignore-immutable", "-r", c1, "-m", "yours"])
    await ops([
      "--at-operation",
      op,
      "--ignore-immutable",
      "describe",
      "-r",
      c1,
      "-m",
      `proposed changes: lane\n\nPinetrie-Source: ${t1}\n\nhost`,
    ])
    // Divergent: the batched read says so too.
    await agrees()
    const split = await hostCommitIn(
      ops,
      c1,
      await readHostVersion(ops, bookmark),
    )
    if (split === null) throw new Error("no split")
    await repairProposedChanges(
      { jj: ops, execute: steps => executeRepo(repoDir, steps) },
      { bookmark, changeIds: [c1] },
    )
    // Repaired: yours, edited.
    await agrees()
    expect(await readCommits(repoJj, "divergent()")).toEqual([])
    expect(await readCommits(repoJj, `bookmarks(exact:"${bookmark}")`)).toEqual(
      [split.other],
    )
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      c1,
      "-m",
      // As the host writes it: so the next proposed changes' revisions are told
      // from this one, accepted, by its base, not its trailer.
      `proposed changes: lane\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${t1}\n`,
    ])

    // Accept: accepted work moved forward to the proposed changes, as the host;
    // your @ and the working copy untouched; the proposed changes' bookmark
    // gone.
    const atBefore = await readCommits(repoJj, "@")
    await accept({ built: one })
    expect(await readCommits(repoJj, "@")).toEqual(atBefore)
    expect(await readFile(path.join(repoDir, "wip.txt"), "utf8")).toBe("wip\n")
    expect(await readChangeId(ops, await acceptedNow())).toBe(c1)
    expect(
      await readCommits(ops, `present(bookmarks(exact:"${bookmark}"))`),
    ).toEqual([])
    // jj itself refuses an acceptance that is not forward.
    expect(
      (
        await ops([
          "bookmark",
          "move",
          line.acceptedBookmark,
          "--to",
          base[0] ?? "",
        ])
      ).ok,
    ).toBe(false)

    // You land work of your own on accepted work, changing what you accepted.
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "a.txt", "a, then yours\n")
    await repoJj(["commit", "-m", "yours: a.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])

    // The next turn: its proposed changes start at what the accepted thread
    // commit's Pinetrie-Source names, and holds only what came after; it does
    // not bring a.txt back.
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (t2 === null) throw new Error("no turn")
    const next = await proposed([t1])
    expect(next.files).toEqual(["b.txt"])
    expect(next.conflicted).toBe(false)
    // You reword your commit under it: jj rebases the proposed changes, as your
    // operation, but changes nothing in it, so it is not yours.
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      line.acceptedBookmark,
      "-m",
      "yours: a.txt, reworded",
    ])
    expect(await sinceNow()).toEqual([{ reached: true, othersChanged: false }])

    // The lane moves on: the proposed changes are rebuilt from it in place, its
    // change kept, holding what a fresh build would.
    await edit(laneDir, "f.txt", "f\n")
    const t3 = await turnOn(laneJj, { ...TURN, entry: entryId("e-3") })
    if (t3 === null) throw new Error("no turn")
    await fetch([t2])
    const [nc] = next.built.changeIds
    if (nc === undefined) throw new Error("no proposed changes")
    const b3 = await laneBase(ops, t3, line)
    if (b3 === null) throw new Error("no base")
    await executeRepo(
      repoDir,
      planRebuildProposed({
        changeId: nc,
        start: await knownStart(ops, { tip: t3, base: b3, repoConfig: line }),
        tip: t3,
        target: await acceptedNow(),
        description: `WIP\n\nPinetrie-Source: ${t3}\n`,
      }),
    )
    const [followed] = await readCommits(ops, `change_id(${nc})`)
    expect(
      lines((await ops(["diff", "-r", followed ?? "", "--name-only"])).stdout),
    ).toEqual(["b.txt", "f.txt"])
    expect(await readCommits(ops, `${followed} & conflicts()`)).toEqual([])
    await agrees()

    // A stack: one revision per lane revision, each with its own file.
    await executeRepo(repoDir, planAbandonProposed(next.built.changeIds))
    await laneJj(["new", t2])
    await edit(laneDir, "d.txt", "d\n")
    await laneJj(["commit", "-m", "s1: d.txt"])
    await edit(laneDir, "e.txt", "e\n")
    await laneJj(["commit", "-m", "s2: e.txt"])
    const [s1] = await readCommits(laneJj, "@--")
    const [s2] = await readCommits(laneJj, "@-")
    if (s1 === undefined || s2 === undefined) throw new Error("no stack")
    await laneJj([
      "bookmark",
      "set",
      "--allow-backwards",
      `pinetrie/${LANE}`,
      "-r",
      s2,
    ])
    await fetch([t2])
    // Each revision names its thread, as the host writes it: found by that,
    // above the accepted proposed changes and your commit under it, which are
    // on accepted work.
    const ours = `Pinetrie-Thread: ${NAME}\nPinetrie-Source: ${t2}`
    const stack = await build([
      { commit: s1, description: `s1: d.txt\n\n${ours}\n` },
      { commit: s2, description: `s2: e.txt\n\n${ours}\n` },
    ])
    expect(stack.read).toMatchObject({ chained: true })
    await agrees()
    const per = await Promise.all(
      stack.commits.map(async c =>
        lines((await ops(["diff", "-r", c, "--name-only"])).stdout),
      ),
    )
    expect(per).toEqual([["b.txt", "d.txt"], ["e.txt"]])
  }, 60_000)

  test("a squash of two accepted proposed changes keep both sources: the next proposed changes start above them", async () => {
    const {
      laneDir,
      repoJj,
      ops,
      edit,
      proposed,
      accept,
      turn,
      acceptedNow,
      base,
    } = await turnRig("squashed")
    const first = await proposed(base)
    await accept(first)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turn()
    const second = await proposed([t1])
    await accept(second)
    // You squash the two accepted proposed changes, as jj's editor offers both
    // messages.
    const line = await acceptedNow()
    const ran = await run(
      "jj",
      [
        "-R",
        (await repoJj(["root"])).stdout.trim(),
        "squash",
        "--ignore-immutable",
        "--from",
        line,
        "--into",
        `${line}-`,
      ],
      { env: { ...NO_EDITOR, JJ_EDITOR: "true" } },
    )
    expect(ran.ok, ran.stderr).toBe(true)
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    expect((await proposed([t2])).files).toEqual(["c.txt"])
    expect(await readCommits(ops, "divergent()")).toEqual([])
  }, 60_000)

  test("proposed changes after a catch-up start at accepted work it merged, not at what you accepted below it", async () => {
    const {
      laneDir,
      repoDir,
      repoJj,
      ops,
      line,
      edit,
      proposed,
      accept,
      turn,
      update,
      acceptedNow,
      base,
    } = await turnRig("caught-up")
    await accept(await proposed(base))
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You change accepted work you accepted into, then the lane catches up
    // with it: the accepted thread commit is joined to the lane's commit, so
    // the merge is clean, and the lane has your text.
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "a.txt", "a, then yours\n")
    await repoJj(["commit", "-m", "yours: a.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    expect(await update()).toEqual([])
    expect(await readFile(path.join(laneDir, "a.txt"), "utf8")).toBe(
      "a, then yours\n",
    )
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    // The accepted source is below accepted work the lane merged: the proposed
    // changes start there alone, and holds only what came after.
    const after = await proposed([t1])
    expect([after.conflicted, after.files]).toEqual([false, ["c.txt"]])
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    expect(await knownStart(ops, { tip, base: b, repoConfig: line })).toEqual([
      await acceptedNow(),
    ])
  }, 60_000)

  test("a branch cloned from a conflicted catch-up: its proposed changes' conflict came with its copy, and catching up with its parent settles it", async () => {
    const rig = await turnRig("parent")
    const {
      laneDir,
      repoDir,
      repoJj,
      ops,
      line,
      edit,
      proposed,
      accept,
      turn,
    } = rig
    const BRANCH = "copper-owl" as ThreadName
    // The parent changes base.txt; you change the same line on accepted work;
    // the parent catches up, and the merge stays conflicted.
    await edit(laneDir, "base.txt", "base, lane\n")
    await turn()
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "base.txt", "base, yours\n")
    await repoJj(["commit", "-m", "yours: base.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const l2 = await rig.acceptedNow()
    await rig.inLane([fetchById([l2])])
    const { merge } = await mergeBase(
      rig.laneJj,
      LANE,
      l2,
      baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: l2,
      }),
    )
    if (merge === null) throw new Error("nothing merged")
    expect(await readConflictedFiles(rig.laneJj, merge)).toEqual(["base.txt"])
    // A prompt on it commits nothing, and its record names the merge: the
    // turn says it is conflicted, as a branch from it would start.
    expect(
      await commitTurn(rig.laneJj, {
        title: "a prompt",
        entry: entryId("e-parent-prompt"),
        lane: LANE,
        bookmark: merge,
      }),
    ).toEqual({ point: null, conflicted: true })
    // The branch is cloned there, conflicted.
    const forkDir = path.join(top, "parent-fork")
    await cp(laneDir, forkDir, { recursive: true, verbatimSymlinks: true })
    await rig.inLane(
      planForkSetup(jjLaneFor(FORK), {
        kind: "recorded",
        points: [merge].map(pointFromCommit),
      }),
      forkDir,
    )
    const forkJj = laneJjAt(forkDir)
    const forkRunners = {
      lane: hostRunner(forkDir),
      laneBytes: hostBytesRunner(forkDir),
    }
    const fetchFork = (have: readonly CommitId[]) =>
      fetchLane(forkRunners, repoDir, {
        lane: FORK,
        have,
        bundle: path.join(top, "parent-fork.bundle"),
      })
    // Both resolve it the same way; the parent's is accepted.
    const resolved = "base, yours, lane\n"
    await edit(laneDir, "base.txt", resolved)
    const parentResolved = await turn()
    await accept(await proposed(rig.base))
    await edit(forkDir, "base.txt", resolved)
    const resolving = await commitTurn(forkJj, {
      title: "resolve",
      entry: entryId("e-fork-1"),
      lane: FORK,
      bookmark: await readLaneBookmark(forkJj, FORK),
    })
    expect(resolving.conflicted).toBe(false)
    await fetchFork(rig.base)
    // The branch's proposed changes start at the conflicted merge, and
    // conflicts in the file it started conflicted in.
    const branchProposed = async () => {
      const tip = await laneTipIn(ops, FORK)
      if (tip === null) throw new Error("no tip")
      const b = await laneBase(ops, tip, line)
      if (b === null) throw new Error("no base")
      const read = await startOfProposed(ops, {
        tip,
        base: b,
        repoConfig: line,
        lane: FORK,
      })
      if (read.kind !== "known") throw new Error("an untraced start")
      return { tip, base: b, start: read.start }
    }
    const before = await branchProposed()
    expect(before.start).toEqual([merge])
    await executeRepo(
      repoDir,
      planProposedChanges({
        name: BRANCH,
        start: before.start,
        sources: [
          {
            commit: before.tip,
            description: `WIP\n\nPinetrie-Thread: ${BRANCH}\nPinetrie-Source: ${before.tip}\nPinetrie-Start: ${merge}\n`,
          },
        ],
        target: await rig.acceptedNow(),
        nonce: "n-parent",
      }),
    )
    const read = await readProposedChanges(ops, {
      name: BRANCH,
      target: await rig.acceptedNow(),
    })
    expect(read).toMatchObject({
      kind: "present",
      conflicts: ["base.txt"],
      startConflicts: ["base.txt"],
    })
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const gathered = await gatherLane(ops, {
      lane: FORK,
      name: BRANCH,
      repoConfig: line,
      shared: await readShared(op, ops, line),
      known: null,
    })
    expect(gathered).toMatchObject({
      proposed: { conflicts: ["base.txt"], startConflicts: ["base.txt"] },
    })
    // The parent catches up with accepted work after the fork, past its own
    // accepted thread commit;
    // then the branch catches up with the parent's newest commit, fetched
    // from your repo, where only the parent's ref reaches it.
    const acceptedCommit = await rig.acceptedNow()
    await rig.inLane([fetchById([acceptedCommit])])
    const upToDate = await mergeBase(
      rig.laneJj,
      LANE,
      acceptedCommit,
      baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: acceptedCommit,
      }),
    )
    expect(upToDate.merge).not.toBeNull()
    await rig.fetch([parentResolved])
    const newest = await laneTipIn(ops, LANE)
    if (newest === null) throw new Error("no parent tip")
    const plan = planMerge(jjLaneFor(LANE), {
      kind: "parent",
      lane: LANE,
      name: NAME,
      point: pointFromCommit(newest),
      upToDateWith: pointFromCommit(merge),
    })
    // The plan's fetch names your repo by its path in a lane: run it here.
    await rig.inLane(plan.steps, forkDir)
    const merged = await mergeUpdate(forkJj, forkRunners, FORK, {
      ...plan,
      steps: [],
    })
    expect(merged.kind).toBe("clean")
    await fetchFork([merge])
    // Its base is now the parent's newer one, and its work changes no file:
    // its proposed changes are withdrawn.
    const after = await branchProposed()
    expect(after.base.start).toBe(acceptedCommit)
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: after.start },
        tip: after.tip,
      }),
    ).toBe("none")
  }, 60_000)

  describe("the host's version of proposed changes", () => {
    const BOOKMARK = proposedBookmark(NAME)
    /** The proposed changes as `readProposedChanges` finds it on accepted work, whole. */
    const proposedNow = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      const read = await readProposedChanges(rig.ops, {
        name: NAME,
        target: await rig.acceptedNow(),
      })
      if (read?.kind !== "present") throw new Error("no proposed changes")
      return read
    }
    /** The commit tracked as the host's version, or none. */
    const tracked = (rig: Awaited<ReturnType<typeof turnRig>>) =>
      readCommits(
        rig.ops,
        `tracked_remote_bookmarks(exact:${revsetName(BOOKMARK)}, remote=exact:${revsetName(HOST_REMOTE)})`,
      )
    /** Your repo's op log cut to its head, everything it held collected. */
    const cutHistory = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      await rig.repoJj(["op", "abandon", "..@-"])
      await rig.repoJj(["util", "gc", "--expire=now"])
    }
    const HOST = { reached: true, othersChanged: false }

    test("proposed changes the host builds are its version, tracked, and reads as the host's with no evolog", async () => {
      const rig = await turnRig("host-built")
      await rig.proposed(rig.base)
      const read = await proposedNow(rig)
      expect(read.marked).toBe(true)
      expect(await tracked(rig)).toEqual([read.revisions[0]?.commit])
      expect(read.revisions.map(r => r.since)).toEqual([HOST])
    }, 60_000)

    test("you change the proposed changes' file: it is no longer the host's version, and reads as your edit", async () => {
      const rig = await turnRig("host-yours")
      await rig.proposed(rig.base)
      await rig.repoJj(["new", BOOKMARK])
      await rig.edit(rig.repoDir, "a.txt", "yours\n")
      const squashed = await rig.repoJj([
        "squash",
        "--ignore-immutable",
        "--into",
        BOOKMARK,
      ])
      if (!squashed.ok) throw new Error(squashed.stderr)
      const read = await proposedNow(rig)
      expect(read.marked).toBe(false)
      expect(read.revisions.map(r => r.since)).toEqual([
        { reached: true, othersChanged: true },
      ])
      await rig.agrees()
    }, 60_000)

    test("a host step that stopped before its mark is not your edit, even once the op log is cut", async () => {
      const rig = await turnRig("host-unmarked")
      await rig.proposed(rig.base)
      const [bottom] = (await proposedNow(rig)).revisions
      if (bottom === undefined) throw new Error("no proposed changes")
      await rig.edit(rig.repoDir, "line.txt", "line\n")
      await rig.repoJj(["commit", "-m", "accepted work moves"])
      await rig.repoJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
      // The host's rebase, without the mark that follows it.
      await executeRepo(
        rig.repoDir,
        planRefreshProposed(bottom.changeId, await rig.acceptedNow()),
      )
      const moved = await proposedNow(rig)
      expect([moved.marked, moved.revisions.map(r => r.since)]).toEqual([
        false,
        [HOST],
      ])
      await rig.agrees()
      // One more operation, then the log cut to it: the evolog no longer
      // reaches the host's rebase, and the host's version says it.
      await rig.repoJj(["new", "pinetrie-accepted"])
      await cutHistory(rig)
      const evolog = await rig.ops([
        "evolog",
        "--no-graph",
        "-r",
        BOOKMARK,
        "-T",
        'if(operation, operation.user(), "-") ++ "\\n"',
      ])
      expect(evolog.stdout.split("\n")[0]).toBe("-")
      expect((await proposedNow(rig)).revisions.map(r => r.since)).toEqual([
        HOST,
      ])
      await executeRepo(rig.repoDir, markSteps(BOOKMARK))
      expect((await proposedNow(rig)).marked).toBe(true)
    }, 60_000)

    test("proposed changes built before proposed changes had a host version read as the host's by its evolog, and one mark makes it the version", async () => {
      const rig = await turnRig("host-legacy")
      await rig.proposed(rig.base)
      // As an older host left it: the bookmark alone, with no host version.
      await executeRepo(rig.repoDir, [
        host("bookmark", "untrack", BOOKMARK, "--remote", HOST_REMOTE),
        git("update-ref", "-d", hostProposedRef(BOOKMARK)),
        IMPORT,
      ])
      expect(await readHostVersion(rig.ops, BOOKMARK)).toBeNull()
      const read = await proposedNow(rig)
      expect([read.marked, read.revisions.map(r => r.since)]).toEqual([
        false,
        [HOST],
      ])
      await executeRepo(rig.repoDir, markSteps(BOOKMARK))
      expect((await proposedNow(rig)).marked).toBe(true)
      expect(await tracked(rig)).toHaveLength(1)
    }, 60_000)

    test("your edit races a host step that marked: its version names the host's commit, after the op log is cut too", async () => {
      const rig = await turnRig("host-race")
      await rig.proposed(rig.base)
      const [bottom] = (await proposedNow(rig)).revisions
      if (bottom === undefined) throw new Error("no proposed changes")
      const op = (
        await rig.ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      ).stdout.trim()
      await executeRepo(rig.repoDir, [
        ...planDescribe(bottom.changeId, "the host's\n"),
        ...markSteps(BOOKMARK),
      ])
      const marked = await readHostVersion(rig.ops, BOOKMARK)
      await rig.repoJj([
        "--at-operation",
        op,
        "describe",
        "--ignore-immutable",
        "-r",
        bottom.changeId,
        "-m",
        "yours\n",
      ])
      await rig.repoJj(["new", "pinetrie-accepted"])
      await cutHistory(rig)
      const split = await hostCommitIn(
        rig.ops,
        bottom.changeId,
        await readHostVersion(rig.ops, BOOKMARK),
      )
      expect(split?.host).toBe(marked)
    }, 60_000)

    test("you delete the proposed changes' bookmark and build on its commit: the host's forget leaves your commits where they are", async () => {
      const rig = await turnRig("host-forget")
      await rig.proposed(rig.base)
      const proposed = (await readCommits(rig.ops, BOOKMARK))[0]
      await rig.repoJj(["bookmark", "delete", BOOKMARK])
      await rig.repoJj(["new", "--ignore-immutable", proposed ?? ""])
      await rig.edit(rig.repoDir, "mine.txt", "mine\n")
      await rig.repoJj(["commit", "-m", "mine, on the old proposed changes"])
      const mine = await readCommits(rig.ops, "@-")
      const below = await readCommits(rig.ops, "::@-")
      await executeRepo(rig.repoDir, forgetSteps(BOOKMARK))
      expect(await readHostVersion(rig.ops, BOOKMARK)).toBeNull()
      expect(await readCommits(rig.ops, "@-")).toEqual(mine)
      expect(await readCommits(rig.ops, "::@-")).toEqual(below)
    }, 60_000)

    test("an acceptance forgets the proposed changes' bookmark and the host's version, and accepted work holds the commit", async () => {
      const rig = await turnRig("host-accept")
      const proposed = await rig.proposed(rig.base)
      const [top] = proposed.built.commits
      await rig.accept(proposed)
      expect(await readHostVersion(rig.ops, BOOKMARK)).toBeNull()
      expect(
        await readCommits(rig.ops, `present(${bookmarkRevset(BOOKMARK)})`),
      ).toEqual([])
      expect(await rig.acceptedNow()).toBe(top)
    }, 60_000)

    test("an archived lane's history is parked: after the op log is cut and collected, its restore still finds it", async () => {
      const rig = await turnRig("host-park")
      await rig.fetch(rig.base)
      const tip = await laneTipIn(rig.ops, LANE)
      if (tip === null) throw new Error("no tip")
      await executeRepo(
        rig.repoDir,
        laneRefSteps([
          { lane: LANE, commit: null },
          { lane: threadIdFor("9"), commit: null },
        ]),
      )
      expect(await laneTipIn(rig.ops, LANE)).toBeNull()
      await cutHistory(rig)
      await executeRepo(
        rig.repoDir,
        laneRefSteps([{ lane: LANE, commit: tip }]),
      )
      expect(await laneTipIn(rig.ops, LANE)).toBe(tip)
      const parked = await run("git", ["for-each-ref", "refs/pinetrie/"], {
        cwd: rig.repoDir,
      })
      expect(parked.stdout).toBe("")
    }, 60_000)
  })

  test("a lane's ref deleted and imported: the history under accepted work is kept", async () => {
    const { repoDir, repoJj, ops, edit, proposed, accept, base } =
      await turnRig("refgone")
    await accept(await proposed(base))
    await edit(repoDir, "mine.txt", "mine\n")
    await repoJj(["commit", "-m", "mine on accepted work"])
    await repoJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
    const before = await readCommits(ops, "::@-")
    await executeRepo(repoDir, laneRefSteps([{ lane: LANE, commit: null }]))
    expect(await readCommits(ops, "::@-")).toEqual(before)
    expect(await readCommits(ops, "conflicts()")).toEqual([])
  }, 60_000)

  test("a publish's catch-up: a preview that writes nothing, then your work rebased onto accepted work, conflicts recorded", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("catchup")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    const changeId = async (rev: string) =>
      (
        await repoJj(["log", "--no-graph", "-r", rev, "-T", "change_id"])
      ).stdout.trim()
    await edit(repoDir, "f.txt", "a\nb\nc\n")
    await edit(repoDir, "g.txt", "base\n")
    await repoJj(["commit", "-m", "L0"])
    await setUpAccepted()
    // Your work: Y1 changes g.txt, with a second head on it besides @.
    await edit(repoDir, "g.txt", "yours\n")
    await repoJj(["describe", "-m", "Y1"])
    const y1 = await changeId("@")
    await repoJj(["new", y1, "-m", "sibling"])
    await edit(repoDir, "s.txt", "s\n")
    await repoJj(["new", y1])
    // A file in @, so leaving it does not abandon it as empty.
    await edit(repoDir, "h.txt", "h\n")
    const at = await changeId("@")
    // Accepted work moves on: L1 changes f.txt and g.txt.
    await repoJj(["new", line.acceptedBookmark, "-m", "L1"])
    await edit(repoDir, "f.txt", "a\nB\nc\n")
    await edit(repoDir, "g.txt", "line\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["edit", at])
    // Not yet snapshotted: the rebase, run as you, snapshots it first.
    await edit(repoDir, "i.txt", "i\n")
    const before = (await repoJj(["op", "log", "-n", "1", "-T", "id"])).stdout
    const facts = await acceptedFacts(ops, git, line)
    expect(facts.workingCopy.behind).toBe(1)
    expect(facts.workingCopy.getLatest).toEqual({
      changes: 2,
      conflicts: ["g.txt"],
      heads: 1,
    })
    expect(facts.workingCopy.conflicts).toEqual({ commits: 0, files: [] })
    // The preview wrote no operation.
    expect(
      (
        await repoJj([
          "--ignore-working-copy",
          "op",
          "log",
          "-n",
          "1",
          "-T",
          "id",
        ])
      ).stdout,
    ).toBe(before)
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.workingCopy.behind).toBe(0)
    expect(after.workingCopy.getLatest).toBe(null)
    // Y1 and @ conflict; the sibling moved too, and conflicts outside @'s line.
    expect(after.workingCopy.conflicts).toEqual({
      commits: 2,
      files: ["g.txt"],
    })
    expect(await readFile(path.join(repoDir, "h.txt"), "utf8")).toBe("h\n")
    expect(await readFile(path.join(repoDir, "i.txt"), "utf8")).toBe("i\n")
    expect(await readFile(path.join(repoDir, "f.txt"), "utf8")).toBe(
      "a\nB\nc\n",
    )
    expect(
      await readCommits(
        ops,
        `description(exact:"sibling\\n") & ${revsetName(line.acceptedBookmark)}::`,
      ),
    ).toHaveLength(1)
  }, 60_000)

  test("publish's move: main moved forward to accepted work as the host, git's main with it; refused once main has its own commits", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    const gitMain = async () =>
      (await git(["rev-parse", "refs/heads/main"])).stdout.trim()
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // No unpublished work yet: accepted work is main.
    expect((await acceptedFacts(ops, git, line)).published).toMatchObject({
      behind: 0,
      ahead: 0,
    })
    await edit(repoDir, "b.txt", "b\n")
    await repoJj(["commit", "-m", "L1"])
    await edit(repoDir, "c.txt", "c\n")
    await repoJj(["commit", "-m", "L2"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const before = await acceptedFacts(ops, git, line)
    expect(before.published).toMatchObject({ behind: 2, ahead: 0 })
    await executeRepo(
      repoDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: false,
      }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.published).toEqual({
      commit: before.commit,
      behind: 0,
      ahead: 0,
    })
    // The host's move, with --ignore-working-copy, still reaches git.
    expect(await gitMain()).toBe(before.commit)
    // main moved sideways, outside pinetrie: its own commit, which accepted work lacks.
    await repoJj(["new", "main", "-m", "hotfix"])
    await edit(repoDir, "h.txt", "h\n")
    await repoJj(["bookmark", "move", "main", "--to", "@"])
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "d.txt", "d\n")
    await repoJj(["commit", "-m", "L3"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const sideways = await acceptedFacts(ops, git, line)
    expect(sideways.published).toMatchObject({ behind: 1, ahead: 1 })
    const moved = (await acceptedFacts(ops, git, line)).published.commit
    await expect(
      executeRepo(
        repoDir,
        planPublishMove({
          acceptedBookmark: line.acceptedBookmark,
          publish: line.publish,
          accept: false,
        }),
      ),
    ).rejects.toThrow()
    expect((await acceptedFacts(ops, git, line)).published.commit).toBe(moved)
  }, 60_000)

  test("publish from an empty @ on main: main at accepted work, and @ empty on it", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish-empty")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // An accept: accepted work moves on past main, and your empty @ stays on main.
    await repoJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(repoDir, "b.txt", "b\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["new", "main"])
    const before = await acceptedFacts(ops, git, line)
    expect(before.workingCopy).toMatchObject({ behind: 1, ahead: 0 })
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    await executeRepo(
      repoDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: false,
      }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.published).toMatchObject({ behind: 0, ahead: 0 })
    expect(after.workingCopy).toMatchObject({ behind: 0, ahead: 0 })
    expect(await readCommits(ops, "main")).toEqual(
      await readCommits(ops, revsetName(line.acceptedBookmark)),
    )
    expect(await readCommits(ops, "@-")).toEqual(await readCommits(ops, "main"))
    expect(await readCommits(ops, "@ & empty()")).toHaveLength(1)
    expect(await readFile(path.join(repoDir, "b.txt"), "utf8")).toBe("b\n")
  }, 60_000)

  test("publish with your commits: rebased onto accepted work, counted, then accepted work and main moved to them in one operation", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish-mine")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    await repoJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(repoDir, "b.txt", "b\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["new", "main"])
    await edit(repoDir, "m.txt", "mine\n")
    await repoJj(["commit", "-m", "mine"])
    expect((await acceptedFacts(ops, git, line)).workingCopy).toMatchObject({
      behind: 1,
      ahead: 1,
    })
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    expect((await acceptedFacts(ops, git, line)).workingCopy).toMatchObject({
      behind: 0,
      ahead: 1,
    })
    const ops0 = await repoJj(["op", "log", "--no-graph", "-T", 'id ++ "\\n"'])
    await executeRepo(
      repoDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: true,
      }),
    )
    const ops1 = await repoJj(["op", "log", "--no-graph", "-T", 'id ++ "\\n"'])
    // One operation moved both bookmarks.
    expect(
      ops1.stdout.split("\n").length - ops0.stdout.split("\n").length,
    ).toBe(1)
    const mine = await readCommits(ops, 'description(exact:"mine\\n")')
    expect(await readCommits(ops, revsetName(line.acceptedBookmark))).toEqual(
      mine,
    )
    expect(await readCommits(ops, "main")).toEqual(mine)
  }, 60_000)

  test("a publish's second round reads your commits conflicted by the catch-up, and its revert keeps your edit", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish-undo")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    await edit(repoDir, "g.txt", "base\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // Y1 changes g.txt; Y2 puts it back, so @'s tree merges cleanly.
    await edit(repoDir, "g.txt", "yours\n")
    await repoJj(["commit", "-m", "Y1"])
    await edit(repoDir, "g.txt", "base\n")
    await repoJj(["commit", "-m", "Y2"])
    // A file in @, so leaving it does not abandon it as empty.
    await edit(repoDir, "h.txt", "h\n")
    const at = (
      await repoJj(["log", "--no-graph", "-r", "@", "-T", "change_id"])
    ).stdout.trim()
    await repoJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(repoDir, "g.txt", "line\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["edit", at])
    // Not yet snapshotted: the catch-up snapshots it first, as you.
    await edit(repoDir, "e.txt", "edited\n")
    const before = await acceptedFacts(ops, git, line)
    expect(before.workingCopy.getLatest?.conflicts).toEqual([])
    expect(before.workingCopy.conflicts.commits).toBe(0)
    const commitsBefore = await readCommits(ops, "::@- ~ ::main")
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    const op = (
      await repoJj([
        "--ignore-working-copy",
        "op",
        "log",
        "-n",
        "1",
        "--no-graph",
        "-T",
        "id",
      ])
    ).stdout.trim()
    expect(
      (await acceptedFacts(ops, git, line)).workingCopy.conflicts.commits,
    ).toBeGreaterThan(0)
    await executeRepo(repoDir, planGetLatestUndo(op))
    const undone = await acceptedFacts(ops, git, line)
    expect(undone.workingCopy.behind).toBe(1)
    expect(undone.workingCopy.conflicts.commits).toBe(0)
    expect(await readCommits(ops, "::@- ~ ::main")).toEqual(commitsBefore)
    expect(await readCommits(ops, "@ & divergent()")).toEqual([])
    expect(await readFile(path.join(repoDir, "e.txt"), "utf8")).toBe("edited\n")
    expect(await readFile(path.join(repoDir, "g.txt"), "utf8")).toBe("base\n")
  }, 60_000)

  test("unchanged proposed changes' refresh reads at most 2 jj processes, none of them its evolog, and what catching up changes is read once per move", async () => {
    const rig = await turnRig("count")
    const { ops, line, fetch, build, acceptedNow, base } = rig
    await fetch(base)
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    const start = await knownStart(ops, { tip, base: b, repoConfig: line })
    // As the host builds one: its ledger names the tip and the start.
    await build([
      {
        commit: tip,
        description: `WIP\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${tip}\n${start.map(c => `Pinetrie-Start: ${c}`).join("\n")}\n`,
      },
    ])
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const shared = await readShared(op, ops, line)
    let ran = 0
    const evologs: string[] = []
    const counted: Runner = args => {
      ran += 1
      if (args.includes("evolog")) evologs.push(args.join(" "))
      return ops(args)
    }
    const gathered = await gatherLane(counted, {
      lane: LANE,
      name: NAME,
      repoConfig: line,
      shared,
      known: null,
    })
    expect(gathered).toMatchObject({
      tip,
      target: await acceptedNow(),
      work: "some",
    })
    // One `jj log`, and whether the lane's work changes any file: the
    // proposed changes' top is the host's version, so no evolog is read.
    expect(ran).toBe(2)
    expect(evologs).toEqual([])
    // Accepted work moves: what catching up changes is read once, in two diffs,
    // and kept while the lane's tip and accepted work stay where they are.
    await rig.edit(rig.repoDir, "line.txt", "line\n")
    await rig.repoJj(["commit", "-m", "accepted work moves"])
    await rig.repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const gather = async (known: GetLatestRead | null) => {
      const now = (
        await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      ).stdout
      const facts = await readShared(now, ops, line)
      ran = 0
      const read = await gatherLane(counted, {
        lane: LANE,
        name: NAME,
        repoConfig: line,
        shared: facts,
        known,
      })
      if (read === "none" || read === "unfinished")
        throw new Error("not on accepted work")
      return { read, ran }
    }
    const moved = await gather(null)
    expect(moved.read.getLatest).toEqual({
      tip,
      to: await acceptedNow(),
      files: ["line.txt"],
    })
    expect(moved.ran).toBe(4)
    expect((await gather(moved.read.getLatest)).ran).toBe(2)
    // Moved again: what was read at accepted work before is read again.
    await rig.edit(rig.repoDir, "line.txt", "line, again\n")
    await rig.repoJj(["commit", "-m", "accepted work moves again"])
    await rig.repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const again = await gather(moved.read.getLatest)
    expect([again.ran, again.read.getLatest?.to]).toEqual([
      4,
      await acceptedNow(),
    ])
  }, 60_000)

  test("proposed changes accepted work already holds is empty, and the lane's work still changes files: it is kept, not withdrawn and built again", async () => {
    const rig = await turnRig("held")
    const {
      ops,
      repoJj,
      repoDir,
      line,
      fetch,
      build,
      acceptedNow,
      base,
      agrees,
    } = rig
    await fetch(base)
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    const start = await knownStart(ops, { tip, base: b, repoConfig: line })
    const [proposed] = (
      await build([
        {
          commit: tip,
          description: `WIP\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${tip}\n${start.map(c => `Pinetrie-Start: ${c}`).join("\n")}\n`,
        },
      ])
    ).changeIds
    if (proposed === undefined) throw new Error("no proposed changes")
    // You land the lane's change yourself; the proposed changes follow accepted
    // work.
    await rig.edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "you: the same a.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    await executeRepo(
      repoDir,
      planRefreshProposed(proposed, await acceptedNow()),
    )
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
    expect(gathered).toMatchObject({ work: "some", proposed: { files: [] } })
    await agrees()
  }, 60_000)

  test("an accepted thread commit of the lane that names no source makes its start untraced, read either way, until it catches up past it", async () => {
    const {
      ops,
      laneDir,
      line,
      edit,
      fetch,
      build,
      accept,
      turn,
      update,
      agrees,
      acceptedNow,
      base,
    } = await turnRig("untraced")
    await fetch(base)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // Accepted as proposed changes were before they carried their ledger.
    const built = await build([
      {
        commit: t1,
        description: `feat: a\n\nPinetrie-Thread: ${NAME}\nPinetrie-Lane: ${LANE}\n`,
      },
    ])
    await accept({ built })
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turn()
    await fetch([t1])
    await agrees()
    const b2 = await laneBase(ops, t2, line)
    if (b2 === null) throw new Error("no base")
    expect(
      await startOfProposed(ops, {
        tip: t2,
        base: b2,
        repoConfig: line,
        lane: LANE,
      }),
    ).toEqual({
      kind: "untraced",
      acceptedThreadCommits: [await acceptedNow()],
    })
    const input = { lane: LANE, name: NAME, repoConfig: line, known: null }
    expect(await gatherPlace({ jj: ops }, input)).toEqual({
      kind: "untraced",
      tip: t2,
      base: b2,
      state: "ok",
      target: await acceptedNow(),
    })
    // The revset that finds a thread's commits matches what hasTrailer does.
    const all = parseAcceptedThreadCommits(
      (
        await ops([
          "log",
          "--no-graph",
          "-r",
          "all()",
          "-T",
          ACCEPTED_THREAD_COMMIT_ROW,
        ])
      ).stdout,
    )
    const found = await readCommits(ops, trailerRevset(["thread"], NAME))
    expect(found.length).toBeGreaterThan(0)
    expect(
      all
        .filter(c => hasTrailer(c.description, "thread", NAME))
        .map(c => c.commit)
        .sort(),
    ).toEqual([...found].sort())
    // Caught up: the accepted thread commit is under its base, and the start is
    // accepted work.
    expect(await update()).toEqual([])
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    await fetch([t2])
    await agrees()
    const t3 = await laneTipIn(ops, LANE)
    if (t3 === null) throw new Error("no tip")
    const b3 = await laneBase(ops, t3, line)
    if (b3 === null) throw new Error("no base")
    expect(
      await startOfProposed(ops, {
        tip: t3,
        base: b3,
        repoConfig: line,
        lane: LANE,
      }),
    ).toEqual({ kind: "known", start: [await acceptedNow()] })
    expect(await gatherPlace({ jj: ops }, input)).toMatchObject({
      kind: "placed",
      tip: t3,
      start: [await acceptedNow()],
    })
  }, 60_000)

  test("catching up with your own acceptance of the lane's work changes no file, as getLatestFiles says", async () => {
    const { ops, laneJj, inLane, proposed, accept, acceptedNow, base } =
      await turnRig("own-acceptance")
    await accept(await proposed(base))
    const tip = await laneTipIn(ops, LANE)
    const [start] = base
    if (tip === null || start === undefined) throw new Error("no tip")
    const to = await acceptedNow()
    expect(to).not.toBe(start)
    expect(await getLatestFiles(ops, { holds: [start], to, tip })).toEqual([])
    await inLane([fetchById([to])])
    const { ours, merge } = await mergeBase(laneJj, LANE, to, "update")
    if (merge === null) throw new Error("nothing merged")
    expect(
      lines(
        (await laneJj(["diff", "--from", ours, "--to", merge, "--name-only"]))
          .stdout,
      ),
    ).toEqual([])
  }, 60_000)

  describe("catching up past an accepted thread commit of the lane's work", () => {
    /** Six lines; `at` replaces line n (1-based). */
    const doc = (at: Record<number, string> = {}) =>
      `${[1, 2, 3, 4, 5, 6].map(n => at[n] ?? `line ${n}`).join("\n")}\n`
    /** `turnRig`, with a turn writing `doc.txt`, its proposed changes accepted into accepted work. */
    const acceptedProposedRig = async (tag: string) => {
      const rig = await turnRig(tag)
      await rig.edit(rig.laneDir, "doc.txt", doc())
      const t1 = await rig.turn()
      await rig.accept(await rig.proposed(rig.base))
      return { ...rig, t1 }
    }
    /** You change `doc.txt` on accepted work, landing it. */
    const repoOnAccepted = async (
      rig: Awaited<ReturnType<typeof acceptedProposedRig>>,
      text: string,
      title: string,
    ) => {
      await rig.repoJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.repoDir, "doc.txt", text)
      await rig.repoJj(["commit", "-m", title])
      await rig.repoJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
    }
    const read = (dir: string, file: string) =>
      readFile(path.join(dir, file), "utf8")
    /**
     * The lane's tip fetched into your repo, then what the one read says
     * catching up would change, and where the proposed changes start; the
     * separate reads say the same (`agrees`).
     */
    const forecast = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      await rig.fetch(rig.base)
      const gathered = await rig.agrees()
      if (gathered === "none" || gathered === "unfinished")
        throw new Error("not on accepted work")
      return { files: gathered.getLatest?.files, start: gathered.start }
    }

    test("your own acceptance, then your edit to it on accepted work: clean, and the accepted thread commit is not listed as come in", async () => {
      const rig = await acceptedProposedRig("past-own")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "c.txt", "c\n")
      await rig.turn()
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(await read(rig.laneDir, "doc.txt")).toBe(doc({ 1: "yours" }))
      expect(await read(rig.laneDir, "c.txt")).toBe("c\n")
      expect(merged.commits).toContain("yours: doc line 1")
      expect(merged.commits).not.toContain("WIP")
      // Its next proposed changes hold the lane's own work alone.
      const next = await rig.proposed([rig.t1])
      expect([next.conflicted, next.files]).toEqual([false, ["c.txt"]])
    }, 60_000)

    test("the lane re-edits its own accepted lines: clean, with both edits, and the forecast names the file", async () => {
      const rig = await acceptedProposedRig("past-reedit")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      expect((await forecast(rig)).files).toEqual(["doc.txt"])
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual(["doc.txt"])
      expect(await read(rig.laneDir, "doc.txt")).toBe(
        doc({ 1: "yours", 5: "lane again" }),
      )
    }, 60_000)

    test("the lane re-edits a file of its own accepted proposed changes, accepted work unchanged since: the forecast is none, and so is the merge", async () => {
      const rig = await acceptedProposedRig("past-own-reedit")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      const { files, start } = await forecast(rig)
      expect(start).toEqual({ kind: "known", start: [rig.t1] })
      expect(files).toEqual([])
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual([])
    }, 60_000)

    test("proposed, caught up, then accepted, and re-edited: the proposed changes start at two commits, and the forecast is none, as the merge", async () => {
      const rig = await turnRig("past-two-starts")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      await rig.turn()
      const proposed = await rig.proposed(rig.base)
      // Accepted work moves by a file of yours, and the lane catches up.
      await rig.repoJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.repoDir, "other.txt", "other\n")
      await rig.repoJj(["commit", "-m", "yours: other.txt"])
      await rig.repoJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
      const upToDate = await rig.getLatest()
      expect(upToDate.kind).toBe("clean")
      // The proposed changes, made before, follows accepted work and is
      // accepted.
      const [bottom] = proposed.built.changeIds
      if (bottom === undefined) throw new Error("no proposed changes")
      await executeRepo(
        rig.repoDir,
        planRefreshProposed(bottom, await rig.acceptedNow()),
      )
      await rig.accept(proposed)
      // The lane re-edits what was accepted.
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      const { files, start } = await forecast(rig)
      expect(start.kind === "known" && start.start.length).toBe(2)
      expect(files).toEqual([])
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual([])
    }, 60_000)

    test("two acceptances, your edit to the first between them: clean", async () => {
      const rig = await acceptedProposedRig("past-two")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane" }))
      await rig.turn()
      await rig.accept(await rig.proposed([rig.t1]))
      await repoOnAccepted(
        rig,
        doc({ 1: "yours", 5: "yours" }),
        "yours: doc line 5",
      )
      expect((await rig.getLatest()).kind).toBe("clean")
      expect(await read(rig.laneDir, "doc.txt")).toBe(
        doc({ 1: "yours", 5: "yours" }),
      )
    }, 60_000)

    test("a branch holding its parent's accepted work catches up clean", async () => {
      const rig = await turnRig("past-parent")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      const t1 = await rig.turn()
      // The branch is cloned at the parent's turn, and works on.
      const forkDir = path.join(top, "past-parent-fork")
      await cp(rig.laneDir, forkDir, {
        recursive: true,
        verbatimSymlinks: true,
      })
      await rig.inLane(
        planForkSetup(jjLaneFor(FORK), {
          kind: "recorded",
          points: [t1].map(pointFromCommit),
        }),
        forkDir,
      )
      await rig.edit(forkDir, "k.txt", "k\n")
      await commitTurn(laneJjAt(forkDir), {
        title: "branch work",
        entry: entryId("e-past-parent-fork"),
        lane: FORK,
        bookmark: await readLaneBookmark(laneJjAt(forkDir), FORK),
      })
      // The parent's proposed changes are accepted, and you edit it on accepted
      // work.
      await rig.accept(await rig.proposed(rig.base))
      await rig.repoJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.repoDir, "doc.txt", doc({ 1: "yours" }))
      await rig.repoJj(["commit", "-m", "yours: doc line 1"])
      await rig.repoJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
      expect((await rig.getLatest(forkDir, FORK)).kind).toBe("clean")
      expect(await read(forkDir, "doc.txt")).toBe(doc({ 1: "yours" }))
      expect(await read(forkDir, "k.txt")).toBe("k\n")
    }, 60_000)

    test("a line both rewrote still conflicts, on that file alone, and the accepted thread commit is not its side", async () => {
      const rig = await acceptedProposedRig("past-real")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 1: "lane again" }))
      await rig.edit(rig.laneDir, "c.txt", "c\n")
      await rig.turn()
      const merged = await rig.getLatest()
      if (merged.kind !== "conflicted") throw new Error("not conflicted")
      expect(merged.contents.map(c => c.path)).toEqual(["doc.txt"])
      expect(merged.theirs.map(r => firstLine(r.description, 200))).toEqual([
        "yours: doc line 1",
      ])
    }, 60_000)

    test("proposed changes you edited where the lane wrote: its join conflicts, and is left out", async () => {
      const rig = await turnRig("past-edited")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      await rig.turn()
      const proposed = await rig.proposed(rig.base)
      // You reword the lane's first line in the proposed changes, then accept
      // it.
      const [top] = proposed.built.commits
      if (top === undefined) throw new Error("no proposed changes")
      await rig.repoJj(["new", top])
      await rig.edit(rig.repoDir, "doc.txt", doc({ 1: "edited by you" }))
      // The proposed changes keep its message, and so its `Pinetrie-Source`.
      await rig.repoJj([
        "squash",
        "--ignore-immutable",
        "--use-destination-message",
      ])
      expect(
        await readCommits(
          rig.ops,
          `${bookmarkRevset(proposedBookmark(NAME))} & ${trailerRevset(["source"])}`,
        ),
      ).toHaveLength(1)
      await rig.accept(proposed)
      const merged = await rig.getLatest()
      // Merged as before the joins: no join is left in the lane's history.
      expect(merged.kind).toBe("conflicted")
      expect(
        await readCommits(rig.laneJj, 'description(regex:"^join: ")'),
      ).toEqual([])
    }, 60_000)
  })

  test("a lane whose work undoes itself changes no file, over a range jj diffs as one", async () => {
    const { laneDir, ops, turn, fetch, base } = await turnRig("undone")
    await fetch(base)
    const first = await laneTipIn(ops, LANE)
    const [start] = base
    if (first === null || start === undefined) throw new Error("no tip")
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [start] },
        tip: first,
      }),
    ).toBe("some")
    await rm(path.join(laneDir, "a.txt"))
    await turn()
    await fetch(base)
    const undone = await laneTipIn(ops, LANE)
    if (undone === null) throw new Error("no tip")
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [start] },
        tip: undone,
      }),
    ).toBe("none")
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [first] },
        tip: undone,
      }),
    ).toBe("some")
    // A range jj refuses, here for a commit it does not have, is not a change.
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [first, commitId("1".repeat(40))] },
        tip: undone,
      }),
    ).toBe("unknown")
    expect(
      await filesTouched(ops, {
        start: { kind: "untraced", acceptedThreadCommits: [first] },
        tip: undone,
      }),
    ).toBe("unknown")
  }, 60_000)

  test("a thread on a WIP starts from its copy, and freezes nothing of yours", async () => {
    const rig = await proposedRig("wipcopy")
    await rig.edit(rig.repoDir, "base.txt", "base\n")
    await rig.repoJj(["commit", "-m", "your base"])
    const base = await readCommits(rig.repoJj, "@-")
    const [line] = base
    if (line === undefined) throw new Error("no base")
    await rig.setUpAccepted()
    await rig.edit(rig.repoDir, "wip.txt", "half done\n")
    await rig.repoJj(["commit", "-m", "wip: half done"])
    await rig.repoJj(["bookmark", "create", "wip/search", "-r", "@-"])
    const [unfinished] = await readCommits(rig.repoJj, "wip/search")
    if (unfinished === undefined) throw new Error("no wip")
    await rig.inLane(planBaseCheckout({ accepted: base, fresh: true }))
    await rig.inLane(
      planForkSetup(jjLaneFor(LANE), {
        kind: "unfinished",
        bookmark: "wip/search",
        commit: unfinished,
        under: line,
      }),
    )
    expect(await readFile(path.join(rig.laneDir, "wip.txt"), "utf8")).toBe(
      "half done\n",
    )
    await rig.edit(rig.laneDir, "tests.txt", "tests\n")
    await rig.turn()
    await rig.fetch(base)
    // The lane's tip is immutable in your repo; your WIP is not.
    expect(
      (await readCommits(rig.repoJj, `${unfinished} & mutable()`)).length,
    ).toBe(1)
    const tip = await laneTipIn(rig.ops, LANE)
    if (tip === null) throw new Error("no tip")
    expect(await laneBase(rig.ops, tip, rig.line)).toMatchObject({
      base: { kind: "unfinished", bookmark: "wip/search" },
      source: unfinished,
    })
    // You amend the WIP: the proposed changes, from the copy, placed on the WIP
    // now, holds only the lane's file.
    await rig.edit(rig.repoDir, "wip.txt", "half done, amended\n")
    await rig.repoJj(["squash", "--into", "wip/search"])
    const b = await laneBase(rig.ops, tip, rig.line)
    if (b === null) throw new Error("no base")
    const start = await knownStart(rig.ops, {
      tip,
      base: b,
      repoConfig: rig.line,
    })
    const [target] = await readCommits(rig.ops, "wip/search")
    if (target === undefined) throw new Error("no wip")
    await executeRepo(
      rig.repoDir,
      planProposedChanges({
        name: NAME,
        start,
        sources: [{ commit: tip, description: "WIP" }],
        target,
        nonce: "n-wip",
      }),
    )
    const found = await proposedRevisions(rig.ops, { name: NAME, target })
    const o = found[0]?.commit
    expect(
      lines((await rig.ops(["diff", "-r", o ?? "", "--name-only"])).stdout),
    ).toEqual(["tests.txt"])
    // What an acceptance reads: the WIP's commit above accepted work lands with
    // it on accepted work, and both bookmarks sit below the proposed changes.
    const input = { lane: LANE, name: NAME, repoConfig: rig.line, known: null }
    const gathered = await gatherProposedChanges({ jj: rig.ops }, input)
    expect(gathered?.place).toMatchObject({ kind: "placed", target })
    if (gathered === null) throw new Error("no gather")
    expect(await gatherAcceptance({ jj: rig.ops }, gathered, rig.line)).toEqual(
      {
        unfinishedAhead: 1,
        below: new Set(["wip/search", rig.line.acceptedBookmark]),
      },
    )
    // A split's stack, read bottom first: the WIP's commit, then the proposed
    // changes.
    const stack = await gatherStack(
      { jj: rig.ops },
      { start: [line], tip, top: o === undefined ? null : commitId(o) },
    )
    expect(
      stack === "no-top"
        ? stack
        : stack.revisions.map(r => [r.commit, r.description.split("\n")[0]]),
    ).toEqual([
      [target, "wip: half done"],
      [o, "WIP"],
    ])
    expect(
      await gatherStack({ jj: rig.ops }, { start: [line], tip, top: null }),
    ).toBe("no-top")
    // Accepted into the WIP: a forward move; the WIP stays mutable.
    await executeRepo(
      rig.repoDir,
      planAcceptanceSteps({
        bookmark: proposedBookmark(NAME),
        top: o ?? "",
        destination: "wip/search",
      }),
    )
    expect(await readCommits(rig.ops, "wip/search & mutable()")).toEqual([o])
    // The WIP's bookmark deleted, its work never on accepted work: gone.
    await rig.repoJj(["bookmark", "delete", "wip/search"])
    expect(await gatherPlace({ jj: rig.ops }, input)).toEqual({
      kind: "gone",
      tip,
      base: await laneBase(rig.ops, tip, rig.line),
    })
  }, 60_000)

  describe("pre-rename: a lane's disk and history from before the rename", () => {
    /** `dir`'s lane runner: `/workspace` there, as a container's is. */
    const laneRunnerAt =
      (dir: string): Runner =>
      argv =>
        hostRunner(dir)(
          onHost([{ in: "lane", argv }], { "/workspace": dir })[0]?.argv ?? [],
        )
    /** The lane's disk as a snapshot from before the rename holds it. */
    const makeOld = async (jj: Runner, dir: string) => {
      await jj(["bookmark", "rename", bookmarkName(LANE), `pineta/${LANE}`])
      await jj(["bookmark", "create", "pineta/fetched/0", "-r", "@-"])
      await rename(
        path.join(dir, ".pinetrie-lane"),
        path.join(dir, ".pineta-lane"),
      )
    }

    test("the old names on a disk: no bookmark, until planOldNamesOnDisk renames them; then nothing is left to plan", async () => {
      const { laneDir, laneJj, inLane, first } = await turnRig("old-disk")
      await makeOld(laneJj, laneDir)
      expect((await copyFacts(laneJj, LANE)).bookmark).toBeNull()
      const lane = laneRunnerAt(laneDir)
      await inLane(planOldNamesOnDisk(await oldNamesOnDisk(lane), LANE))
      expect(await copyFacts(laneJj, LANE)).toEqual({
        parents: [first],
        bookmark: first,
        descends: false,
      })
      expect(
        await readFile(path.join(laneDir, ".pinetrie-lane", "jj.toml"), "utf8"),
      ).toContain("immutable_heads()")
      expect(await readCommits(laneJj, 'bookmarks(glob:"pineta/*")')).toEqual(
        [],
      )
      expect(planOldNamesOnDisk(await oldNamesOnDisk(lane), LANE)).toEqual([])
    }, 60_000)

    test("a fork of a disk holding the old config folder commits nothing of it", async () => {
      const { laneDir, inLane, edit, first } = await turnRig("old-fork")
      const forkDir = path.join(top, "old-fork-fork")
      await mkdir(path.join(laneDir, ".pineta-lane"), { recursive: true })
      await writeFile(path.join(laneDir, ".pineta-lane", "jj.toml"), "# old\n")
      await cp(laneDir, forkDir, { recursive: true, verbatimSymlinks: true })
      // A fork's steps on its disk: `planFork`'s removal, then the setup.
      await inLane(
        [
          laneShell(`rm -rf ${OLD_LANE_CONFIG_DIR}`),
          ...planForkSetup(jjLaneFor(FORK), {
            kind: "recorded",
            points: [first].map(pointFromCommit),
          }),
        ],
        forkDir,
      )
      const forkJj = laneJjAt(forkDir)
      await edit(forkDir, "f.txt", "f\n")
      const turned = await turnOn(forkJj, {
        ...TURN,
        lane: FORK,
        entry: entryId("e-f"),
      })
      if (turned === null) throw new Error("the fork's turn committed nothing")
      expect(await changedPaths(forkJj, first, turned)).toEqual(["f.txt"])
      expect(await readCommits(forkJj, 'files(root:".pineta-lane")')).toEqual(
        [],
      )
    }, 60_000)

    test("an old lane on accepted work: its Pineta-Base on pineta-onto reads as accepted work, the batched read and the separate reads alike; its proposed changes start above what it had accepted", async () => {
      const rig = await proposedRig("old-base")
      const { repoDir, repoJj, laneDir, laneJj, ops, line, inLane, edit } = rig
      await edit(repoDir, "base.txt", "base\n")
      await repoJj(["commit", "-m", "your base"])
      await rig.setUpAccepted()
      const onAccepted = await rig.acceptedNow()
      await inLane(planBaseCheckout({ accepted: [onAccepted], fresh: true }))
      await inLane(
        planForkSetup(jjLaneFor(LANE), {
          kind: "recorded",
          points: [onAccepted].map(pointFromCommit),
        }),
      )
      // The base as the host wrote it before the pine·trie rename.
      await laneJj([
        "new",
        "-m",
        `update: pineta-onto\n\nPineta-Base: pineta-onto@${onAccepted}\n`,
      ])
      await laneJj(["new"])
      await laneJj([
        "bookmark",
        "set",
        "--allow-backwards",
        bookmarkName(LANE),
        "-r",
        "@-",
      ])
      await edit(laneDir, "a.txt", "a\n")
      const t1 = await rig.turn()
      await rig.fetch([onAccepted])
      const tip = await laneTipIn(ops, LANE)
      if (tip === null) throw new Error("no tip")
      expect(await laneBase(ops, tip, line)).toEqual({
        base: { kind: "accepted" },
        start: onAccepted,
        source: onAccepted,
      })
      await rig.agrees()

      // Proposed changes accepted before the rename, as it was written then.
      await rig.build([
        {
          commit: t1,
          description: `WIP\n\nPineta-Thread: ${NAME}\nPineta-Lane: ${LANE}\nPineta-Entry: e\nPineta-Source: ${t1}\nPineta-Start: ${onAccepted}\n`,
        },
      ])
      const [accepted] = await readCommits(
        ops,
        bookmarkRevset(proposedBookmark(NAME)),
      )
      if (accepted === undefined) throw new Error("no proposed changes")
      expect(
        (await ops(["log", "--no-graph", "-r", accepted, "-T", "description"]))
          .stdout,
      ).toContain("Pineta-Source")
      await executeRepo(
        repoDir,
        planAcceptanceSteps({
          bookmark: proposedBookmark(NAME),
          top: accepted,
          destination: line.acceptedBookmark,
        }),
      )
      // You edit what it brought, on accepted work: proposed changes that
      // started below it would put the lane's a.txt back over yours.
      await repoJj(["new", line.acceptedBookmark])
      await edit(repoDir, "a.txt", "a, then yours\n")
      await repoJj(["commit", "-m", "yours: a.txt"])
      await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
      await edit(laneDir, "b.txt", "b\n")
      await rig.turn()
      expect((await rig.proposed([t1])).files).toEqual(["b.txt"])
    }, 60_000)
  })

  test("a base refreshes after your @- was rewritten, not built on", async () => {
    const repoDir = path.join(top, "rewritten-yours")
    const baseDir = path.join(top, "rewritten-base")
    await run("mkdir", ["-p", repoDir, baseDir])
    await run("jj", ["git", "init", "--colocate", repoDir])
    const repoJj = hostJj(repoDir)
    const inBase = (steps: readonly LaneStep[]) =>
      executeOrThrow(
        onHost(steps, {
          "/mnt/host-working-copy": repoDir,
          "/workspace": baseDir,
        }),
        {
          lane: hostRunner(baseDir),
          laneBytes: hostBytesRunner(baseDir),
        },
      )
    await writeFile(path.join(repoDir, "a.txt"), "first\n")
    await repoJj(["commit", "-m", "yours"])
    const first = await readCommits(repoJj, "@-")
    await inBase(planBaseCheckout({ accepted: first, fresh: true }))
    // Your @- rewritten in place: the base's commit is no ancestor of it.
    await writeFile(path.join(repoDir, "a.txt"), "rewritten\n")
    await repoJj(["squash", "--into", "@-"])
    const rewritten = await readCommits(repoJj, "@-")
    expect(rewritten).not.toEqual(first)
    await inBase(planBaseCheckout({ accepted: rewritten, fresh: false }))
    expect(await readFile(path.join(baseDir, "a.txt"), "utf8")).toBe(
      "rewritten\n",
    )
  })
})
