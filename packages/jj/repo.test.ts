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
  type CatchUpRead,
  type CommitId,
  commitId,
  type EntryId,
  entryId,
  entryOfMessage,
  firstLine,
  hasTrailer,
  NO_EDITOR,
  type OfferSource,
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
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { acceptedFacts } from "./accepted.ts"
import { catchUpFiles, readCatchUp } from "./catch-up.ts"
import {
  acceptedIn,
  acceptOffer,
  buildOffer,
  fetchLane,
  jjLaneFor,
  knownStart as knownStartOf,
  offerTip,
} from "./fixtures.ts"
import { laneBase } from "./lane/base.ts"
import { bookmarkOf } from "./lane/bookmarks.ts"
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
  hostOfferRef,
  offerBookmark,
  revsetName,
  stackBookmark,
} from "./lane/names.ts"
import {
  fetchById,
  planBaseCheckout,
  planForkSetup,
  planMerge,
  planOldNamesOnDisk,
  planWipCopy,
} from "./lane/plan.ts"
import {
  ACCEPTED_OFFER_COMMIT_ROW,
  changedPaths,
  commitsOf,
  commitTurn,
  conflictedFilesAt,
  copyFacts,
  oldNamesOnDisk,
  parseAcceptedOfferCommits,
} from "./lane/revisions.ts"
import { gatherLane } from "./lane-read.ts"
import {
  changeOf,
  fileDiff,
  hostCommitIn,
  hostVersionOf,
  laneTipIn,
  offerRevisions,
  readOffer,
  revisionRead,
  startOfOffer,
  workChanges,
} from "./offer.ts"
import {
  gatherOffer,
  gatherOfferAcceptance,
  gatherPlace,
  gatherStack,
} from "./offer-gather.ts"
import { repairOffer } from "./offer-repair.ts"
import {
  forgetSteps,
  IMPORT,
  immutableHeads,
  laneRefSteps,
  logRevset,
  markSteps,
  planAbandonOffer,
  planCatchUpUndo,
  planDescribe,
  planOffer,
  planOfferAcceptanceSteps,
  planPublishCatchUp,
  planPublishMove,
  planRebuildOffer,
  planRefreshOffer,
  planSetup,
} from "./plan.ts"
import { executeRepo, hostJj, hostOps, runnerFor } from "./run.ts"
import { readShared } from "./shared.ts"
import { git, host } from "./step.ts"

const LANE = threadIdFor("1")
const NAME = "amber-fox" as ThreadName
const FORK = threadIdFor("2")
const ROOT = threadIdFor("3")
const TURN = { lane: LANE, title: "a turn" }

