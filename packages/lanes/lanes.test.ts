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
  type HaveRecord,
  type LaneName,
  laneNameForThread,
  NO_EDITOR,
  type ThreadName,
  WORKSPACE_ROOT,
} from "@pineta/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  bookmarkOf,
  changedPaths,
  changeOf,
  commitsOf,
  commitTurn,
  conflictContent,
  conflictsIn,
  entryOfMessage,
  execute,
  executeOnHost,
  executeOrThrow,
  fileDiff,
  hasBookmark,
  hostBytesRunner,
  hostCommitIn,
  hostJj,
  hostOps,
  hostRunner,
  LANE_JJ_CONFIG,
  type LaneStep,
  laneIgnores,
  laneTipIn,
  lines,
  mergeYours,
  type OfferSource,
  ONTO_BOOKMARK,
  offerBookmark,
  offerFacts,
  offerRevisions,
  planAbandonOffer,
  planBaseRefresh,
  planFetch,
  planFollowOffer,
  planForkSetup,
  planOffer,
  planRefreshOffer,
  planRepair,
  planTakeOffer,
  planYourCopy,
  type Ran,
  type Runner,
  retireLaneBookmarks,
  revisionMessage,
  revisionRead,
  run,
  sideHistory,
  stackBookmark,
  startOfOffer,
  yoursAt,
  yoursNow,
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
    const base = await yoursNow(yoursJj)
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

    // You change the same line, commit, and keep editing.
    await yoursJj(["new"])
    await writeFile(
      path.join(yoursDir, "shared.txt"),
      "one\ntwo (you)\nthree\n",
    )
    await yoursJj(["commit", "-m", "you edit line two"])
    await writeFile(path.join(yoursDir, "still-editing.txt"), "wip\n")

    // An update: a copy of your @ made in the lane, merged; the line conflicts.
    const at = await yoursAt(yoursJj)
    await inLane(laneDir, planYourCopy(at))
    const [copy] = await commitsOf(laneJj, "@-")
    if (copy === undefined) throw new Error("no copy")
    expect(
      (await laneJj(["file", "show", "-r", copy, 'root:"still-editing.txt"']))
        .stdout,
    ).toBe("wip\n")
    const { ours, merge } = await mergeYours(laneJj, LANE, [copy])
    expect(merge).not.toBeNull()
    expect(await conflictsIn(laneJj)).toEqual(["shared.txt"])
    expect(await conflictContent(laneJj, "shared.txt")).toContain("<<<<<<<")
    const sides = { ours, theirs: [copy] }
    expect(
      (await sideHistory(laneJj, sides, [ours], "shared.txt")).map(
        entryOfMessage,
      ),
    ).toEqual(["e-1"])
    expect(await sideHistory(laneJj, sides, [copy], "shared.txt")).toEqual([
      "you edit line two",
    ])

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
    // Updating again finds your work already there.
    expect((await mergeYours(laneJj, LANE, [copy])).merge).toBeNull()

    // A clean update: the merge is committed even with nothing to resolve,
    // so the lane's newest revision holds your work, and its own.
    await writeFile(path.join(laneDir, "lane-only.txt"), "lane\n")
    await turnOn(laneJj, { ...turn, entry: entryId("e-3") })
    await yoursJj(["new"])
    await writeFile(path.join(yoursDir, "yours-only.txt"), "yours\n")
    await yoursJj(["commit", "-m", "you add a file"])
    await inLane(laneDir, planYourCopy(await yoursAt(yoursJj)))
    const [cleanCopy] = await commitsOf(laneJj, "@-")
    if (cleanCopy === undefined) throw new Error("no copy")
    const updated = await mergeYours(laneJj, LANE, [cleanCopy])
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

    // A root fork from a copy of your @: it sees your uncommitted file, and
    // its work back in your repo makes nothing divergent (S48 item 10).
    await cp(laneDir, rootDir, { recursive: true, verbatimSymlinks: true })
    await inLane(
      rootDir,
      planForkSetup(ROOT, { kind: "copy", ...(await yoursAt(yoursJj)) }),
    )
    const rootJj = laneJjAt(rootDir)
    expect(
      await readFile(path.join(rootDir, "still-editing.txt"), "utf8"),
    ).toBe("wip\n")
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
    const { laneDir, yoursJj, yoursDir, laneJj, inLane, edit, base } =
      await turnRig("adopt")
    await edit(laneDir, "b.txt", "b\n")
    await laneJj(["commit", "-m", "mine"])
    const mine = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (mine === null) throw new Error("the agent's commit was not adopted")

    // An update merges your work into the lane at its bookmark: on the
    // agent's commit, so the merge keeps b.txt.
    await edit(yoursDir, "yours.txt", "yours\n")
    await yoursJj(["commit", "-m", "you add a file"])
    await inLane(planYourCopy(await yoursAt(yoursJj)))
    const [copy] = await commitsOf(laneJj, "@-")
    if (copy === undefined) throw new Error("no copy")
    const { ours, merge } = await mergeYours(laneJj, LANE, [copy])
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
    // one reads your words. `offerFacts` finds it by change id.
    await yoursJj(["describe", "-r", change, "-m", "feat: as I want it"])
    const facts = await offerFacts(ops, {
      changes: offer.changes,
      wrote: offer.commits,
      target: "@-",
    })
    const [now] = facts.commits
    if (now === undefined) throw new Error("no commit")
    expect(now).not.toBe(w)
    expect(
      await revisionRead(ops, { kind: "revision", commit: now }),
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
   * the host, and an offer built as the host builds it.
   */
  const offerRig = async (tag: string) => {
    const yoursDir = path.join(top, `${tag}-yours`)
    const laneDir = path.join(top, `${tag}-lane`)
    await run("mkdir", ["-p", yoursDir, laneDir])
    await run("jj", ["git", "init", "--colocate", yoursDir])
    const yoursJj = hostJj(yoursDir)
    const ops = hostOps(yoursDir)
    const laneJj = laneJjAt(laneDir)
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
    const build = async (
      sources: readonly OfferSource[],
      haves: readonly HaveRecord[] = [],
      target = "@-",
      name = NAME,
    ) => {
      const tip = await laneTipIn(ops, LANE)
      if (tip === null) throw new Error("no tip")
      const start = await startOfOffer(ops, { tip, target, haves })
      await executeOnHost(
        planOffer({
          root: yoursDir,
          name,
          start,
          sources,
          target,
          nonce: `n-${Math.random().toString(36).slice(2)}`,
        }),
      )
      const revs = await offerRevisions(
        ops,
        offerBookmark(name),
        sources.length,
      )
      return {
        commits: revs,
        changes: await Promise.all(revs.map(c => changeOf(ops, c))),
      }
    }
    /** What you have, as the host records it: each one newer than the last. */
    const haves: HaveRecord[] = []
    const have = (commit: CommitId, kind: HaveRecord["kind"]) =>
      haves.push({ lane: LANE, commit, kind, at: haves.length + 1 })
    let entry = 0
    const turn = async () => {
      const t = await turnOn(laneJj, {
        ...TURN,
        entry: entryId(`e-${tag}-${++entry}`),
      })
      if (t === null) throw new Error("the turn committed nothing")
      return t
    }
    /** "Update from my work": a copy of your @ merged into the lane; the lane takes yours where they conflict. */
    const update = async (yours: Record<string, string>) => {
      await inLane(planYourCopy(await yoursAt(yoursJj)))
      const [copy] = await commitsOf(laneJj, "@-")
      if (copy === undefined) throw new Error("no copy")
      await mergeYours(laneJj, LANE, [copy])
      for (const [file, text] of Object.entries(yours))
        await edit(laneDir, file, text)
      await turn()
      have(copy, "copy")
    }
    /** The offer's conflicts and files, as built from the lane's tip now, after fetching it from `from`. */
    const offer = async (from: readonly CommitId[]) => {
      await fetch(from)
      const tip = await laneTipIn(ops, LANE)
      if (tip === null) throw new Error("no tip")
      const built = await build([{ commit: tip, description: "WIP" }], haves)
      const [commit] = built.commits
      if (commit === undefined) throw new Error("no offer")
      return {
        built,
        conflicted:
          (await commitsOf(ops, `${commit} & conflicts()`)).length > 0,
        files: lines((await ops(["diff", "-r", commit, "--name-only"])).stdout),
      }
    }
    /** Take `offer`'s one revision under your `@`, and record the lane's tip as delivered. */
    const take = async (offered: {
      readonly built: { readonly changes: readonly string[] }
    }) => {
      const [change] = offered.built.changes
      if (change === undefined) throw new Error("no offer")
      await executeOnHost(
        planTakeOffer({
          root: yoursDir,
          bookmark: offerBookmark(NAME),
          bottom: change,
          top: change,
          target: "@-",
          underYou: true,
          onto: false,
        }),
      )
      const taken = await laneTipIn(ops, LANE)
      if (taken === null) throw new Error("no tip")
      have(taken, "delivered")
    }
    return {
      yoursDir,
      laneDir,
      yoursJj,
      ops,
      laneJj,
      inLane,
      fetch,
      edit,
      build,
      haves,
      have,
      turn,
      update,
      offer,
      take,
    }
  }

  /** `offerRig`, with your base commit, the lane on it, and a first turn writing `a.txt`. */
  const turnRig = async (tag: string) => {
    const rig = await offerRig(tag)
    await rig.edit(rig.yoursDir, "base.txt", "base\n")
    await rig.yoursJj(["commit", "-m", "your base"])
    const base = await yoursNow(rig.yoursJj)
    await rig.inLane(
      planBaseRefresh({ base: null, yours: base, lock: null, install: null }),
    )
    await rig.inLane(planForkSetup(LANE, { kind: "commits", commits: base }))
    await rig.edit(rig.laneDir, "a.txt", "a\n")
    const first = await turnOn(rig.laneJj, { ...TURN, entry: entryId("e-1") })
    if (first === null) throw new Error("the first turn committed nothing")
    return { ...rig, base, first }
  }

  test("an offer: built, refreshed, left, repaired, taken, and the next one", async () => {
    const {
      yoursDir,
      laneDir,
      yoursJj,
      ops,
      laneJj,
      inLane,
      fetch,
      edit,
      build,
    } = await offerRig("offer")
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
    const opsSince = async (op: string) => {
      const all = await yoursJj([
        "op",
        "log",
        "--ignore-working-copy",
        "--no-graph",
        "-T",
        'id ++ " " ++ description.first_line() ++ "\\n"',
      ])
      const out: string[] = []
      for (const l of lines(all.stdout)) {
        if (l.startsWith(op)) break
        out.push(l.slice(l.indexOf(" ") + 1))
      }
      return out
    }
    const bookmark = offerBookmark(NAME)

    for (const f of ["a.txt", "b.txt", "c.txt"])
      await edit(yoursDir, f, `${f} 1\n${f} 2\n${f} 3\n`)
    await yoursJj(["commit", "-m", "base"])
    const base = await yoursNow(yoursJj)
    await inLane(
      planBaseRefresh({ base: null, yours: base, lock: null, install: null }),
    )
    await inLane(planForkSetup(LANE, { kind: "commits", commits: base }))
    await edit(laneDir, "a.txt", "a.txt lane\na.txt 2\na.txt 3\n")
    const t1 = await turnOn(laneJj, { ...TURN, entry: entryId("e-1") })
    if (t1 === null) throw new Error("no turn")
    await fetch(base)
    // You move on: a commit of your own, and an edit you keep.
    await edit(yoursDir, "c.txt", "c.txt yours\nc.txt 2\nc.txt 3\n")
    await yoursJj(["commit", "-m", "yours: c.txt"])
    await edit(yoursDir, "wip.txt", "wip\n")
    await yoursJj(["status"])

    // Built by the host: one mutable revision on your @-, the lane's file
    // only; no host operation snapshotted your working copy.
    const before = await opNow()
    const one = await build([{ commit: t1, description: "offer: lane" }])
    expect(
      (await opsSince(before)).filter(d => d.includes("snapshot")),
    ).toEqual([])
    const [c1] = one.changes
    const [w1] = one.commits
    if (c1 === undefined || w1 === undefined) throw new Error("no offer")
    const facts = (wrote: readonly CommitId[], changes = one.changes) =>
      offerFacts(ops, { changes, wrote, target: "@-" })
    expect(await facts([w1])).toMatchObject({
      files: ["a.txt"],
      onTarget: true,
      placed: true,
      divergent: false,
      revisions: [{ sameDescription: true, sameChange: true }],
    })
    expect(await commitsOf(yoursJj, "divergent()")).toEqual([])

    // You commit again: the offer is behind, not edited; the host refreshes.
    await edit(yoursDir, "c.txt", "c.txt yours 2\nc.txt 2\nc.txt 3\n")
    await yoursJj(["commit", "-m", "yours: c.txt again"])
    expect(await facts([w1])).toMatchObject({ onTarget: false, placed: true })
    await executeOnHost(planRefreshOffer(yoursDir, c1, "@-"))
    const refreshed = await facts([w1])
    expect(refreshed).toMatchObject({
      onTarget: true,
      revisions: [{ sameDescription: true, sameChange: true }],
    })

    // You reword it: edited; the host leaves it.
    await yoursJj(["describe", "-r", c1, "-m", "offer: as I want it"])
    expect((await facts([w1])).revisions).toEqual([
      { sameDescription: false, sameChange: true },
    ])
    await yoursJj(["describe", "-r", c1, "-m", "offer: lane"])

    // A race: your edit and a host refresh from the same operation. The
    // host keeps yours (S48 item 8).
    const [at1] = refreshed.commits
    if (at1 === undefined) throw new Error("no offer")
    const op = await opNow()
    await edit(yoursDir, "wip2.txt", "more\n")
    await yoursJj(["squash", "--into", c1, "root:wip2.txt"])
    await ops(["--at-operation", op, "describe", "-r", c1, "-m", "offer: host"])
    expect((await facts([at1])).divergent).toBe(true)
    const split = await hostCommitIn(ops, c1)
    if (split === null) throw new Error("no split")
    await executeOnHost(
      planRepair({ root: yoursDir, bookmark, ...split, top: true }),
    )
    expect(await commitsOf(yoursJj, "divergent()")).toEqual([])
    expect(await commitsOf(yoursJj, `bookmarks(exact:"${bookmark}")`)).toEqual([
      split.yours,
    ])

    // Take: under your edits; your wip file kept.
    await executeOnHost(
      planTakeOffer({
        root: yoursDir,
        bookmark,
        bottom: c1,
        top: c1,
        target: "@-",
        underYou: true,
        onto: false,
      }),
    )
    expect(await changeOf(ops, (await commitsOf(ops, "@-"))[0] ?? "")).toBe(c1)
    expect(await readFile(path.join(yoursDir, "a.txt"), "utf8")).toContain(
      "a.txt lane",
    )
    expect(await readFile(path.join(yoursDir, "wip.txt"), "utf8")).toBe("wip\n")
    expect(await hasBookmark(ops, bookmark)).toBe(false)

    // The next turn: its offer holds only what came after the take.
    const delivered: HaveRecord = {
      lane: LANE,
      commit: t1,
      kind: "delivered",
      at: 1,
    }
    await edit(laneDir, "b.txt", "b.txt lane\nb.txt 2\nb.txt 3\n")
    const t2 = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (t2 === null) throw new Error("no turn")
    await fetch([t1])
    const two = await build(
      [{ commit: t2, description: "offer: b" }],
      [delivered],
    )
    expect(
      (await offerFacts(ops, { ...two, wrote: two.commits, target: "@-" }))
        .files,
    ).toEqual(["b.txt"])

    // pineta-onto on a side commit: the offer goes there; take moves only
    // bookmarks, and @ does not change.
    await executeOnHost(planAbandonOffer(yoursDir, two.changes))
    await yoursJj(["new", "--no-edit", "@-", "-m", "side"])
    await yoursJj([
      "bookmark",
      "set",
      ONTO_BOOKMARK,
      "-r",
      'latest(description(exact:"side\\n"))',
    ])
    const beside = await build(
      [{ commit: t2, description: "offer: b" }],
      [delivered],
      ONTO_BOOKMARK,
    )
    const atBefore = await commitsOf(yoursJj, "@")
    const [bc] = beside.changes
    if (bc === undefined) throw new Error("no offer")
    await executeOnHost(
      planTakeOffer({
        root: yoursDir,
        bookmark,
        bottom: bc,
        top: bc,
        target: ONTO_BOOKMARK,
        underYou: false,
        onto: true,
      }),
    )
    expect(await commitsOf(yoursJj, "@")).toEqual(atBefore)
    expect(
      await changeOf(
        ops,
        (await commitsOf(ops, `bookmarks(exact:"${ONTO_BOOKMARK}")`))[0] ?? "",
      ),
    ).toBe(bc)

    // A stack: one revision per lane revision, each with its own file, the
    // top with the tip's files (S48 item 18).
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
    await yoursJj(["bookmark", "delete", ONTO_BOOKMARK])
    const stack = await build(
      [
        { commit: s1, description: "s1: d.txt" },
        { commit: s2, description: "s2: e.txt" },
      ],
      [delivered, { ...delivered, commit: t2 }],
    )
    const per = await Promise.all(
      stack.commits.map(async c =>
        lines((await ops(["diff", "-r", c, "--name-only"])).stdout),
      ),
    )
    expect(per).toEqual([["d.txt"], ["e.txt"]])
    const [bottom, topChange] = stack.changes
    if (bottom === undefined || topChange === undefined)
      throw new Error("no stack")
    await executeOnHost(
      planTakeOffer({
        root: yoursDir,
        bookmark,
        bottom,
        top: topChange,
        target: "@-",
        underYou: true,
        onto: false,
      }),
    )
    expect(await changeOf(ops, (await commitsOf(ops, "@-"))[0] ?? "")).toBe(
      topChange,
    )
    expect(await commitsOf(yoursJj, "divergent()")).toEqual([])

    // An offer follows its lane in place (ADR-0039, S49): the same change id
    // and bookmark, and the tree a fresh build gives, from a moved tip and
    // from a moved start, conflicted exactly when that build is.
    // A copy your repo does not hold yet (its lane never fetched) is no
    // start, and breaks nothing.
    let haves: HaveRecord[] = [
      delivered,
      { ...delivered, commit: t2 },
      { ...delivered, commit: s2 },
      { ...delivered, commit: commitId("1".repeat(40)), kind: "copy" },
    ]
    const turn = async (file: string, text: string, n: number) => {
      await edit(laneDir, file, text)
      const t = await turnOn(laneJj, {
        ...TURN,
        entry: entryId(`e-f${n}`),
      })
      if (t === null) throw new Error("no turn")
      await fetch([s2])
      return t
    }
    const t3 = await turn("g.txt", "g\n", 3)
    const open = await build([{ commit: t3, description: "WIP" }], haves)
    const [oc] = open.changes
    if (oc === undefined) throw new Error("no offer")
    const follow = async () => {
      const tip = await laneTipIn(ops, LANE)
      if (tip === null) throw new Error("no tip")
      const start = await startOfOffer(ops, { tip, target: "@-", haves })
      const at = await commitsOf(yoursJj, "@")
      await executeOnHost(
        planFollowOffer({
          root: yoursDir,
          change: oc,
          start,
          tip,
          target: "@-",
          description: null,
        }),
      )
      expect(await commitsOf(yoursJj, "@")).toEqual(at)
      const [now] = await commitsOf(ops, `bookmarks(exact:"${bookmark}")`)
      expect(await changeOf(ops, now ?? "")).toBe(oc)
      const fresh = await build(
        [{ commit: tip, description: "WIP" }],
        haves,
        "@-",
        "fresh-copy" as ThreadName,
      )
      const [fc] = fresh.changes
      if (fc === undefined) throw new Error("no fresh offer")
      expect(
        (await ops(["diff", "--from", fc, "--to", oc, "--name-only"])).stdout,
      ).toBe("")
      const conflicted = async (c: string) =>
        (await commitsOf(ops, `${c} & conflicts()`)).length > 0
      const both = [await conflicted(oc), await conflicted(fc)]
      await executeOnHost(planAbandonOffer(yoursDir, fresh.changes))
      return {
        files: lines((await ops(["diff", "-r", oc, "--name-only"])).stdout),
        conflicted: both[0],
        fresh: both[1],
      }
    }
    // The lane moves on.
    await turn("h.txt", "h\n", 4)
    expect(await follow()).toEqual({
      files: ["g.txt", "h.txt"],
      conflicted: false,
      fresh: false,
    })
    // You commit an edit to h.txt, then the lane moves: conflicted, as a
    // fresh build is.
    await edit(yoursDir, "h.txt", "h yours\n")
    await yoursJj(["commit", "-m", "yours: h.txt"])
    await turn("i.txt", "i\n", 5)
    expect(await follow()).toEqual({
      files: ["g.txt", "h.txt", "i.txt"],
      conflicted: true,
      fresh: true,
    })
    // Where it starts moves, not the lane: g.txt's turn delivered, as a
    // parent thread's take would.
    haves = [...haves, { ...delivered, commit: t3 }]
    expect((await follow()).files).toEqual(["h.txt", "i.txt"])
  }, 60_000)

  /** `offerRig`, with your base commit of `files`, and the lane on it. */
  const copyRig = async (tag: string, files: readonly string[]) => {
    const rig = await offerRig(tag)
    for (const f of files) await rig.edit(rig.yoursDir, f, `${f}\n`)
    await rig.yoursJj(["commit", "-m", "base"])
    const base = await yoursNow(rig.yoursJj)
    await rig.inLane(
      planBaseRefresh({ base: null, yours: base, lock: null, install: null }),
    )
    return {
      ...rig,
      base,
      offer: () => rig.offer(base),
      /** Start the lane from a copy of your `@` as it is now, recorded as a have. */
      fork: async () => {
        await rig.inLane(
          planForkSetup(LANE, {
            kind: "copy",
            ...(await yoursAt(rig.yoursJj)),
          }),
        )
        const [copy] = await commitsOf(
          rig.laneJj,
          `bookmarks(exact:"pineta/${LANE}")`,
        )
        if (copy === undefined) throw new Error("no copy")
        rig.have(copy, "copy")
      },
      /** Put the lane's working copy and bookmark on `commit`: one lane, two lines. */
      moveTo: async (commit: CommitId) => {
        await rig.laneJj(["new", commit])
        await rig.laneJj([
          "bookmark",
          "set",
          "--allow-backwards",
          `pineta/${LANE}`,
          "-r",
          commit,
        ])
      },
    }
  }

  test("an offer after you committed your edits differently starts at the newest copy (S51)", async () => {
    const {
      yoursDir,
      laneDir,
      yoursJj,
      edit,
      turn,
      update,
      offer,
      take,
      fork,
    } = await copyRig("s51", ["a.txt", "b.txt", "c.txt"])
    // The lane starts from a copy of your @, holding an edit you have not
    // committed.
    await edit(yoursDir, "a.txt", "a, as you were trying it\n")
    await fork()
    await edit(laneDir, "b.txt", "b, the lane's\n")
    await turn()
    // You commit that edit, differently, then update the lane.
    await edit(yoursDir, "a.txt", "a, as you kept it\n")
    await yoursJj(["commit", "-m", "yours: a.txt"])
    await update({ "a.txt": "a, as you kept it\n" })
    const clean = await offer()
    expect([clean.conflicted, clean.files]).toEqual([false, ["b.txt"]])

    // Delivered: you take it, change its line in a commit of yours, and
    // update again.
    await take(clean)
    await edit(yoursDir, "b.txt", "b, as you changed it\n")
    await yoursJj(["commit", "-m", "yours: b.txt"])
    await update({ "b.txt": "b, as you changed it\n" })
    await edit(laneDir, "c.txt", "c, the lane's\n")
    await turn()
    const again = await offer()
    expect([again.conflicted, again.files]).toEqual([false, ["c.txt"]])
  }, 60_000)

  test("a taken branch that holds all its lane's work puts the lane's offer start at its tip (S51)", async () => {
    const { laneDir, ops, fetch, edit, base, haves, have, turn, fork } =
      await copyRig("holds-tip", ["a.txt"])
    // The lane starts from a copy of your @: a have in its tip's history.
    await fork()
    await edit(laneDir, "parent.txt", "parent\n")
    const tip = await turn()
    // A branch forked at that tip turns once more, and you take its offer:
    // its delivered have descends from the lane's tip, and holds all of it.
    await edit(laneDir, "branch.txt", "branch\n")
    have(await turn(), "delivered")
    await fetch(base)
    expect(await startOfOffer(ops, { tip, target: "@-", haves })).toEqual([tip])
    // With no copy in the tip's history, the rule for haves beside the tip
    // (S72) does not apply: only the read of which haves hold the tip finds
    // the branch.
    const branchOnly = haves.filter(h => h.kind === "delivered")
    expect(
      await startOfOffer(ops, { tip, target: "@-", haves: branchOnly }),
    ).toEqual([tip])
  }, 60_000)

  test("a branch of a thread taken after the fork offers only its own (S72)", async () => {
    const { laneDir, ops, edit, haves, turn, offer, take, fork, moveTo } =
      await copyRig("s72-branch", ["a.txt"])
    await fork()
    await edit(laneDir, "a.txt", "a, at the fork\n")
    const at = await turn()
    // The parent goes on from the fork point, and you take its offer.
    await edit(laneDir, "a.txt", "a, the parent's later work\n")
    await turn()
    await take(await offer())
    // The branch goes on from the fork point too.
    await moveTo(at)
    await edit(laneDir, "b.txt", "b, the branch's\n")
    const tip = await turn()
    const branch = await offer()
    expect(await startOfOffer(ops, { tip, target: "@-", haves })).toEqual([at])
    expect([branch.conflicted, branch.files]).toEqual([false, ["b.txt"]])
  }, 60_000)

  test("a branch taken before its lane's update adds nothing to the lane's start (S51, S72)", async () => {
    const {
      yoursDir,
      laneDir,
      yoursJj,
      edit,
      turn,
      update,
      offer,
      take,
      fork,
      moveTo,
    } = await copyRig("s72-before", ["a.txt", "b.txt", "c.txt", "d.txt"])
    // The lane starts from a copy holding an edit you have not committed.
    await edit(yoursDir, "a.txt", "a, as you were trying it\n")
    await fork()
    await edit(laneDir, "b.txt", "b, the lane's\n")
    const own = await turn()
    // A branch goes on from there, and you take its offer.
    await edit(laneDir, "c.txt", "c, the branch's\n")
    await turn()
    await take(await offer())
    // The lane goes back to its own line: `mergeYours` merges on its bookmark.
    await moveTo(own)
    // You commit that edit, differently, then update the lane.
    await edit(yoursDir, "a.txt", "a, as you kept it\n")
    await yoursJj(["commit", "-m", "yours: a.txt"])
    await update({ "a.txt": "a, as you kept it\n" })
    await edit(laneDir, "d.txt", "d, the lane's\n")
    await turn()
    const lane = await offer()
    expect([lane.conflicted, lane.files]).toEqual([false, ["d.txt"]])
  }, 60_000)

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
