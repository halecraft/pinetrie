import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type CommitId,
  commitId,
  type EntryId,
  entryId,
  type LaneName,
  laneNameForThread,
  NO_EDITOR,
  type ThreadName,
  WORKSPACE_ROOT,
} from "@pineta/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  baseMessage,
  bookmarkOf,
  changedPaths,
  changeOf,
  changesNoFile,
  commitsOf,
  commitTurn,
  conflictContent,
  conflictsIn,
  DEFAULT_LINE,
  entryOfMessage,
  execute,
  executeOnHost,
  executeOrThrow,
  fetchById,
  fileDiff,
  hostBytesRunner,
  hostCommitIn,
  hostJj,
  hostOps,
  hostRunner,
  immutableHeads,
  LANE_JJ_CONFIG,
  type LaneStep,
  laneBase,
  laneIgnores,
  laneRefSteps,
  laneTipIn,
  lineFacts,
  lines,
  logRevset,
  mergeBase,
  newestBase,
  type OfferSource,
  offerBookmark,
  offerRevisions,
  planAbandonOffer,
  planBaseRefresh,
  planDescribe,
  planFetch,
  planFollow,
  planFollowOffer,
  planForkSetup,
  planLineSetup,
  planOffer,
  planRepair,
  planTakeOffer,
  planWipCopy,
  type Ran,
  type Runner,
  readOffer,
  retireLaneBookmarks,
  revisionMessage,
  revisionRead,
  revsetName,
  run,
  sideHistory,
  stackBookmark,
  startOfOffer,
} from "./index.ts"

const LANE = laneNameForThread("1")
const NAME = "amber-fox" as ThreadName
const FORK = laneNameForThread("2")
const ROOT = laneNameForThread("3")
const TURN = { lane: LANE, title: "a turn" }

/** `commitTurn` with the lane's bookmark read first, as the host reads it. */
const turnOn = async (
  jj: Runner,
  input: {
    readonly title: string
    readonly entry: EntryId
    readonly lane: LaneName
  },
) => commitTurn(jj, { ...input, bookmark: await bookmarkOf(jj, input.lane) })

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

test("revisionMessage and entryOfMessage round-trip the entry trailer", () => {
  const message = revisionMessage({
    title: "fix it",
    entry: entryId("e-1"),
    lane: LANE,
  })
  expect(entryOfMessage(message)).toBe("e-1")
  expect(entryOfMessage("your commit")).toBeNull()
})

describe("execute", () => {
  const ok: Ran = { ok: true, code: 0, stdout: "", stderr: "" }
  test("runs each step where it says, in order, and stops at the first that fails", async () => {
    const seen: string[] = []
    const runner =
      (where: string, fail: string): Runner =>
      async argv => {
        seen.push(`${where}: ${argv.join(" ")}`)
        return argv[0] === fail
          ? { ok: false, code: 1, stdout: "", stderr: "no" }
          : ok
      }
    const steps: LaneStep[] = [
      { in: "lane", argv: ["sync"] },
      { in: "host", argv: ["cp"] },
      { in: "lane", argv: ["bad"] },
      { in: "host", argv: ["never"] },
    ]
    const done = await execute(steps, {
      host: runner("host", ""),
      lane: runner("lane", "bad"),
      laneBytes: async () => ({ ...ok, stdout: new Uint8Array() }),
    })
    expect(seen).toEqual(["lane: sync", "host: cp", "lane: bad"])
    expect(done).toMatchObject({ ok: false, step: steps[2] })
  })
})

// ── against jj and git themselves, in throwaway repos ──────────────────────

