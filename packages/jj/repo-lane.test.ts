import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  type CommitId,
  commitId,
  entryId,
  entryOfMessage,
  firstLine,
  pointFromCommit,
} from "@pinetrie/core"
import {
  executeOrThrow,
  hostBytesRunner,
  hostRunner,
  type LaneStep,
  laneShell,
  lines,
  OLD_LANE_CONFIG_DIR,
  type Runner,
  run,
  type TouchedRevision,
} from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { fetchLane, jjLaneFor } from "./fixtures.ts"
import { getLatestFiles } from "./get-latest.ts"
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
  proposedBookmark,
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
  changedPaths,
  copyFacts,
  oldNamesOnDisk,
  readCommits,
} from "./lane/revisions.ts"
import { planAcceptanceSteps, planProposedChanges } from "./plan.ts"
import { laneTipIn, proposedRevisions, readChangeId } from "./proposed.ts"
import {
  gatherAcceptance,
  gatherPlace,
  gatherProposedChanges,
  gatherStack,
} from "./proposed-gather.ts"
import {
  defaultLog,
  FORK,
  fileNames,
  hostJj,
  hostOps,
  knownStart,
  LANE,
  LANE_CONFIG,
  laneJjRunner,
  laneRigs,
  NAME,
  onHost,
  ROOT,
  TURN,
  turnOn,
  useLaneRepos,
} from "./repo-rigs.ts"
import { executeRepo } from "./run.ts"

describe("a lane's repo, with jj", () => {
  const repos = useLaneRepos()
  const { proposedRig, turnRig } = laneRigs(repos)

  test("the whole life of a lane: base, turn, fetch, update, fork", async () => {
    const repoDir = path.join(repos.top, "yours")
    const laneDir = path.join(repos.top, "lane")
    const forkDir = path.join(repos.top, "fork")
    const rootDir = path.join(repos.top, "root-fork")
    await run("mkdir", ["-p", repoDir, laneDir])
    await run("jj", ["git", "init", "--colocate", repoDir])
    const repoJj = hostJj(repoDir)
    const repoOps = hostOps(repoDir)
    const laneJj = laneJjRunner(laneDir)
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
        bundle: path.join(repos.top, `${lane}.bundle`),
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
    const forkJj = laneJjRunner(forkDir)
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
    const rootJj = laneJjRunner(rootDir)
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
    const scratch = path.join(repos.top, "scratch")
    await run("jj", ["git", "init", scratch])
    expect(
      (
        await laneJjRunner(
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
      expect(await fileNames(ops, tip ?? "none()")).toContain("b.txt")

      // A branch at that turn: the lane's disk cloned, then `jj new` on the
      // turn's commit, or the one before it when the turn recorded none.
      const forkDir = path.join(repos.top, `self-${how}-fork`)
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
    expect(await fileNames(laneJj, merge ?? "none()")).toEqual(
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
      const forkDir = path.join(repos.top, "old-fork-fork")
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
      const forkJj = laneJjRunner(forkDir)
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
    const repoDir = path.join(repos.top, "rewritten-yours")
    const baseDir = path.join(repos.top, "rewritten-base")
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