/** Where `LANE`'s offer starts, as commits: a test of an untraced start reads `startOfOffer` itself. */
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
      bookmark: await bookmarkOf(jj, input.lane),
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
    const yoursDir = path.join(top, "yours")
    const laneDir = path.join(top, "lane")
    const forkDir = path.join(top, "fork")
    const rootDir = path.join(top, "root-fork")
    await run("mkdir", ["-p", yoursDir, laneDir])
    await run("jj", ["git", "init", "--colocate", yoursDir])
    const yoursJj = hostJj(yoursDir)
    const yoursOps = hostOps(yoursDir)
    const laneJj = laneJjAt(laneDir)
    const runners = (dir: string) => ({
      lane: hostRunner(dir),
      laneBytes: hostBytesRunner(dir),
    })
    const inLane = (dir: string, steps: readonly LaneStep[]) =>
      executeOrThrow(
        onHost(steps, {
          "/mnt/host-working-copy": yoursDir,
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
      fetchLane(runners(dir), yoursDir, {
        lane,
        have,
        bundle: path.join(top, `${lane}.bundle`),
      })

    // Your committed work: a file with three lines.
    await writeFile(path.join(yoursDir, "shared.txt"), "one\ntwo\nthree\n")
    await yoursJj(["commit", "-m", "your base"])
    const base = await commitsOf(yoursJj, "@-")
    expect(base).toHaveLength(1)

    // The base disk: git and jj initialized, your @- fetched by id, jj new.
    await inLane(laneDir, planBaseCheckout({ yours: base, fresh: true }))
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
    expect(await bookmarkOf(laneJj, LANE)).toBe(base[0])
    // The same change ids on both sides.
    expect(await changeOf(laneJj, base[0] ?? "")).toBe(
      await changeOf(yoursOps, base[0] ?? ""),
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
    expect(await bookmarkOf(laneJj, LANE)).toBe(r1)
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
    expect(await laneTipIn(yoursOps, LANE)).toBe(r1)
    // The import is the host's operation, as every write of the host's is.
    expect(
      (await yoursOps(["op", "log", "--no-graph", "-n", "1", "-T", "user"]))
        .stdout,
    ).toMatch(/^pinetrie-host@/)
    expect(await commitsOf(yoursJj, 'bookmarks(glob:"pinetrie/*")')).toEqual([])
    expect(await defaultLog(yoursJj)).not.toContain("edit line two")
    expect((await yoursJj(["describe", "-r", r1, "-m", "rewritten"])).ok).toBe(
      false,
    )
    // Nor can the lane rewrite what it inherited.
    expect(
      (await laneJj(["describe", "-r", base[0] ?? "", "-m", "x"])).ok,
    ).toBe(false)

    // You change the same line on a WIP, and commit.
    await yoursJj(["new"])
    await writeFile(
      path.join(yoursDir, "shared.txt"),
      "one\ntwo (you)\nthree\n",
    )
    await yoursJj(["commit", "-m", "you edit line two"])
    await yoursJj(["bookmark", "create", "wip/x", "-r", "@-"])
    const wipNow = async () => {
      const [commit] = await commitsOf(yoursJj, "wip/x")
      if (commit === undefined) throw new Error("no wip")
      return { bookmark: "wip/x", commit, under: base[0] ?? commit }
    }

    // An update: a copy of the WIP made in the lane, on accepted commit
    // under it, merged; accepted work conflicts.
    const wip1 = await wipNow()
    await inLane(laneDir, [
      fetchById([wip1.commit, wip1.under]),
      ...planWipCopy(wip1, wip1.under),
    ])
    const [copy] = await commitsOf(laneJj, "@-")
    if (copy === undefined) throw new Error("no copy")
    expect(
      (await laneJj(["file", "show", "-r", copy, 'root:"shared.txt"'])).stdout,
    ).toContain("two (you)")
    // The copy is no commit of yours: your WIP stays yours.
    expect(await commitsOf(laneJj, `${copy} & ${wip1.commit}`)).toEqual([])
    expect(await newestBase(laneJj, copy, "wip/")).toEqual({
      at: copy,
      kind: "wip",
      bookmark: "wip/x",
      commit: wip1.commit,
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
    await yoursJj(["new"])
    await writeFile(path.join(yoursDir, "yours-only.txt"), "yours\n")
    await yoursJj(["commit", "-m", "you add a file"])
    await yoursJj(["bookmark", "move", "wip/x", "--to", "@-"])
    // The next copy sits on the last one: the merge brings in only what
    // the WIP changed since, not accepted work two the lane already resolved.
    const wip2 = await wipNow()
    await inLane(laneDir, [
      fetchById([wip2.commit]),
      ...planWipCopy(wip2, copy),
    ])
    const [cleanCopy] = await commitsOf(laneJj, "@-")
    if (cleanCopy === undefined) throw new Error("no copy")
    const updated = await mergeBase(laneJj, LANE, cleanCopy, "update: wip/x")
    expect(updated.merge).not.toBeNull()
    expect(await conflictsIn(laneJj)).toEqual([])
    const newest = await bookmarkOf(laneJj, LANE)
    expect(
      (
        await commitsOf(
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
    expect(await commitsOf(yoursJj, "divergent()")).toEqual([])
    expect(await laneTipIn(yoursOps, FORK)).toBe(forkNext)
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
      planForkSetup(jjLaneFor(ROOT), { kind: "wip", ...(await wipNow()) }),
    )
    const rootJj = laneJjAt(rootDir)
    expect(await readFile(path.join(rootDir, "yours-only.txt"), "utf8")).toBe(
      "yours\n",
    )
    const [rootCopy] = await commitsOf(
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
    expect(await commitsOf(yoursJj, "divergent()")).toEqual([])
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
  // its commit: the offer holds it, and a branch at that turn starts with it.
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
      const [mine] = await commitsOf(
        laneJj,
        `description(exact:"mine\n") & ::@`,
      )
      expect(turn).toBe(mine)
      expect(await bookmarkOf(laneJj, LANE)).toBe(mine)

      // The offer: your repo fetches the lane's bookmark, which holds b.txt.
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
      yoursDir,
      laneDir,
      yoursJj,
      laneJj,
      line,
      edit,
      setUpAccepted,
      acceptedNow,
    } = await offerRig("update")
    const dirs = { "/mnt/host-working-copy": yoursDir, "/workspace": laneDir }
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
    const yours = async (file: string, text: string, title: string) => {
      await edit(yoursDir, file, text)
      await yoursJj(["commit", "-m", title])
    }
    const moveAccepted = () =>
      yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
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
      const at = await bookmarkOf(laneJj, LANE)
      if (at === null) throw new Error("no lane head")
      return at
    }

    await edit(yoursDir, "a.txt", "a\n")
    await edit(yoursDir, "b.txt", "b\n")
    await yours("c.txt", "c\n", "your base")
    await setUpAccepted()
    const [base] = await commitsOf(yoursJj, "@-")
    if (base === undefined) throw new Error("no base")
    await executeOrThrow(
      planBaseCheckout({ yours: [base], fresh: true }),
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
    await yours("a.txt", "a (yours)\n", "yours one")
    await yours("c.txt", "c (yours)\n", "yours two\n\nwith a body")
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
    // What `catchUpFiles` said catching up would change, it changed.
    expect(
      (
        await catchUpFiles(laneRoot, { holds: [base], to: line1, tip: before })
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
    await yours("a.txt", "a (yours, again)\n", "yours a")
    await edit(yoursDir, "c.txt", "c (yours, again)\n")
    await yours("b.txt", "b (yours)\n", "yours b and c")
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
    const ours = await bookmarkOf(laneJj, LANE)
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
    expect(await bookmarkOf(laneJj, LANE)).toBe(moved.mark)
    expect(
      await newestBase(laneJj, bookmarkRevset(bookmarkName(LANE)), "wip/"),
    ).toEqual({
      at: moved.mark,
      kind: "accepted",
      commit: await acceptedNow(),
    })

    // (d) A WIP's copy, then the next on it: a commit only the lane has.
    const line2 = await acceptedNow()
    await yoursJj(["new", line2])
    await yours("w.txt", "w1\n", "wip one")
    await yoursJj(["bookmark", "create", "wip/x", "-r", "@-"])
    const [w1] = await commitsOf(yoursJj, "@-")
    if (w1 === undefined) throw new Error("no wip")
    const wipMerge = (commit: CommitId, on: CommitId) =>
      planMerge(jjLaneFor(LANE), {
        kind: "wip",
        bookmark: "wip/x",
        commit,
        under: line2,
        on: pointFromCommit(on),
      })
    const beforeFirst = await head()
    const first = await mergeUpdate(laneJj, runners, LANE, wipMerge(w1, line2))
    expect(first).toMatchObject({
      kind: "clean",
      files: ["w.txt"],
      commits: ["wip one"],
    })
    if (first.kind !== "clean") throw new Error("not clean")
    expect(
      await catchUpFiles(laneRoot, {
        holds: [line2],
        to: w1,
        tip: beforeFirst,
      }),
    ).toEqual(["w.txt"])
    await yours("w.txt", "w2\n", "wip two")
    await yoursJj(["bookmark", "move", "wip/x", "--to", "@-"])
    const [w2] = await commitsOf(yoursJj, "@-")
    if (w2 === undefined) throw new Error("no wip")
    expect(await commitsOf(yoursJj, `present(${first.from})`)).toEqual([])
    const beforeNext = await head()
    const next = await mergeUpdate(
      laneJj,
      runners,
      LANE,
      wipMerge(w2, first.from),
    )
    expect(next).toMatchObject({
      kind: "clean",
      files: ["w.txt"],
      commits: ["wip two", "wip one"],
    })
    if (next.kind !== "clean") throw new Error("not clean")
    expect(await commitsOf(laneJj, `${next.from}-`)).toEqual([first.from])
    // From the lane's copy, the WIP's base start, to the WIP's commit.
    expect(
      await catchUpFiles(laneRoot, {
        holds: [first.from],
        to: w2,
        tip: beforeNext,
      }),
    ).toEqual(["w.txt"])
  }, 60_000)

  test("an update merges on an adopted commit; a stack's commits are never adopted", async () => {
    const {
      laneDir,
      yoursJj,
      yoursDir,
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
    await edit(yoursDir, "yours.txt", "yours\n")
    await yoursJj(["commit", "-m", "you add a file"])
    await yoursJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
    const line = await acceptedNow()
    await inLane([fetchById([line])])
    const { ours, merge } = await mergeBase(laneJj, LANE, line, "update")
    expect(ours).toBe(mine)
    expect(await filesAt(laneJj, merge ?? "none()")).toEqual(
      expect.arrayContaining(["b.txt", "yours.txt"]),
    )

    // A stack, as a split builds one: revisions on the offer's start, below
    // the lane's bookmark, under a bookmark of their own. No turn adopts
    // them, so the lane's own bookmark stays where it was.
    await laneJj(["new", base[0] ?? ""])
    await edit(laneDir, "s.txt", "s\n")
    await laneJj(["commit", "-m", "s1: s.txt"])
    await laneJj(["bookmark", "set", stackBookmark(LANE), "-r", "@-"])
    expect(await turnOn(laneJj, { ...TURN, entry: entryId("e-3") })).toBeNull()
    expect(await bookmarkOf(laneJj, LANE)).toBe(merge)
  }, 60_000)

  test("a review reads an offer's commit: its description, files and one file's diff", async () => {
    const { laneDir, yoursJj, ops, laneJj, fetch, edit, build, base } =
      await turnRig("review")
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
    const offer = await build([
      { commit: tip, description: "feat: lane\n\nwhy\n" },
    ])
    const [w] = offer.commits
    const [change] = offer.changes
    if (w === undefined || change === undefined) throw new Error("no offer")

    const span = { kind: "revision", commit: w } as const
    const read = await revisionRead(ops, span, sshAuthority)
    expect(read).toEqual({
      description: "feat: lane\n\nwhy\n",
      files: expect.arrayContaining([
        {
          path: "a b.txt",
          shown: "a b.txt",
          change: "added",
          added: 1,
          removed: 0,
        },
        {
          path: 'we"ird',
          shown: 'we"ird',
          change: "added",
          added: 1,
          removed: 0,
        },
        {
          path: "dir/f.txt",
          shown: "dir/f.txt",
          change: "added",
          added: 1,
          removed: 0,
        },
        {
          path: "a.txt",
          shown: "a.txt",
          change: "added",
          added: 2,
          removed: 0,
        },
        {
          path: "moved.txt",
          shown: "{base.txt => moved.txt}",
          change: "renamed",
          added: 0,
          removed: 0,
        },
      ]),
      widenings: [{ kind: "ssh" }],
    })
    expect(await fileDiff(ops, span, 'we"ird')).toContain("+quote")
    expect(await fileDiff(ops, span, "a b.txt")).toContain("+space")
    // One file exactly: a directory's name names none of its files.
    expect(await fileDiff(ops, span, "dir")).toBe("")
    expect(await fileDiff(ops, span, "dir/f.txt")).toContain("+under")

    // A range reads the same files, with no description, its counts from
    // the range's git diff: here the range is the revision.
    const [parent] = await commitsOf(ops, `${w}-`)
    if (parent === undefined) throw new Error("no parent")
    const range = { kind: "range", from: parent, to: w } as const
    const byPath = (r: unknown) =>
      [...((r as { files: { path: string }[] } | null)?.files ?? [])].sort(
        (a, b) => a.path.localeCompare(b.path),
      )
    const ranged = await revisionRead(ops, range, sshAuthority)
    expect(ranged).toMatchObject({
      description: "",
      widenings: [{ kind: "ssh" }],
    })
    expect(byPath(ranged)).toEqual(byPath(read))
    expect(await fileDiff(ops, range, 'we"ird')).toContain("+quote")

    // You reword the offer: its commit changes, and the review of the new
    // one reads your words. `readOffer` finds it by its bookmark.
    await yoursJj([
      "describe",
      "--ignore-immutable",
      "-r",
      change,
      "-m",
      "feat: as I want it",
    ])
    const facts = await readOffer(ops, {
      name: NAME,
      target: "pinetrie-accepted",
    })
    const [now] = facts?.kind === "offer" ? facts.revisions : []
    if (now === undefined) throw new Error("no commit")
    expect(now.commit).not.toBe(w)
    expect(
      await revisionRead(
        ops,
        { kind: "revision", commit: now.commit },
        sshAuthority,
      ),
    ).toMatchObject({
      description: "feat: as I want it\n",
    })
    expect(
      await revisionRead(
        ops,
        { kind: "revision", commit: commitId("1".repeat(40)) },
        sshAuthority,
      ),
    ).toBeNull()
  }, 60_000)

  /**
   * Your repo and one lane's, in `top/<tag>-…`, with the lane's steps run on
   * the host. Its offers are built and accepted by the steps the port
   * suite's harness shares (`fixtures.ts`); `offer` and `accept` check
   * after each that the batched read agrees (`agrees`).
   */
  const offerRig = async (tag: string) => {
    const yoursDir = path.join(top, `${tag}-yours`)
    const laneDir = path.join(top, `${tag}-lane`)
    await run("mkdir", ["-p", yoursDir, laneDir])
    await run("jj", ["git", "init", "--colocate", yoursDir])
    const yoursJj = hostJj(yoursDir)
    const ops = hostOps(yoursDir)
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
          "/mnt/host-working-copy": yoursDir,
          "/workspace": dir,
        }),
        runnersAt(dir),
      )
    const fetch = (have: readonly CommitId[]) =>
      fetchLane(runners, yoursDir, {
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
        yoursDir,
        planSetup({
          acceptedBookmark: line.acceptedBookmark,
          heads: immutableHeads(line, null),
          log: logRevset(null),
        }),
      )
    const build = (sources: readonly OfferSource[], name: ThreadName = NAME) =>
      buildOffer(yoursDir, { lane: LANE, name, sources, repoConfig: line })
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
     * `dir`: `planMerge`, then `mergeUpdate`, which joins the accepted-offer
     * commits it holds first.
     */
    const catchUp = async (dir = laneDir, lane: ThreadId = LANE) => {
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
     * The one batched read (`gatherLane`) says what the separate reads say:
     * the lane's tip, base and start, the offer, whether its work changes
     * any file, and what catching up would change. Returns that read.
     */
    const agrees = async () => {
      const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
        .stdout
      const shared = await readShared(op, ops, runnerFor(yoursDir, "git"), line)
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
      if (base.base.kind === "wip") {
        expect(gathered).toBe("wip")
        return gathered
      }
      const target = await acceptedNow()
      const start = await startOfOffer(ops, {
        tip,
        base,
        repoConfig: line,
        lane: LANE,
      })
      const offer = await readOffer(ops, { name: NAME, target })
      expect(gathered).toEqual({
        tip,
        base,
        target,
        start,
        offer,
        hostLeft:
          offer === null &&
          (await hostVersionOf(ops, offerBookmark(NAME))) !== null,
        work: await workChanges(ops, { start, tip }),
        catchUp: await readCatchUp(ops, {
          base,
          start,
          target: { kind: "accepted", commit: target },
          tip,
          known: null,
        }),
      })
      return gathered
    }
    /** An offer of the lane's tip, fetched from `from`, its ledger naming the tip. */
    const offer = async (from: readonly CommitId[]) => {
      await fetch(from)
      const built = await offerTip(yoursDir, {
        lane: LANE,
        name: NAME,
        repoConfig: line,
      })
      const [commit] = built.commits
      if (commit === undefined) throw new Error("no offer")
      await agrees()
      return {
        built,
        conflicted:
          (await commitsOf(ops, `${commit} & conflicts()`)).length > 0,
        files: lines((await ops(["diff", "-r", commit, "--name-only"])).stdout),
      }
    }
    /** Accept `offered` into accepted work: its bookmark moved forward, as the host. */
    const accept = async (offered: {
      readonly built: { readonly changes: readonly string[] }
    }) => {
      const [change] = offered.built.changes
      if (change === undefined) throw new Error("no offer")
      await acceptOffer(yoursDir, { name: NAME, top: change, repoConfig: line })
      await agrees()
    }
    return {
      agrees,
      yoursDir,
      laneDir,
      yoursJj,
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
      catchUp,
      offer,
      accept,
    }
  }

  /** `offerRig`, with your base commit as accepted work, the lane started on it, and a first turn writing `a.txt`. */
  const turnRig = async (tag: string) => {
    const rig = await offerRig(tag)
    await rig.edit(rig.yoursDir, "base.txt", "base\n")
    await rig.yoursJj(["commit", "-m", "your base"])
    const base = await commitsOf(rig.yoursJj, "@-")
    const [line] = base
    if (line === undefined) throw new Error("no base")
    await rig.setUpAccepted()
    await rig.inLane(planBaseCheckout({ yours: base, fresh: true }))
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

  test("an offer on accepted work: built, immutable, refreshed, followed, accepted by a forward move, and the next one", async () => {
    const {
      yoursDir,
      laneDir,
      yoursJj,
      ops,
      laneJj,
      line,
      fetch,
      edit,
      build,
      acceptedNow,
      accept,
      offer,
      base,
      agrees,
    } = await turnRig("offer")
    const bookmark = offerBookmark(NAME)
    await fetch(base)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You work on above accepted work: your stack is yours, and mutable.
    await edit(yoursDir, "c.txt", "c yours\n")
    await yoursJj(["commit", "-m", "yours: c.txt"])
    await edit(yoursDir, "wip.txt", "wip\n")

    // Built by the host on accepted work: immutable, so you cannot edit it by
    // accident; the host's own rewrites pass `--ignore-immutable`.
    const one = await build([
      {
        commit: t1,
        description: `offer: lane\n\nPinetrie-Source: ${t1}\nPinetrie-Start: ${base[0]}\n`,
      },
    ])
    const [c1] = one.changes
    const [w1] = one.commits
    if (c1 === undefined || w1 === undefined) throw new Error("no offer")
    expect(one.read).toMatchObject({
      files: ["a.txt"],
      onTarget: true,
      placed: true,
      // Its ledger, read from its message: no record needed.
      ledger: { source: t1, start: base },
    })
    expect((await yoursJj(["describe", "-r", c1, "-m", "mine"])).ok).toBe(false)
    // Yet your log shows it: setup added the offers to `revsets.log`, since
    // jj's default leaves an immutable head out.
    expect(
      (
        await yoursJj([
          "log",
          "--no-graph",
          "-T",
          'description.first_line() ++ "\\n"',
        ])
      ).stdout,
    ).toContain("offer: lane")
    expect(
      (await commitsOf(yoursJj, `${c1} & immutable()`)).length,
    ).toBeGreaterThan(0)
    expect(
      (
        await commitsOf(
          yoursJj,
          `description(exact:"yours: c.txt\n") & mutable()`,
        )
      ).length,
    ).toBe(1)
    await executeRepo(yoursDir, planDescribe(c1, "offer: described"))

    // The host rewrote it, and nothing recorded that: its newest version is
    // the host's, so it is not yours.
    const sinceNow = async () => {
      const read = await readOffer(ops, {
        name: NAME,
        target: await acceptedNow(),
      })
      return read?.kind === "offer" ? read.revisions.map(r => r.since) : null
    }
    expect(await sinceNow()).toEqual([{ reached: true, yoursChanged: false }])
    // Your reword of the offer, on purpose: a change of yours, an edit.
    await yoursJj([
      "describe",
      "--ignore-immutable",
      "-r",
      c1,
      "-m",
      "as I want",
    ])
    expect(await sinceNow()).toEqual([{ reached: true, yoursChanged: true }])
    await executeRepo(
      yoursDir,
      planDescribe(c1, `offer: lane\n\nPinetrie-Source: ${t1}\n`),
    )

    // A race: your edit and a host rewrite from the same operation make it
    // divergent. The host keeps yours.
    const opNow = async () =>
      (
        await yoursJj([
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
    await yoursJj(["describe", "--ignore-immutable", "-r", c1, "-m", "yours"])
    await ops([
      "--at-operation",
      op,
      "--ignore-immutable",
      "describe",
      "-r",
      c1,
      "-m",
      `offer: lane\n\nPinetrie-Source: ${t1}\n\nhost`,
    ])
    // Divergent: the batched read says so too.
    await agrees()
    const split = await hostCommitIn(
      ops,
      c1,
      await hostVersionOf(ops, bookmark),
    )
    if (split === null) throw new Error("no split")
    await repairOffer(
      { jj: ops, execute: steps => executeRepo(yoursDir, steps) },
      { bookmark, changes: [c1] },
    )
    // Repaired: yours, edited.
    await agrees()
    expect(await commitsOf(yoursJj, "divergent()")).toEqual([])
    expect(await commitsOf(yoursJj, `bookmarks(exact:"${bookmark}")`)).toEqual([
      split.yours,
    ])
    await yoursJj([
      "describe",
      "--ignore-immutable",
      "-r",
      c1,
      "-m",
      // As the host writes it: so the next offer's revisions are told
      // from this one, accepted, by its base, not its trailer.
      `offer: lane\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${t1}\n`,
    ])

    // Accept: accepted work moved forward to the offer, as the host; your @ and
    // the working copy untouched; the offer's bookmark gone.
    const atBefore = await commitsOf(yoursJj, "@")
    await accept({ built: one })
    expect(await commitsOf(yoursJj, "@")).toEqual(atBefore)
    expect(await readFile(path.join(yoursDir, "wip.txt"), "utf8")).toBe("wip\n")
    expect(await changeOf(ops, await acceptedNow())).toBe(c1)
    expect(
      await commitsOf(ops, `present(bookmarks(exact:"${bookmark}"))`),
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
    await yoursJj(["new", line.acceptedBookmark])
    await edit(yoursDir, "a.txt", "a, then yours\n")
    await yoursJj(["commit", "-m", "yours: a.txt"])
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])

    // The next turn: its offer starts at what the accepted-offer commit's Pinetrie-Source names,
    // and holds only what came after; it does not bring a.txt back.
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (t2 === null) throw new Error("no turn")
    const next = await offer([t1])
    expect(next.files).toEqual(["b.txt"])
    expect(next.conflicted).toBe(false)
    // You reword your commit under it: jj rebases the offer, as your
    // operation, but changes nothing in it, so it is not yours.
    await yoursJj([
      "describe",
      "--ignore-immutable",
      "-r",
      line.acceptedBookmark,
      "-m",
      "yours: a.txt, reworded",
    ])
    expect(await sinceNow()).toEqual([{ reached: true, yoursChanged: false }])

    // The lane moves on: the offer is rebuilt from it in place, its
    // change kept, holding what a fresh build would.
    await edit(laneDir, "f.txt", "f\n")
    const t3 = await turnOn(laneJj, { ...TURN, entry: entryId("e-3") })
    if (t3 === null) throw new Error("no turn")
    await fetch([t2])
    const [nc] = next.built.changes
    if (nc === undefined) throw new Error("no offer")
    const b3 = await laneBase(ops, t3, line)
    if (b3 === null) throw new Error("no base")
    await executeRepo(
      yoursDir,
      planRebuildOffer({
        change: nc,
        start: await knownStart(ops, { tip: t3, base: b3, repoConfig: line }),
        tip: t3,
        target: await acceptedNow(),
        description: `WIP\n\nPinetrie-Source: ${t3}\n`,
      }),
    )
    const [followed] = await commitsOf(ops, `change_id(${nc})`)
    expect(
      lines((await ops(["diff", "-r", followed ?? "", "--name-only"])).stdout),
    ).toEqual(["b.txt", "f.txt"])
    expect(await commitsOf(ops, `${followed} & conflicts()`)).toEqual([])
    await agrees()

    // A stack: one revision per lane revision, each with its own file.
    await executeRepo(yoursDir, planAbandonOffer(next.built.changes))
    await laneJj(["new", t2])
    await edit(laneDir, "d.txt", "d\n")
    await laneJj(["commit", "-m", "s1: d.txt"])
    await edit(laneDir, "e.txt", "e\n")
    await laneJj(["commit", "-m", "s2: e.txt"])
    const [s1] = await commitsOf(laneJj, "@--")
    const [s2] = await commitsOf(laneJj, "@-")
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
    // above the accepted offer and your commit under it, which are on accepted work.
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

  test("a squash of two accepted offers keeps both sources: the next offer starts above them", async () => {
    const {
      laneDir,
      yoursJj,
      ops,
      edit,
      offer,
      accept,
      turn,
      acceptedNow,
      base,
    } = await turnRig("squashed")
    const first = await offer(base)
    await accept(first)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turn()
    const second = await offer([t1])
    await accept(second)
    // You squash the two accepted offers, as jj's editor offers both messages.
    const line = await acceptedNow()
    const ran = await run(
      "jj",
      [
        "-R",
        (await yoursJj(["root"])).stdout.trim(),
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
    expect((await offer([t2])).files).toEqual(["c.txt"])
    expect(await commitsOf(ops, "divergent()")).toEqual([])
  }, 60_000)

  test("an offer after a catch-up starts at accepted work it merged, not at what you accepted below it", async () => {
    const {
      laneDir,
      yoursDir,
      yoursJj,
      ops,
      line,
      edit,
      offer,
      accept,
      turn,
      update,
      acceptedNow,
      base,
    } = await turnRig("caught-up")
    await accept(await offer(base))
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You change accepted work you accepted into, then the lane catches up
    // with it: the accepted-offer commit is joined to the lane's commit, so
    // the merge is clean, and the lane has your text.
    await yoursJj(["new", line.acceptedBookmark])
    await edit(yoursDir, "a.txt", "a, then yours\n")
    await yoursJj(["commit", "-m", "yours: a.txt"])
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    expect(await update()).toEqual([])
    expect(await readFile(path.join(laneDir, "a.txt"), "utf8")).toBe(
      "a, then yours\n",
    )
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    // The accepted source is below accepted work the lane merged: the offer starts
    // there alone, and holds only what came after.
    const after = await offer([t1])
    expect([after.conflicted, after.files]).toEqual([false, ["c.txt"]])
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    expect(await knownStart(ops, { tip, base: b, repoConfig: line })).toEqual([
      await acceptedNow(),
    ])
  }, 60_000)

  test("a branch cloned from a conflicted catch-up: its offer's conflict came with its copy, and catching up with its parent settles it", async () => {
    const rig = await turnRig("parent")
    const { laneDir, yoursDir, yoursJj, ops, line, edit, offer, accept, turn } =
      rig
    const BRANCH = "copper-owl" as ThreadName
    // The parent changes base.txt; you change the same line on accepted work;
    // the parent catches up, and the merge stays conflicted.
    await edit(laneDir, "base.txt", "base, lane\n")
    await turn()
    await yoursJj(["new", line.acceptedBookmark])
    await edit(yoursDir, "base.txt", "base, yours\n")
    await yoursJj(["commit", "-m", "yours: base.txt"])
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
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
    expect(await conflictedFilesAt(rig.laneJj, merge)).toEqual(["base.txt"])
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
      fetchLane(forkRunners, yoursDir, {
        lane: FORK,
        have,
        bundle: path.join(top, "parent-fork.bundle"),
      })
    // Both resolve it the same way; the parent's is accepted.
    const resolved = "base, yours, lane\n"
    await edit(laneDir, "base.txt", resolved)
    const parentResolved = await turn()
    await accept(await offer(rig.base))
    await edit(forkDir, "base.txt", resolved)
    const resolving = await commitTurn(forkJj, {
      title: "resolve",
      entry: entryId("e-fork-1"),
      lane: FORK,
      bookmark: await bookmarkOf(forkJj, FORK),
    })
    expect(resolving.conflicted).toBe(false)
    await fetchFork(rig.base)
    // The branch's offer starts at the conflicted merge, and conflicts in
    // the file it started conflicted in.
    const branchOffer = async () => {
      const tip = await laneTipIn(ops, FORK)
      if (tip === null) throw new Error("no tip")
      const b = await laneBase(ops, tip, line)
      if (b === null) throw new Error("no base")
      const read = await startOfOffer(ops, {
        tip,
        base: b,
        repoConfig: line,
        lane: FORK,
      })
      if (read.kind !== "known") throw new Error("an untraced start")
      return { tip, base: b, start: read.start }
    }
    const before = await branchOffer()
    expect(before.start).toEqual([merge])
    await executeRepo(
      yoursDir,
      planOffer({
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
    const read = await readOffer(ops, {
      name: BRANCH,
      target: await rig.acceptedNow(),
    })
    expect(read).toMatchObject({
      kind: "offer",
      conflicts: ["base.txt"],
      startConflicts: ["base.txt"],
    })
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const gathered = await gatherLane(ops, {
      lane: FORK,
      name: BRANCH,
      repoConfig: line,
      shared: await readShared(op, ops, runnerFor(yoursDir, "git"), line),
      known: null,
    })
    expect(gathered).toMatchObject({
      offer: { conflicts: ["base.txt"], startConflicts: ["base.txt"] },
    })
    // The parent catches up with accepted work after the fork, past its own
    // accepted-offer commit;
    // then the branch catches up with the parent's newest commit, fetched
    // from your repo, where only the parent's ref reaches it.
    const acceptedCommit = await rig.acceptedNow()
    await rig.inLane([fetchById([acceptedCommit])])
    const caughtUp = await mergeBase(
      rig.laneJj,
      LANE,
      acceptedCommit,
      baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: acceptedCommit,
      }),
    )
    expect(caughtUp.merge).not.toBeNull()
    await rig.fetch([parentResolved])
    const newest = await laneTipIn(ops, LANE)
    if (newest === null) throw new Error("no parent tip")
    const plan = planMerge(jjLaneFor(LANE), {
      kind: "parent",
      lane: LANE,
      name: NAME,
      point: pointFromCommit(newest),
      caughtUpWith: pointFromCommit(merge),
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
    // its offer is withdrawn.
    const after = await branchOffer()
    expect(after.base.start).toBe(acceptedCommit)
    expect(
      await workChanges(ops, {
        start: { kind: "known", start: after.start },
        tip: after.tip,
      }),
    ).toBe("none")
  }, 60_000)

  describe("the host's version of an offer", () => {
    const BOOKMARK = offerBookmark(NAME)
    /** The offer as `readOffer` finds it on accepted work, whole. */
    const offerNow = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      const read = await readOffer(rig.ops, {
        name: NAME,
        target: await rig.acceptedNow(),
      })
      if (read?.kind !== "offer") throw new Error("no offer")
      return read
    }
    /** The commit tracked as the host's version, or none. */
    const tracked = (rig: Awaited<ReturnType<typeof turnRig>>) =>
      commitsOf(
        rig.ops,
        `tracked_remote_bookmarks(exact:${revsetName(BOOKMARK)}, remote=exact:${revsetName(HOST_REMOTE)})`,
      )
    /** Your repo's op log cut to its head, everything it held collected. */
    const cutHistory = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      await rig.yoursJj(["op", "abandon", "..@-"])
      await rig.yoursJj(["util", "gc", "--expire=now"])
    }
    const HOST = { reached: true, yoursChanged: false }

    test("an offer the host builds is its version, tracked, and reads as the host's with no evolog", async () => {
      const rig = await turnRig("host-built")
      await rig.offer(rig.base)
      const read = await offerNow(rig)
      expect(read.marked).toBe(true)
      expect(await tracked(rig)).toEqual([read.revisions[0]?.commit])
      expect(read.revisions.map(r => r.since)).toEqual([HOST])
    }, 60_000)

    test("you change the offer's file: it is no longer the host's version, and reads as your edit", async () => {
      const rig = await turnRig("host-yours")
      await rig.offer(rig.base)
      await rig.yoursJj(["new", BOOKMARK])
      await rig.edit(rig.yoursDir, "a.txt", "yours\n")
      const squashed = await rig.yoursJj([
        "squash",
        "--ignore-immutable",
        "--into",
        BOOKMARK,
      ])
      if (!squashed.ok) throw new Error(squashed.stderr)
      const read = await offerNow(rig)
      expect(read.marked).toBe(false)
      expect(read.revisions.map(r => r.since)).toEqual([
        { reached: true, yoursChanged: true },
      ])
      await rig.agrees()
    }, 60_000)

    test("a host step that stopped before its mark is not your edit, even once the op log is cut", async () => {
      const rig = await turnRig("host-unmarked")
      await rig.offer(rig.base)
      const [bottom] = (await offerNow(rig)).revisions
      if (bottom === undefined) throw new Error("no offer")
      await rig.edit(rig.yoursDir, "line.txt", "line\n")
      await rig.yoursJj(["commit", "-m", "accepted work moves"])
      await rig.yoursJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
      // The host's rebase, without the mark that follows it.
      await executeRepo(
        rig.yoursDir,
        planRefreshOffer(bottom.change, await rig.acceptedNow()),
      )
      const moved = await offerNow(rig)
      expect([moved.marked, moved.revisions.map(r => r.since)]).toEqual([
        false,
        [HOST],
      ])
      await rig.agrees()
      // One more operation, then the log cut to it: the evolog no longer
      // reaches the host's rebase, and the host's version says it.
      await rig.yoursJj(["new", "pinetrie-accepted"])
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
      expect((await offerNow(rig)).revisions.map(r => r.since)).toEqual([HOST])
      await executeRepo(rig.yoursDir, markSteps(BOOKMARK))
      expect((await offerNow(rig)).marked).toBe(true)
    }, 60_000)

    test("an offer built before offers had a host version reads as the host's by its evolog, and one mark makes it the version", async () => {
      const rig = await turnRig("host-legacy")
      await rig.offer(rig.base)
      // As an older host left it: the bookmark alone, with no host version.
      await executeRepo(rig.yoursDir, [
        host("bookmark", "untrack", BOOKMARK, "--remote", HOST_REMOTE),
        git("update-ref", "-d", hostOfferRef(BOOKMARK)),
        IMPORT,
      ])
      expect(await hostVersionOf(rig.ops, BOOKMARK)).toBeNull()
      const read = await offerNow(rig)
      expect([read.marked, read.revisions.map(r => r.since)]).toEqual([
        false,
        [HOST],
      ])
      await executeRepo(rig.yoursDir, markSteps(BOOKMARK))
      expect((await offerNow(rig)).marked).toBe(true)
      expect(await tracked(rig)).toHaveLength(1)
    }, 60_000)

    test("your edit races a host step that marked: its version names the host's commit, after the op log is cut too", async () => {
      const rig = await turnRig("host-race")
      await rig.offer(rig.base)
      const [bottom] = (await offerNow(rig)).revisions
      if (bottom === undefined) throw new Error("no offer")
      const op = (
        await rig.ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      ).stdout.trim()
      await executeRepo(rig.yoursDir, [
        ...planDescribe(bottom.change, "the host's\n"),
        ...markSteps(BOOKMARK),
      ])
      const marked = await hostVersionOf(rig.ops, BOOKMARK)
      await rig.yoursJj([
        "--at-operation",
        op,
        "describe",
        "--ignore-immutable",
        "-r",
        bottom.change,
        "-m",
        "yours\n",
      ])
      await rig.yoursJj(["new", "pinetrie-accepted"])
      await cutHistory(rig)
      const split = await hostCommitIn(
        rig.ops,
        bottom.change,
        await hostVersionOf(rig.ops, BOOKMARK),
      )
      expect(split?.hosts).toBe(marked)
    }, 60_000)

    test("you delete the offer's bookmark and build on its commit: the host's forget leaves your commits where they are", async () => {
      const rig = await turnRig("host-forget")
      await rig.offer(rig.base)
      const offered = (await commitsOf(rig.ops, BOOKMARK))[0]
      await rig.yoursJj(["bookmark", "delete", BOOKMARK])
      await rig.yoursJj(["new", "--ignore-immutable", offered ?? ""])
      await rig.edit(rig.yoursDir, "mine.txt", "mine\n")
      await rig.yoursJj(["commit", "-m", "mine, on the old offer"])
      const mine = await commitsOf(rig.ops, "@-")
      const below = await commitsOf(rig.ops, "::@-")
      await executeRepo(rig.yoursDir, forgetSteps(BOOKMARK))
      expect(await hostVersionOf(rig.ops, BOOKMARK)).toBeNull()
      expect(await commitsOf(rig.ops, "@-")).toEqual(mine)
      expect(await commitsOf(rig.ops, "::@-")).toEqual(below)
    }, 60_000)

    test("an acceptance forgets the offer's bookmark and the host's version, and accepted work holds the commit", async () => {
      const rig = await turnRig("host-accept")
      const offered = await rig.offer(rig.base)
      const [top] = offered.built.commits
      await rig.accept(offered)
      expect(await hostVersionOf(rig.ops, BOOKMARK)).toBeNull()
      expect(
        await commitsOf(rig.ops, `present(${bookmarkRevset(BOOKMARK)})`),
      ).toEqual([])
      expect(await rig.acceptedNow()).toBe(top)
    }, 60_000)

    test("an archived lane's history is parked: after the op log is cut and collected, its restore still finds it", async () => {
      const rig = await turnRig("host-park")
      await rig.fetch(rig.base)
      const tip = await laneTipIn(rig.ops, LANE)
      if (tip === null) throw new Error("no tip")
      await executeRepo(
        rig.yoursDir,
        laneRefSteps([
          { lane: LANE, commit: null },
          { lane: threadIdFor("9"), commit: null },
        ]),
      )
      expect(await laneTipIn(rig.ops, LANE)).toBeNull()
      await cutHistory(rig)
      await executeRepo(
        rig.yoursDir,
        laneRefSteps([{ lane: LANE, commit: tip }]),
      )
      expect(await laneTipIn(rig.ops, LANE)).toBe(tip)
      const parked = await run("git", ["for-each-ref", "refs/pinetrie/"], {
        cwd: rig.yoursDir,
      })
      expect(parked.stdout).toBe("")
    }, 60_000)
  })

  test("a lane's ref deleted and imported: the history under accepted work is kept", async () => {
    const { yoursDir, yoursJj, ops, edit, offer, accept, base } =
      await turnRig("refgone")
    await accept(await offer(base))
    await edit(yoursDir, "mine.txt", "mine\n")
    await yoursJj(["commit", "-m", "mine on accepted work"])
    await yoursJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
    const before = await commitsOf(ops, "::@-")
    await executeRepo(yoursDir, laneRefSteps([{ lane: LANE, commit: null }]))
    expect(await commitsOf(ops, "::@-")).toEqual(before)
    expect(await commitsOf(ops, "conflicts()")).toEqual([])
  }, 60_000)

  test("a publish's catch-up: a preview that writes nothing, then your work rebased onto accepted work, conflicts recorded", async () => {
    const { yoursDir, yoursJj, ops, edit, line, setUpAccepted } =
      await offerRig("catchup")
    const git: Runner = args => hostRunner(yoursDir)(["git", ...args])
    const change = async (rev: string) =>
      (
        await yoursJj(["log", "--no-graph", "-r", rev, "-T", "change_id"])
      ).stdout.trim()
    await edit(yoursDir, "f.txt", "a\nb\nc\n")
    await edit(yoursDir, "g.txt", "base\n")
    await yoursJj(["commit", "-m", "L0"])
    await setUpAccepted()
    // Your work: Y1 changes g.txt, with a second head on it besides @.
    await edit(yoursDir, "g.txt", "yours\n")
    await yoursJj(["describe", "-m", "Y1"])
    const y1 = await change("@")
    await yoursJj(["new", y1, "-m", "sibling"])
    await edit(yoursDir, "s.txt", "s\n")
    await yoursJj(["new", y1])
    // A file in @, so leaving it does not abandon it as empty.
    await edit(yoursDir, "h.txt", "h\n")
    const at = await change("@")
    // Accepted work moves on: L1 changes f.txt and g.txt.
    await yoursJj(["new", line.acceptedBookmark, "-m", "L1"])
    await edit(yoursDir, "f.txt", "a\nB\nc\n")
    await edit(yoursDir, "g.txt", "line\n")
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await yoursJj(["edit", at])
    // Not yet snapshotted: the rebase, run as you, snapshots it first.
    await edit(yoursDir, "i.txt", "i\n")
    const before = (await yoursJj(["op", "log", "-n", "1", "-T", "id"])).stdout
    const facts = await acceptedFacts(ops, git, line)
    expect(facts.yours.behind).toBe(1)
    expect(facts.yours.catchUp).toEqual({
      changes: 2,
      conflicts: ["g.txt"],
      heads: 1,
    })
    expect(facts.yours.conflicts).toEqual({ commits: 0, files: [] })
    // The preview wrote no operation.
    expect(
      (
        await yoursJj([
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
      yoursDir,
      planPublishCatchUp({ acceptedBookmark: line.acceptedBookmark }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.yours.behind).toBe(0)
    expect(after.yours.catchUp).toBe(null)
    // Y1 and @ conflict; the sibling moved too, and conflicts outside @'s line.
    expect(after.yours.conflicts).toEqual({ commits: 2, files: ["g.txt"] })
    expect(await readFile(path.join(yoursDir, "h.txt"), "utf8")).toBe("h\n")
    expect(await readFile(path.join(yoursDir, "i.txt"), "utf8")).toBe("i\n")
    expect(await readFile(path.join(yoursDir, "f.txt"), "utf8")).toBe(
      "a\nB\nc\n",
    )
    expect(
      await commitsOf(
        ops,
        `description(exact:"sibling\\n") & ${revsetName(line.acceptedBookmark)}::`,
      ),
    ).toHaveLength(1)
  }, 60_000)

  test("publish's move: main moved forward to accepted work as the host, git's main with it; refused once main has its own commits", async () => {
    const { yoursDir, yoursJj, ops, edit, line, setUpAccepted } =
      await offerRig("publish")
    const git: Runner = args => hostRunner(yoursDir)(["git", ...args])
    const gitMain = async () =>
      (await git(["rev-parse", "refs/heads/main"])).stdout.trim()
    await edit(yoursDir, "a.txt", "a\n")
    await yoursJj(["commit", "-m", "M0"])
    await yoursJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // No unpublished work yet: accepted work is main.
    expect((await acceptedFacts(ops, git, line)).published).toMatchObject({
      behind: 0,
      ahead: 0,
    })
    await edit(yoursDir, "b.txt", "b\n")
    await yoursJj(["commit", "-m", "L1"])
    await edit(yoursDir, "c.txt", "c\n")
    await yoursJj(["commit", "-m", "L2"])
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const before = await acceptedFacts(ops, git, line)
    expect(before.published).toMatchObject({ behind: 2, ahead: 0 })
    await executeRepo(
      yoursDir,
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
    await yoursJj(["new", "main", "-m", "hotfix"])
    await edit(yoursDir, "h.txt", "h\n")
    await yoursJj(["bookmark", "move", "main", "--to", "@"])
    await yoursJj(["new", line.acceptedBookmark])
    await edit(yoursDir, "d.txt", "d\n")
    await yoursJj(["commit", "-m", "L3"])
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const sideways = await acceptedFacts(ops, git, line)
    expect(sideways.published).toMatchObject({ behind: 1, ahead: 1 })
    const moved = (await acceptedFacts(ops, git, line)).published.commit
    await expect(
      executeRepo(
        yoursDir,
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
    const { yoursDir, yoursJj, ops, edit, line, setUpAccepted } =
      await offerRig("publish-empty")
    const git: Runner = args => hostRunner(yoursDir)(["git", ...args])
    await edit(yoursDir, "a.txt", "a\n")
    await yoursJj(["commit", "-m", "M0"])
    await yoursJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // An accept: accepted work moves on past main, and your empty @ stays on main.
    await yoursJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(yoursDir, "b.txt", "b\n")
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await yoursJj(["new", "main"])
    const before = await acceptedFacts(ops, git, line)
    expect(before.yours).toMatchObject({ behind: 1, ahead: 0 })
    await executeRepo(
      yoursDir,
      planPublishCatchUp({ acceptedBookmark: line.acceptedBookmark }),
    )
    await executeRepo(
      yoursDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: false,
      }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.published).toMatchObject({ behind: 0, ahead: 0 })
    expect(after.yours).toMatchObject({ behind: 0, ahead: 0 })
    expect(await commitsOf(ops, "main")).toEqual(
      await commitsOf(ops, revsetName(line.acceptedBookmark)),
    )
    expect(await commitsOf(ops, "@-")).toEqual(await commitsOf(ops, "main"))
    expect(await commitsOf(ops, "@ & empty()")).toHaveLength(1)
    expect(await readFile(path.join(yoursDir, "b.txt"), "utf8")).toBe("b\n")
  }, 60_000)

  test("publish with your commits: rebased onto accepted work, counted, then accepted work and main moved to them in one operation", async () => {
    const { yoursDir, yoursJj, ops, edit, line, setUpAccepted } =
      await offerRig("publish-mine")
    const git: Runner = args => hostRunner(yoursDir)(["git", ...args])
    await edit(yoursDir, "a.txt", "a\n")
    await yoursJj(["commit", "-m", "M0"])
    await yoursJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    await yoursJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(yoursDir, "b.txt", "b\n")
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await yoursJj(["new", "main"])
    await edit(yoursDir, "m.txt", "mine\n")
    await yoursJj(["commit", "-m", "mine"])
    expect((await acceptedFacts(ops, git, line)).yours).toMatchObject({
      behind: 1,
      ahead: 1,
    })
    await executeRepo(
      yoursDir,
      planPublishCatchUp({ acceptedBookmark: line.acceptedBookmark }),
    )
    expect((await acceptedFacts(ops, git, line)).yours).toMatchObject({
      behind: 0,
      ahead: 1,
    })
    const ops0 = await yoursJj(["op", "log", "--no-graph", "-T", 'id ++ "\\n"'])
    await executeRepo(
      yoursDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: true,
      }),
    )
    const ops1 = await yoursJj(["op", "log", "--no-graph", "-T", 'id ++ "\\n"'])
    // One operation moved both bookmarks.
    expect(
      ops1.stdout.split("\n").length - ops0.stdout.split("\n").length,
    ).toBe(1)
    const mine = await commitsOf(ops, 'description(exact:"mine\\n")')
    expect(await commitsOf(ops, revsetName(line.acceptedBookmark))).toEqual(
      mine,
    )
    expect(await commitsOf(ops, "main")).toEqual(mine)
  }, 60_000)

  test("a publish's second round reads your commits conflicted by the catch-up, and its revert keeps your edit", async () => {
    const { yoursDir, yoursJj, ops, edit, line, setUpAccepted } =
      await offerRig("publish-undo")
    const git: Runner = args => hostRunner(yoursDir)(["git", ...args])
    await edit(yoursDir, "g.txt", "base\n")
    await yoursJj(["commit", "-m", "M0"])
    await yoursJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // Y1 changes g.txt; Y2 puts it back, so @'s tree merges cleanly.
    await edit(yoursDir, "g.txt", "yours\n")
    await yoursJj(["commit", "-m", "Y1"])
    await edit(yoursDir, "g.txt", "base\n")
    await yoursJj(["commit", "-m", "Y2"])
    // A file in @, so leaving it does not abandon it as empty.
    await edit(yoursDir, "h.txt", "h\n")
    const at = (
      await yoursJj(["log", "--no-graph", "-r", "@", "-T", "change_id"])
    ).stdout.trim()
    await yoursJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(yoursDir, "g.txt", "line\n")
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await yoursJj(["edit", at])
    // Not yet snapshotted: the catch-up snapshots it first, as you.
    await edit(yoursDir, "e.txt", "edited\n")
    const before = await acceptedFacts(ops, git, line)
    expect(before.yours.catchUp?.conflicts).toEqual([])
    expect(before.yours.conflicts.commits).toBe(0)
    const commitsBefore = await commitsOf(ops, "::@- ~ ::main")
    await executeRepo(
      yoursDir,
      planPublishCatchUp({ acceptedBookmark: line.acceptedBookmark }),
    )
    const op = (
      await yoursJj([
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
      (await acceptedFacts(ops, git, line)).yours.conflicts.commits,
    ).toBeGreaterThan(0)
    await executeRepo(yoursDir, planCatchUpUndo(op))
    const undone = await acceptedFacts(ops, git, line)
    expect(undone.yours.behind).toBe(1)
    expect(undone.yours.conflicts.commits).toBe(0)
    expect(await commitsOf(ops, "::@- ~ ::main")).toEqual(commitsBefore)
    expect(await commitsOf(ops, "@ & divergent()")).toEqual([])
    expect(await readFile(path.join(yoursDir, "e.txt"), "utf8")).toBe(
      "edited\n",
    )
    expect(await readFile(path.join(yoursDir, "g.txt"), "utf8")).toBe("base\n")
  }, 60_000)

  test("an unchanged offer's refresh reads at most 2 jj processes, none of them its evolog, and what catching up changes is read once per move", async () => {
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
    const shared = await readShared(
      op,
      ops,
      runnerFor(rig.yoursDir, "git"),
      line,
    )
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
    // offer's top is the host's version, so no evolog is read.
    expect(ran).toBe(2)
    expect(evologs).toEqual([])
    // Accepted work moves: what catching up changes is read once, in two diffs,
    // and kept while the lane's tip and accepted work stay where they are.
    await rig.edit(rig.yoursDir, "line.txt", "line\n")
    await rig.yoursJj(["commit", "-m", "accepted work moves"])
    await rig.yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const gather = async (known: CatchUpRead | null) => {
      const now = (
        await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      ).stdout
      const facts = await readShared(
        now,
        ops,
        runnerFor(rig.yoursDir, "git"),
        line,
      )
      ran = 0
      const read = await gatherLane(counted, {
        lane: LANE,
        name: NAME,
        repoConfig: line,
        shared: facts,
        known,
      })
      if (read === "none" || read === "wip")
        throw new Error("not on accepted work")
      return { read, ran }
    }
    const moved = await gather(null)
    expect(moved.read.catchUp).toEqual({
      tip,
      to: await acceptedNow(),
      files: ["line.txt"],
    })
    expect(moved.ran).toBe(4)
    expect((await gather(moved.read.catchUp)).ran).toBe(2)
    // Moved again: what was read at accepted work before is read again.
    await rig.edit(rig.yoursDir, "line.txt", "line, again\n")
    await rig.yoursJj(["commit", "-m", "accepted work moves again"])
    await rig.yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const again = await gather(moved.read.catchUp)
    expect([again.ran, again.read.catchUp?.to]).toEqual([
      4,
      await acceptedNow(),
    ])
  }, 60_000)

  test("an offer accepted work already holds is empty, and the lane's work still changes files: it is kept, not withdrawn and built again", async () => {
    const rig = await turnRig("held")
    const {
      ops,
      yoursJj,
      yoursDir,
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
    const [offered] = (
      await build([
        {
          commit: tip,
          description: `WIP\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${tip}\n${start.map(c => `Pinetrie-Start: ${c}`).join("\n")}\n`,
        },
      ])
    ).changes
    if (offered === undefined) throw new Error("no offer")
    // You land the lane's change yourself; the offer follows accepted work.
    await rig.edit(yoursDir, "a.txt", "a\n")
    await yoursJj(["commit", "-m", "you: the same a.txt"])
    await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    await executeRepo(yoursDir, planRefreshOffer(offered, await acceptedNow()))
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const shared = await readShared(op, ops, runnerFor(yoursDir, "git"), line)
    const gathered = await gatherLane(ops, {
      lane: LANE,
      name: NAME,
      repoConfig: line,
      shared,
      known: null,
    })
    expect(gathered).toMatchObject({ work: "some", offer: { files: [] } })
    await agrees()
  }, 60_000)

  test("an accepted-offer commit of the lane that names no source makes its start untraced, read either way, until it catches up past it", async () => {
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
    // Accepted as offers were before they carried their ledger.
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
      await startOfOffer(ops, {
        tip: t2,
        base: b2,
        repoConfig: line,
        lane: LANE,
      }),
    ).toEqual({ kind: "untraced", acceptedOfferCommits: [await acceptedNow()] })
    const input = { lane: LANE, name: NAME, repoConfig: line, known: null }
    expect(await gatherPlace({ jj: ops }, input)).toEqual({
      kind: "untraced",
      tip: t2,
      base: b2,
      state: "ok",
      target: await acceptedNow(),
    })
    // The revset that finds a thread's commits matches what hasTrailer does.
    const all = parseAcceptedOfferCommits(
      (
        await ops([
          "log",
          "--no-graph",
          "-r",
          "all()",
          "-T",
          ACCEPTED_OFFER_COMMIT_ROW,
        ])
      ).stdout,
    )
    const found = await commitsOf(ops, trailerRevset(["thread"], NAME))
    expect(found.length).toBeGreaterThan(0)
    expect(
      all
        .filter(c => hasTrailer(c.description, "thread", NAME))
        .map(c => c.commit)
        .sort(),
    ).toEqual([...found].sort())
    // Caught up: the accepted-offer commit is under its base, and the start is accepted work.
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
      await startOfOffer(ops, {
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

  test("catching up with your own acceptance of the lane's work changes no file, as catchUpFiles says", async () => {
    const { ops, laneJj, inLane, offer, accept, acceptedNow, base } =
      await turnRig("own-acceptance")
    await accept(await offer(base))
    const tip = await laneTipIn(ops, LANE)
    const [start] = base
    if (tip === null || start === undefined) throw new Error("no tip")
    const to = await acceptedNow()
    expect(to).not.toBe(start)
    expect(await catchUpFiles(ops, { holds: [start], to, tip })).toEqual([])
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

  describe("catching up past an accepted-offer commit of the lane's work", () => {
    /** Six lines; `at` replaces line n (1-based). */
    const doc = (at: Record<number, string> = {}) =>
      `${[1, 2, 3, 4, 5, 6].map(n => at[n] ?? `line ${n}`).join("\n")}\n`
    /** `turnRig`, with a turn writing `doc.txt`, its offer accepted into accepted work. */
    const acceptedOfferRig = async (tag: string) => {
      const rig = await turnRig(tag)
      await rig.edit(rig.laneDir, "doc.txt", doc())
      const t1 = await rig.turn()
      await rig.accept(await rig.offer(rig.base))
      return { ...rig, t1 }
    }
    /** You change `doc.txt` on accepted work, landing it. */
    const yoursOnAccepted = async (
      rig: Awaited<ReturnType<typeof acceptedOfferRig>>,
      text: string,
      title: string,
    ) => {
      await rig.yoursJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.yoursDir, "doc.txt", text)
      await rig.yoursJj(["commit", "-m", title])
      await rig.yoursJj([
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
     * catching up would change, and where the offer starts; the separate
     * reads say the same (`agrees`).
     */
    const forecast = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      await rig.fetch(rig.base)
      const gathered = await rig.agrees()
      if (gathered === "none" || gathered === "wip")
        throw new Error("not on accepted work")
      return { files: gathered.catchUp?.files, start: gathered.start }
    }

    test("your own acceptance, then your edit to it on accepted work: clean, and the accepted-offer commit is not listed as come in", async () => {
      const rig = await acceptedOfferRig("past-own")
      await yoursOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "c.txt", "c\n")
      await rig.turn()
      const merged = await rig.catchUp()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(await read(rig.laneDir, "doc.txt")).toBe(doc({ 1: "yours" }))
      expect(await read(rig.laneDir, "c.txt")).toBe("c\n")
      expect(merged.commits).toContain("yours: doc line 1")
      expect(merged.commits).not.toContain("WIP")
      // Its next offer holds the lane's own work alone.
      const next = await rig.offer([rig.t1])
      expect([next.conflicted, next.files]).toEqual([false, ["c.txt"]])
    }, 60_000)

    test("the lane re-edits its own accepted lines: clean, with both edits, and the forecast names the file", async () => {
      const rig = await acceptedOfferRig("past-reedit")
      await yoursOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      expect((await forecast(rig)).files).toEqual(["doc.txt"])
      const merged = await rig.catchUp()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual(["doc.txt"])
      expect(await read(rig.laneDir, "doc.txt")).toBe(
        doc({ 1: "yours", 5: "lane again" }),
      )
    }, 60_000)

    test("the lane re-edits a file of its own accepted offer, accepted work unchanged since: the forecast is none, and so is the merge", async () => {
      const rig = await acceptedOfferRig("past-own-reedit")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      const { files, start } = await forecast(rig)
      expect(start).toEqual({ kind: "known", start: [rig.t1] })
      expect(files).toEqual([])
      const merged = await rig.catchUp()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual([])
    }, 60_000)

    test("offered, caught up, then accepted, and re-edited: the offer starts at two commits, and the forecast is none, as the merge", async () => {
      const rig = await turnRig("past-two-starts")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      await rig.turn()
      const offered = await rig.offer(rig.base)
      // Accepted work moves by a file of yours, and the lane catches up.
      await rig.yoursJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.yoursDir, "other.txt", "other\n")
      await rig.yoursJj(["commit", "-m", "yours: other.txt"])
      await rig.yoursJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
      const caughtUp = await rig.catchUp()
      expect(caughtUp.kind).toBe("clean")
      // The offer, made before, follows accepted work and is accepted.
      const [bottom] = offered.built.changes
      if (bottom === undefined) throw new Error("no offer")
      await executeRepo(
        rig.yoursDir,
        planRefreshOffer(bottom, await rig.acceptedNow()),
      )
      await rig.accept(offered)
      // The lane re-edits what was accepted.
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      const { files, start } = await forecast(rig)
      expect(start.kind === "known" && start.start.length).toBe(2)
      expect(files).toEqual([])
      const merged = await rig.catchUp()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual([])
    }, 60_000)

    test("two acceptances, your edit to the first between them: clean", async () => {
      const rig = await acceptedOfferRig("past-two")
      await yoursOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane" }))
      await rig.turn()
      await rig.accept(await rig.offer([rig.t1]))
      await yoursOnAccepted(
        rig,
        doc({ 1: "yours", 5: "yours" }),
        "yours: doc line 5",
      )
      expect((await rig.catchUp()).kind).toBe("clean")
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
        bookmark: await bookmarkOf(laneJjAt(forkDir), FORK),
      })
      // The parent's offer is accepted, and you edit it on accepted work.
      await rig.accept(await rig.offer(rig.base))
      await rig.yoursJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.yoursDir, "doc.txt", doc({ 1: "yours" }))
      await rig.yoursJj(["commit", "-m", "yours: doc line 1"])
      await rig.yoursJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
      expect((await rig.catchUp(forkDir, FORK)).kind).toBe("clean")
      expect(await read(forkDir, "doc.txt")).toBe(doc({ 1: "yours" }))
      expect(await read(forkDir, "k.txt")).toBe("k\n")
    }, 60_000)

    test("a line both rewrote still conflicts, on that file alone, and the accepted-offer commit is not its side", async () => {
      const rig = await acceptedOfferRig("past-real")
      await yoursOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 1: "lane again" }))
      await rig.edit(rig.laneDir, "c.txt", "c\n")
      await rig.turn()
      const merged = await rig.catchUp()
      if (merged.kind !== "conflicted") throw new Error("not conflicted")
      expect(merged.contents.map(c => c.path)).toEqual(["doc.txt"])
      expect(merged.theirs.map(r => firstLine(r.description, 200))).toEqual([
        "yours: doc line 1",
      ])
    }, 60_000)

    test("an offer you edited where the lane wrote: its join conflicts, and is left out", async () => {
      const rig = await turnRig("past-edited")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      await rig.turn()
      const offered = await rig.offer(rig.base)
      // You reword the lane's first line in the offer, then accept it.
      const [top] = offered.built.commits
      if (top === undefined) throw new Error("no offer")
      await rig.yoursJj(["new", top])
      await rig.edit(rig.yoursDir, "doc.txt", doc({ 1: "edited by you" }))
      // The offer keeps its message, and so its `Pinetrie-Source`.
      await rig.yoursJj([
        "squash",
        "--ignore-immutable",
        "--use-destination-message",
      ])
      expect(
        await commitsOf(
          rig.ops,
          `${bookmarkRevset(offerBookmark(NAME))} & ${trailerRevset(["source"])}`,
        ),
      ).toHaveLength(1)
      await rig.accept(offered)
      const merged = await rig.catchUp()
      // Merged as before the joins: no join is left in the lane's history.
      expect(merged.kind).toBe("conflicted")
      expect(
        await commitsOf(rig.laneJj, 'description(regex:"^join: ")'),
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
      await workChanges(ops, {
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
      await workChanges(ops, {
        start: { kind: "known", start: [start] },
        tip: undone,
      }),
    ).toBe("none")
    expect(
      await workChanges(ops, {
        start: { kind: "known", start: [first] },
        tip: undone,
      }),
    ).toBe("some")
    // A range jj refuses, here for a commit it does not have, is not a change.
    expect(
      await workChanges(ops, {
        start: { kind: "known", start: [first, commitId("1".repeat(40))] },
        tip: undone,
      }),
    ).toBe("unknown")
    expect(
      await workChanges(ops, {
        start: { kind: "untraced", acceptedOfferCommits: [first] },
        tip: undone,
      }),
    ).toBe("unknown")
  }, 60_000)

  test("a thread on a WIP starts from its copy, and freezes nothing of yours", async () => {
    const rig = await offerRig("wipcopy")
    await rig.edit(rig.yoursDir, "base.txt", "base\n")
    await rig.yoursJj(["commit", "-m", "your base"])
    const base = await commitsOf(rig.yoursJj, "@-")
    const [line] = base
    if (line === undefined) throw new Error("no base")
    await rig.setUpAccepted()
    await rig.edit(rig.yoursDir, "wip.txt", "half done\n")
    await rig.yoursJj(["commit", "-m", "wip: half done"])
    await rig.yoursJj(["bookmark", "create", "wip/search", "-r", "@-"])
    const [wip] = await commitsOf(rig.yoursJj, "wip/search")
    if (wip === undefined) throw new Error("no wip")
    await rig.inLane(planBaseCheckout({ yours: base, fresh: true }))
    await rig.inLane(
      planForkSetup(jjLaneFor(LANE), {
        kind: "wip",
        bookmark: "wip/search",
        commit: wip,
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
    expect((await commitsOf(rig.yoursJj, `${wip} & mutable()`)).length).toBe(1)
    const tip = await laneTipIn(rig.ops, LANE)
    if (tip === null) throw new Error("no tip")
    expect(await laneBase(rig.ops, tip, rig.line)).toMatchObject({
      base: { kind: "wip", bookmark: "wip/search" },
      source: wip,
    })
    // You amend the WIP: the offer, from the copy, placed on the WIP now,
    // holds only the lane's file.
    await rig.edit(rig.yoursDir, "wip.txt", "half done, amended\n")
    await rig.yoursJj(["squash", "--into", "wip/search"])
    const b = await laneBase(rig.ops, tip, rig.line)
    if (b === null) throw new Error("no base")
    const start = await knownStart(rig.ops, {
      tip,
      base: b,
      repoConfig: rig.line,
    })
    const [target] = await commitsOf(rig.ops, "wip/search")
    if (target === undefined) throw new Error("no wip")
    await executeRepo(
      rig.yoursDir,
      planOffer({
        name: NAME,
        start,
        sources: [{ commit: tip, description: "WIP" }],
        target,
        nonce: "n-wip",
      }),
    )
    const found = await offerRevisions(rig.ops, { name: NAME, target })
    const o = found[0]?.commit
    expect(
      lines((await rig.ops(["diff", "-r", o ?? "", "--name-only"])).stdout),
    ).toEqual(["tests.txt"])
    // What an acceptance reads: the WIP's commit above accepted work lands with it on
    // accepted work, and both bookmarks sit below the offer.
    const input = { lane: LANE, name: NAME, repoConfig: rig.line, known: null }
    const gathered = await gatherOffer({ jj: rig.ops }, input)
    expect(gathered?.place).toMatchObject({ kind: "placed", target })
    if (gathered === null) throw new Error("no gather")
    expect(
      await gatherOfferAcceptance({ jj: rig.ops }, gathered, rig.line),
    ).toEqual({
      wipAhead: 1,
      below: new Set(["wip/search", rig.line.acceptedBookmark]),
    })
    // A split's stack, read bottom first: the WIP's commit, then the offer.
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
      rig.yoursDir,
      planOfferAcceptanceSteps({
        bookmark: offerBookmark(NAME),
        top: o ?? "",
        destination: "wip/search",
      }),
    )
    expect(await commitsOf(rig.ops, "wip/search & mutable()")).toEqual([o])
    // The WIP's bookmark deleted, its work never on accepted work: gone.
    await rig.yoursJj(["bookmark", "delete", "wip/search"])
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
      expect(await commitsOf(laneJj, 'bookmarks(glob:"pineta/*")')).toEqual([])
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
      expect(await commitsOf(forkJj, 'files(root:".pineta-lane")')).toEqual([])
    }, 60_000)

    test("an old lane on accepted work: its Pineta-Base on pineta-onto reads as accepted work, the batched read and the separate reads alike; its offer starts above what it had accepted", async () => {
      const rig = await offerRig("old-base")
      const { yoursDir, yoursJj, laneDir, laneJj, ops, line, inLane, edit } =
        rig
      await edit(yoursDir, "base.txt", "base\n")
      await yoursJj(["commit", "-m", "your base"])
      await rig.setUpAccepted()
      const onAccepted = await rig.acceptedNow()
      await inLane(planBaseCheckout({ yours: [onAccepted], fresh: true }))
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

      // An offer accepted before the rename, as it was written then.
      await rig.build([
        {
          commit: t1,
          description: `WIP\n\nPineta-Thread: ${NAME}\nPineta-Lane: ${LANE}\nPineta-Entry: e\nPineta-Source: ${t1}\nPineta-Start: ${onAccepted}\n`,
        },
      ])
      const [accepted] = await commitsOf(
        ops,
        bookmarkRevset(offerBookmark(NAME)),
      )
      if (accepted === undefined) throw new Error("no offer")
      expect(
        (await ops(["log", "--no-graph", "-r", accepted, "-T", "description"]))
          .stdout,
      ).toContain("Pineta-Source")
      await executeRepo(
        yoursDir,
        planOfferAcceptanceSteps({
          bookmark: offerBookmark(NAME),
          top: accepted,
          destination: line.acceptedBookmark,
        }),
      )
      // You edit what it brought, on accepted work: an offer that started below
      // it would put the lane's a.txt back over yours.
      await yoursJj(["new", line.acceptedBookmark])
      await edit(yoursDir, "a.txt", "a, then yours\n")
      await yoursJj(["commit", "-m", "yours: a.txt"])
      await yoursJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
      await edit(laneDir, "b.txt", "b\n")
      await rig.turn()
      expect((await rig.offer([t1])).files).toEqual(["b.txt"])
    }, 60_000)
  })

  test("a base refreshes after your @- was rewritten, not built on", async () => {
    const yoursDir = path.join(top, "rewritten-yours")
    const baseDir = path.join(top, "rewritten-base")
    await run("mkdir", ["-p", yoursDir, baseDir])
    await run("jj", ["git", "init", "--colocate", yoursDir])
    const yoursJj = hostJj(yoursDir)
    const inBase = (steps: readonly LaneStep[]) =>
      executeOrThrow(
        onHost(steps, {
          "/mnt/host-working-copy": yoursDir,
          "/workspace": baseDir,
        }),
        {
          lane: hostRunner(baseDir),
          laneBytes: hostBytesRunner(baseDir),
        },
      )
    await writeFile(path.join(yoursDir, "a.txt"), "first\n")
    await yoursJj(["commit", "-m", "yours"])
    const first = await commitsOf(yoursJj, "@-")
    await inBase(planBaseCheckout({ yours: first, fresh: true }))
    // Your @- rewritten in place: the base's commit is no ancestor of it.
    await writeFile(path.join(yoursDir, "a.txt"), "rewritten\n")
    await yoursJj(["squash", "--into", "@-"])
    const rewritten = await commitsOf(yoursJj, "@-")
    expect(rewritten).not.toEqual(first)
    await inBase(planBaseCheckout({ yours: rewritten, fresh: false }))
    expect(await readFile(path.join(baseDir, "a.txt"), "utf8")).toBe(
      "rewritten\n",
    )
  })
})