/**
 * A lane's steps, run on the host: `/mnt/host-working-copy` and `/workspace` are directories
 * here. Only a mount at the start of a word moves: `refs/heads/pineta/fetched`
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

describe("a lane's repo, with jj", () => {
  let top = ""
  /** Git's variables as a lane has them: every repo ignores the lane's ignore file. */
  const GIT_IGNORE_VARS = [
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
  ] as const
  beforeAll(async () => {
    top = await realpath(await mkdtemp(path.join(tmpdir(), "pineta-lanes-")))
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
      host: hostRunner(),
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
      executeOrThrow(
        planFetch({
          lane,
          have,
          root: yoursDir,
          bundle: path.join(top, `${lane}.bundle`),
        }),
        runners(dir),
      )

    // Your committed work: a file with three lines.
    await writeFile(path.join(yoursDir, "shared.txt"), "one\ntwo\nthree\n")
    await yoursJj(["commit", "-m", "your base"])
    const base = await commitsOf(yoursJj, "@-")
    expect(base).toHaveLength(1)

    // The base disk: git and jj initialized, your @- fetched by id, jj new.
    await inLane(
      laneDir,
      planBaseRefresh({ base: null, yours: base, lock: null, install: null }),
    )
    await inLane(
      laneDir,
      planForkSetup(LANE, { kind: "commits", commits: base }),
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
    // The turn's paths, from the lane's root, as its revision records them
    // (ADR-0056): what git says changed, from the bookmark before it.
    const laneGit: Runner = args =>
      hostRunner(laneDir)(args.map(a => (a === WORKSPACE_ROOT ? laneDir : a)))
    expect(await changedPaths(laneGit, base[0] ?? null, r1)).toEqual([
      "shared.txt",
    ])
    expect(await changedPaths(laneGit, null, r1)).toEqual(["shared.txt"])

    // Your repo fetches it by bundle, as the lane's remote bookmark: out of
    // your default log, and immutable with jj's builtin config, your commit
    // below it included (S48 items 11 and 19).
    await fetchInto(laneDir, LANE, base)
    expect(await laneTipIn(yoursOps, LANE)).toBe(r1)
    expect(await commitsOf(yoursJj, 'bookmarks(glob:"pineta/*")')).toEqual([])
    expect(await defaultLog(yoursJj)).not.toContain("edit line two")
    expect((await yoursJj(["describe", "-r", r1, "-m", "rewritten"])).ok).toBe(
      false,
    )
    // Nor can the lane rewrite what it inherited.
    expect(
      (await laneJj(["describe", "-r", base[0] ?? "", "-m", "x"])).ok,
    ).toBe(false)

    // You change the same line on a WIP (ADR-0060), and commit.
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

    // An update: a copy of the WIP made in the lane, on the line commit
    // under it, merged; the line conflicts.
    const wip1 = await wipNow()
    await inLane(laneDir, planWipCopy(wip1))
    const [copy] = await commitsOf(laneJj, "@-")
    if (copy === undefined) throw new Error("no copy")
    expect(
      (await laneJj(["file", "show", "-r", copy, 'root:"shared.txt"'])).stdout,
    ).toContain("two (you)")
    // The copy is no commit of yours: your WIP stays yours (ADR-0060).
    expect(await commitsOf(laneJj, `${copy} & ${wip1.commit}`)).toEqual([])
    expect(await newestBase(laneJj, copy)).toEqual({
      at: copy,
      bookmark: "wip/x",
      commit: wip1.commit,
    })
    const { ours, merge } = await mergeBase(laneJj, LANE, copy, "update: wip/x")
    expect(merge).not.toBeNull()
    expect(await conflictsIn(laneJj)).toEqual(["shared.txt"])
    expect(await conflictContent(laneJj, "shared.txt")).toContain("<<<<<<<")
    const sides = { ours, theirs: [copy] }
    expect(
      (await sideHistory(laneJj, sides, [ours], "shared.txt")).map(
        entryOfMessage,
      ),
    ).toEqual(["e-1"])
    expect(
      (await sideHistory(laneJj, sides, [copy], "shared.txt")).map(
        d => d.split("\n")[0],
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
    // the WIP changed since, not the line two the lane already resolved.
    await inLane(laneDir, planWipCopy({ ...(await wipNow()), under: copy }))
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
      planForkSetup(FORK, { kind: "commits", commits: [point] }),
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

    // A root fork from a copy of the WIP (ADR-0060): it sees the WIP's
    // files, and its work back in your repo makes nothing divergent.
    await cp(laneDir, rootDir, { recursive: true, verbatimSymlinks: true })
    await inLane(
      rootDir,
      planForkSetup(ROOT, { kind: "wip", ...(await wipNow()) }),
    )
    const rootJj = laneJjAt(rootDir)
    expect(await readFile(path.join(rootDir, "yours-only.txt"), "utf8")).toBe(
      "yours\n",
    )
    const [rootCopy] = await commitsOf(
      rootJj,
      `bookmarks(exact:"pineta/${ROOT}")`,
    )
    // Its fork point is immutable in the lane.
    expect(
      (await rootJj(["describe", "-r", rootCopy ?? "", "-m", "x"])).ok,
    ).toBe(false)
    // Only in the lane's repo: another repo under the same config lacks the
    // fork point, and would fail every command if the config reached it (S50).
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
  // its commit: the offer holds it, and a branch at that turn starts with it
  // (S56).
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
        planForkSetup(FORK, { kind: "commits", commits: [turn ?? first] }),
        forkDir,
      )
      expect(await readFile(path.join(forkDir, "b.txt"), "utf8")).toBe("b\n")
    }, 60_000)

  test("an update merges on an adopted commit; a stack's commits are never adopted", async () => {
    const { laneDir, yoursJj, yoursDir, laneJj, inLane, edit, base, lineNow } =
      await turnRig("adopt")
    await edit(laneDir, "b.txt", "b\n")
    await laneJj(["commit", "-m", "mine"])
    const mine = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (mine === null) throw new Error("the agent's commit was not adopted")

    // An update merges the line into the lane at its bookmark: on the
    // agent's commit, so the merge keeps b.txt.
    await edit(yoursDir, "yours.txt", "yours\n")
    await yoursJj(["commit", "-m", "you add a file"])
    await yoursJj(["bookmark", "move", "pineta-onto", "--to", "@-"])
    const line = await lineNow()
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

  test("a review reads an offer's commit: its description, files and one file's diff (S57)", async () => {
    const { laneDir, yoursJj, ops, laneJj, fetch, edit, build, base } =
      await turnRig("review")
    // Names the template and the fileset must quote, a file under a
    // directory, and a rename.
    await run("mkdir", ["-p", path.join(laneDir, "dir")])
    await edit(laneDir, "a b.txt", "space\n")
    await edit(laneDir, 'we"ird', "quote\n")
    await edit(laneDir, "dir/f.txt", "under\n")
    await edit(laneDir, "a.txt", "a\nmore\n")
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
    const read = await revisionRead(ops, span)
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
    })
    expect(await fileDiff(ops, span, 'we"ird')).toContain("+quote")
    expect(await fileDiff(ops, span, "a b.txt")).toContain("+space")
    // One file exactly: a directory's name names none of its files.
    expect(await fileDiff(ops, span, "dir")).toBe("")
    expect(await fileDiff(ops, span, "dir/f.txt")).toContain("+under")

    // A range reads the same files, with no description, its counts from
    // the range's git diff (ADR-0056, S70): here the range is the revision.
    const [parent] = await commitsOf(ops, `${w}-`)
    if (parent === undefined) throw new Error("no parent")
    const range = { kind: "range", from: parent, to: w } as const
    const byPath = (r: unknown) =>
      [...((r as { files: { path: string }[] } | null)?.files ?? [])].sort(
        (a, b) => a.path.localeCompare(b.path),
      )
    const ranged = await revisionRead(ops, range)
    expect(ranged).toMatchObject({ description: "" })
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
    const facts = await readOffer(ops, { name: NAME, target: "pineta-onto" })
    const [now] = facts?.kind === "offer" ? facts.revisions : []
    if (now === undefined) throw new Error("no commit")
    expect(now.commit).not.toBe(w)
    expect(
      await revisionRead(ops, { kind: "revision", commit: now.commit }),
    ).toMatchObject({
      description: "feat: as I want it\n",
    })
    expect(
      await revisionRead(ops, {
        kind: "revision",
        commit: commitId("1".repeat(40)),
      }),
    ).toBeNull()
  }, 60_000)

  /**
   * Your repo and one lane's, in `top/<tag>-…`, with the lane's steps run on
   * the host, and an offer built as the host builds it, on the line
   * (ADR-0060).
   */
  const offerRig = async (tag: string) => {
    const yoursDir = path.join(top, `${tag}-yours`)
    const laneDir = path.join(top, `${tag}-lane`)
    await run("mkdir", ["-p", yoursDir, laneDir])
    await run("jj", ["git", "init", "--colocate", yoursDir])
    const yoursJj = hostJj(yoursDir)
    const ops = hostOps(yoursDir)
    const laneJj = laneJjAt(laneDir)
    const line = DEFAULT_LINE
    const runnersAt = (dir: string) => ({
      host: hostRunner(),
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
      executeOrThrow(
        planFetch({
          lane: LANE,
          have,
          root: yoursDir,
          bundle: path.join(top, `${tag}.bundle`),
        }),
        runners,
      )
    const edit = async (dir: string, file: string, text: string) =>
      writeFile(path.join(dir, file), text)
    /** The line's commit now. */
    const lineNow = async (): Promise<CommitId> => {
      const [c] = await commitsOf(ops, `present(${revsetName(line.onto)})`)
      if (c === undefined) throw new Error("no line")
      return c
    }
    /** Set the line up at your `@-`, as the host does on your command. */
    const setUpLine = () =>
      executeOnHost(
        planLineSetup({
          root: yoursDir,
          onto: line.onto,
          heads: immutableHeads(line, null),
          log: logRevset(null),
        }),
      )
    const build = async (
      sources: readonly OfferSource[],
      name: ThreadName = NAME,
    ) => {
      const tip = await laneTipIn(ops, LANE)
      if (tip === null) throw new Error("no tip")
      const base = await laneBase(ops, tip, line)
      if (base === null) throw new Error("no base")
      const start = await startOfOffer(ops, { tip, base, line })
      await executeOnHost(
        planOffer({
          root: yoursDir,
          name,
          start,
          sources,
          target: await lineNow(),
          nonce: `n-${Math.random().toString(36).slice(2)}`,
        }),
      )
      // Found in your repo as the host finds it, with nothing kept.
      const read = await readOffer(ops, { name, target: await lineNow() })
      if (read?.kind !== "offer") throw new Error("no offer read")
      return {
        read,
        commits: read.revisions.map(r => r.commit),
        changes: read.revisions.map(r => r.change),
      }
    }
    let entry = 0
    const turn = async () => {
      const t = await turnOn(laneJj, {
        ...TURN,
        entry: entryId(`e-${tag}-${++entry}`),
      })
      if (t === null) throw new Error("the turn committed nothing")
      return t
    }
    /** "Bring up to date" on the line: its commit merged into the lane; the lane takes `resolve` where they conflict. */
    const update = async (resolve: Record<string, string>) => {
      const commit = await lineNow()
      await inLane([fetchById([commit])])
      await mergeBase(
        laneJj,
        LANE,
        commit,
        baseMessage(`update: ${line.onto}`, { bookmark: line.onto, commit }),
      )
      for (const [file, text] of Object.entries(resolve))
        await edit(laneDir, file, text)
      await turn()
    }
    /** An offer of the lane's tip, fetched from `from`, its ledger naming the tip. */
    const offer = async (from: readonly CommitId[]) => {
      await fetch(from)
      const tip = await laneTipIn(ops, LANE)
      if (tip === null) throw new Error("no tip")
      const built = await build([
        { commit: tip, description: `WIP\n\nPineta-Source: ${tip}\n` },
      ])
      const [commit] = built.commits
      if (commit === undefined) throw new Error("no offer")
      return {
        built,
        conflicted:
          (await commitsOf(ops, `${commit} & conflicts()`)).length > 0,
        files: lines((await ops(["diff", "-r", commit, "--name-only"])).stdout),
      }
    }
    /** Take `offered` onto the line: its bookmark moved forward, as the host. */
    const take = async (offered: {
      readonly built: { readonly changes: readonly string[] }
    }) => {
      const [change] = offered.built.changes
      if (change === undefined) throw new Error("no offer")
      await executeOnHost(
        planTakeOffer({
          root: yoursDir,
          bookmark: offerBookmark(NAME),
          top: change,
          destination: line.onto,
        }),
      )
    }
    return {
      yoursDir,
      laneDir,
      yoursJj,
      ops,
      laneJj,
      line,
      inLane,
      fetch,
      edit,
      lineNow,
      setUpLine,
      build,
      turn,
      update,
      offer,
      take,
    }
  }

  /** `offerRig`, with your base commit as the line, the lane started on it, and a first turn writing `a.txt`. */
  const turnRig = async (tag: string) => {
    const rig = await offerRig(tag)
    await rig.edit(rig.yoursDir, "base.txt", "base\n")
    await rig.yoursJj(["commit", "-m", "your base"])
    const base = await commitsOf(rig.yoursJj, "@-")
    const [line] = base
    if (line === undefined) throw new Error("no base")
    await rig.setUpLine()
    await rig.inLane(
      planBaseRefresh({ base: null, yours: base, lock: null, install: null }),
    )
    await rig.inLane(
      planForkSetup(LANE, { kind: "line", onto: rig.line.onto, commit: line }),
    )
    await rig.edit(rig.laneDir, "a.txt", "a\n")
    const first = await turnOn(rig.laneJj, { ...TURN, entry: entryId("e-1") })
    if (first === null) throw new Error("the first turn committed nothing")
    return { ...rig, base, first }
  }

  test("an offer on the line (ADR-0060): built, immutable, refreshed, followed, taken by a forward move, and the next one", async () => {
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
      lineNow,
      take,
      offer,
      base,
    } = await turnRig("offer")
    const bookmark = offerBookmark(NAME)
    await fetch(base)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You work on above the line: your stack is yours, and mutable.
    await edit(yoursDir, "c.txt", "c yours\n")
    await yoursJj(["commit", "-m", "yours: c.txt"])
    await edit(yoursDir, "wip.txt", "wip\n")

    // Built by the host on the line: immutable, so you cannot edit it by
    // accident; the host's own rewrites pass `--ignore-immutable`.
    const one = await build([
      {
        commit: t1,
        description: `offer: lane\n\nPineta-Source: ${t1}\nPineta-Start: ${base[0]}\n`,
      },
    ])
    const [c1] = one.changes
    const [w1] = one.commits
    if (c1 === undefined || w1 === undefined) throw new Error("no offer")
    expect(one.read).toMatchObject({
      files: ["a.txt"],
      onTarget: true,
      placed: true,
      // Its ledger, read from its message: no record needed (ADR-0060).
      ledger: { source: t1, start: base },
    })
    expect((await yoursJj(["describe", "-r", c1, "-m", "mine"])).ok).toBe(false)
    // Yet your log shows it: setup added the offers to `revsets.log`, since
    // jj's default leaves an immutable head out (S77 item 8).
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
    await executeOnHost(planDescribe(yoursDir, c1, "offer: described"))

    // The host rewrote it, and nothing recorded that: its newest version is
    // the host's, so it is not yours (S73, by construction).
    const sinceNow = async () => {
      const read = await readOffer(ops, { name: NAME, target: await lineNow() })
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
    await executeOnHost(
      planDescribe(yoursDir, c1, `offer: lane\n\nPineta-Source: ${t1}\n`),
    )

    // A race: your edit and a host rewrite from the same operation make it
    // divergent. The host keeps yours (S48 item 8).
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
      `offer: lane\n\nPineta-Source: ${t1}\n\nhost`,
    ])
    const split = await hostCommitIn(ops, c1)
    if (split === null) throw new Error("no split")
    await executeOnHost(
      planRepair({ root: yoursDir, bookmark, ...split, top: true }),
    )
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
      // from this one, taken, by its base, not its trailer.
      `offer: lane\n\nPineta-Thread: ${NAME}\nPineta-Source: ${t1}\n`,
    ])

    // Take: the line moved forward to the offer, as the host; your @ and
    // your files untouched; the offer's bookmark gone.
    const atBefore = await commitsOf(yoursJj, "@")
    await take({ built: one })
    expect(await commitsOf(yoursJj, "@")).toEqual(atBefore)
    expect(await readFile(path.join(yoursDir, "wip.txt"), "utf8")).toBe("wip\n")
    expect(await changeOf(ops, await lineNow())).toBe(c1)
    expect(
      await commitsOf(ops, `present(bookmarks(exact:"${bookmark}"))`),
    ).toEqual([])
    // jj itself refuses a take that is not forward (S77 item 1).
    expect(
      (await ops(["bookmark", "move", line.onto, "--to", base[0] ?? ""])).ok,
    ).toBe(false)

    // You land work of your own on the line, changing what you took.
    await yoursJj(["new", line.onto])
    await edit(yoursDir, "a.txt", "a, then yours\n")
    await yoursJj(["commit", "-m", "yours: a.txt"])
    await yoursJj(["bookmark", "move", line.onto, "--to", "@-"])

    // The next turn: its offer starts at what the take's Pineta-Source names,
    // and holds only what came after; it does not bring a.txt back.
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (t2 === null) throw new Error("no turn")
    const next = await offer([t1])
    expect(next.files).toEqual(["b.txt"])
    expect(next.conflicted).toBe(false)
    // You reword your commit under it: jj rebases the offer, as your
    // operation, but changes nothing in it, so it is not yours (S48 item 7).
    await yoursJj([
      "describe",
      "--ignore-immutable",
      "-r",
      line.onto,
      "-m",
      "yours: a.txt, reworded",
    ])
    expect(await sinceNow()).toEqual([{ reached: true, yoursChanged: false }])

    // The lane moves on: the offer follows it in place (ADR-0039), its
    // change kept, holding what a fresh build would.
    await edit(laneDir, "f.txt", "f\n")
    const t3 = await turnOn(laneJj, { ...TURN, entry: entryId("e-3") })
    if (t3 === null) throw new Error("no turn")
    await fetch([t2])
    const [nc] = next.built.changes
    if (nc === undefined) throw new Error("no offer")
    const b3 = await laneBase(ops, t3, line)
    if (b3 === null) throw new Error("no base")
    await executeOnHost(
      planFollowOffer({
        root: yoursDir,
        change: nc,
        start: await startOfOffer(ops, { tip: t3, base: b3, line }),
        tip: t3,
        target: await lineNow(),
        description: `WIP\n\nPineta-Source: ${t3}\n`,
      }),
    )
    const [followed] = await commitsOf(ops, `change_id(${nc})`)
    expect(
      lines((await ops(["diff", "-r", followed ?? "", "--name-only"])).stdout),
    ).toEqual(["b.txt", "f.txt"])
    expect(await commitsOf(ops, `${followed} & conflicts()`)).toEqual([])

    // A stack: one revision per lane revision, each with its own file.
    await executeOnHost(planAbandonOffer(yoursDir, next.built.changes))
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
      `pineta/${LANE}`,
      "-r",
      s2,
    ])
    await fetch([t2])
    // Each revision names its thread, as the host writes it: found by that,
    // above the taken offer and your commit under it, which are on the line.
    const ours = `Pineta-Thread: ${NAME}\nPineta-Source: ${t2}`
    const stack = await build([
      { commit: s1, description: `s1: d.txt\n\n${ours}\n` },
      { commit: s2, description: `s2: e.txt\n\n${ours}\n` },
    ])
    expect(stack.read).toMatchObject({ chained: true })
    const per = await Promise.all(
      stack.commits.map(async c =>
        lines((await ops(["diff", "-r", c, "--name-only"])).stdout),
      ),
    )
    expect(per).toEqual([["b.txt", "d.txt"], ["e.txt"]])
  }, 60_000)

  test("a squash of two taken offers keeps both sources: the next offer starts above them (S77 item 6)", async () => {
    const { laneDir, yoursJj, ops, edit, offer, take, turn, lineNow, base } =
      await turnRig("squashed")
    const first = await offer(base)
    await take(first)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turn()
    const second = await offer([t1])
    await take(second)
    // You squash the two taken offers, as jj's editor offers both messages.
    const line = await lineNow()
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

  test("an offer after a catch-up starts at the line it merged, not at what you took below it (S51 item 3, S81)", async () => {
    const {
      laneDir,
      yoursDir,
      yoursJj,
      ops,
      line,
      edit,
      offer,
      take,
      turn,
      update,
      lineNow,
      base,
    } = await turnRig("caught-up")
    await take(await offer(base))
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You change the line you took, then the lane catches up with it: the
    // merge conflicts, and the lane keeps your text.
    await yoursJj(["new", line.onto])
    await edit(yoursDir, "a.txt", "a, then yours\n")
    await yoursJj(["commit", "-m", "yours: a.txt"])
    await yoursJj(["bookmark", "move", line.onto, "--to", "@-"])
    await update({ "a.txt": "a, then yours\n" })
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    // The taken source is below the line the lane merged: the offer starts
    // there alone, and holds only what came after.
    const after = await offer([t1])
    expect([after.conflicted, after.files]).toEqual([false, ["c.txt"]])
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    expect(await startOfOffer(ops, { tip, base: b, line })).toEqual([
      await lineNow(),
    ])
  }, 60_000)

  test("a lane's ref deleted and imported: the history under the line is kept (S78)", async () => {
    const { yoursDir, yoursJj, ops, edit, offer, take, base } =
      await turnRig("refgone")
    await take(await offer(base))
    await edit(yoursDir, "mine.txt", "mine\n")
    await yoursJj(["commit", "-m", "mine on the line"])
    await yoursJj(["bookmark", "move", "pineta-onto", "--to", "@-"])
    const before = await commitsOf(ops, "::@-")
    await executeOnHost(laneRefSteps(yoursDir, [{ lane: LANE, commit: null }]))
    expect(await commitsOf(ops, "::@-")).toEqual(before)
    expect(await commitsOf(ops, "conflicts()")).toEqual([])
  }, 60_000)

  test("update my files (S80): a preview that writes nothing, then your work rebased onto the line, conflicts recorded", async () => {
    const { yoursDir, yoursJj, ops, edit, line, setUpLine } =
      await offerRig("follow")
    const git: Runner = args => hostRunner(yoursDir)(["git", ...args])
    const change = async (rev: string) =>
      (
        await yoursJj(["log", "--no-graph", "-r", rev, "-T", "change_id"])
      ).stdout.trim()
    await edit(yoursDir, "f.txt", "a\nb\nc\n")
    await edit(yoursDir, "g.txt", "base\n")
    await yoursJj(["commit", "-m", "L0"])
    await setUpLine()
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
    // The line moves on: L1 changes f.txt and g.txt.
    await yoursJj(["new", line.onto, "-m", "L1"])
    await edit(yoursDir, "f.txt", "a\nB\nc\n")
    await edit(yoursDir, "g.txt", "line\n")
    await yoursJj(["bookmark", "move", line.onto, "--to", "@"])
    await yoursJj(["edit", at])
    // Not yet snapshotted: the rebase, run as you, snapshots it first.
    await edit(yoursDir, "i.txt", "i\n")
    const before = (await yoursJj(["op", "log", "-n", "1", "-T", "id"])).stdout
    const facts = await lineFacts(ops, git, line)
    expect(facts.yours.behind).toBe(1)
    expect(facts.yours.follow).toEqual({
      files: ["f.txt", "g.txt"],
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
    await executeOnHost(planFollow({ root: yoursDir, onto: line.onto }))
    const after = await lineFacts(ops, git, line)
    expect(after.yours.behind).toBe(0)
    expect(after.yours.follow).toBe(null)
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
        `description(exact:"sibling\\n") & ${revsetName(line.onto)}::`,
      ),
    ).toHaveLength(1)
  }, 60_000)

  test("a lane whose work undoes itself changes no file, over a range jj diffs as one", async () => {
    const { laneDir, ops, turn, fetch, base } = await turnRig("undone")
    await fetch(base)
    const first = await laneTipIn(ops, LANE)
    if (first === null) throw new Error("no tip")
    expect(await changesNoFile(ops, { start: base, tip: first })).toBe(false)
    await rm(path.join(laneDir, "a.txt"))
    await turn()
    await fetch(base)
    const undone = await laneTipIn(ops, LANE)
    if (undone === null) throw new Error("no tip")
    expect(await changesNoFile(ops, { start: base, tip: undone })).toBe(true)
    expect(await changesNoFile(ops, { start: [first], tip: undone })).toBe(
      false,
    )
    expect(await changesNoFile(ops, { start: [], tip: undone })).toBe(false)
  }, 60_000)

  test("a thread on a WIP starts from its copy, and freezes nothing of yours (ADR-0060)", async () => {
    const rig = await offerRig("wipcopy")
    await rig.edit(rig.yoursDir, "base.txt", "base\n")
    await rig.yoursJj(["commit", "-m", "your base"])
    const base = await commitsOf(rig.yoursJj, "@-")
    const [line] = base
    if (line === undefined) throw new Error("no base")
    await rig.setUpLine()
    await rig.edit(rig.yoursDir, "wip.txt", "half done\n")
    await rig.yoursJj(["commit", "-m", "wip: half done"])
    await rig.yoursJj(["bookmark", "create", "wip/search", "-r", "@-"])
    const [wip] = await commitsOf(rig.yoursJj, "wip/search")
    if (wip === undefined) throw new Error("no wip")
    await rig.inLane(
      planBaseRefresh({ base: null, yours: base, lock: null, install: null }),
    )
    await rig.inLane(
      planForkSetup(LANE, {
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
    const start = await startOfOffer(rig.ops, { tip, base: b, line: rig.line })
    const [target] = await commitsOf(rig.ops, "wip/search")
    if (target === undefined) throw new Error("no wip")
    await executeOnHost(
      planOffer({
        root: rig.yoursDir,
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
    // Taken into the WIP: a forward move; the WIP stays mutable.
    await executeOnHost(
      planTakeOffer({
        root: rig.yoursDir,
        bookmark: offerBookmark(NAME),
        top: o ?? "",
        destination: "wip/search",
      }),
    )
    expect(await commitsOf(rig.ops, "wip/search & mutable()")).toEqual([o])
  }, 60_000)

  test("a base refreshes after your @- was rewritten, not built on (S74)", async () => {
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
          host: hostRunner(),
          lane: hostRunner(baseDir),
          laneBytes: hostBytesRunner(baseDir),
        },
      )
    await writeFile(path.join(yoursDir, "a.txt"), "first\n")
    await yoursJj(["commit", "-m", "yours"])
    const first = await commitsOf(yoursJj, "@-")
    await inBase(
      planBaseRefresh({ base: null, yours: first, lock: null, install: null }),
    )
    // Your @- rewritten in place: the base's commit is no ancestor of it.
    await writeFile(path.join(yoursDir, "a.txt"), "rewritten\n")
    await yoursJj(["squash", "--into", "@-"])
    const rewritten = await commitsOf(yoursJj, "@-")
    expect(rewritten).not.toEqual(first)
    await inBase(
      planBaseRefresh({
        base: { commits: first, lock: null },
        yours: rewritten,
        lock: null,
        install: null,
      }),
    )
    expect(await readFile(path.join(baseDir, "a.txt"), "utf8")).toBe(
      "rewritten\n",
    )
  })

  test("retiring a repo from before offers: history kept, out of your log", async () => {
    const dir = path.join(top, "retire")
    await run("mkdir", ["-p", dir])
    await run("jj", ["git", "init", "--colocate", dir])
    const jj = hostJj(dir)
    await writeFile(path.join(dir, "a.txt"), "a\n")
    await jj(["commit", "-m", "base"])
    await jj(["new", "-m", "old turn"])
    await writeFile(path.join(dir, "b.txt"), "b\n")
    await jj(["commit", "-m", "old turn"])
    await jj(["bookmark", "set", `pineta/${LANE}`, "-r", "@-"])
    await jj(["new", "@--"])
    await jj([
      "config",
      "set",
      "--repo",
      'revset-aliases."immutable_heads()"',
      'builtin_immutable_heads() | bookmarks(glob:"pineta/*")',
    ])
    await retireLaneBookmarks(dir)
    expect(await commitsOf(jj, 'bookmarks(glob:"pineta/*")')).toEqual([])
    expect(await laneTipIn(hostOps(dir), LANE)).not.toBeNull()
    expect(await defaultLog(jj)).not.toContain("old turn")
    const heads = await jj([
      "config",
      "get",
      'revset-aliases."immutable_heads()"',
    ])
    expect(heads.stdout).not.toContain("pineta")
  }, 30_000)
})

test("changedPaths: a path with a space and an accent comes back as it is named (S70)", async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pineta-paths-")),
  )
  try {
    const git: Runner = args =>
      hostRunner(dir)(args.map(a => (a === WORKSPACE_ROOT ? dir : a)))
    const env = {
      ...process.env,
      JJ_USER: "Probe",
      JJ_EMAIL: "probe@example.com",
    }
    await run("jj", ["git", "init", "--colocate", dir], { env })
    const jj = (args: string[]) => run("jj", ["-R", dir, ...args], { env })
    await writeFile(path.join(dir, "a.txt"), "a\n")
    await jj(["commit", "-m", "one"])
    const [from] = await commitsOf(hostJj(dir), "@-")
    await mkdir(path.join(dir, "d"), { recursive: true })
    await writeFile(path.join(dir, "d", "c é.txt"), "c\n")
    await jj(["commit", "-m", "two"])
    const [to] = await commitsOf(hostJj(dir), "@-")
    if (from === undefined || to === undefined) throw new Error("no commits")
    expect(await changedPaths(git, from, to)).toEqual(["d/c é.txt"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
