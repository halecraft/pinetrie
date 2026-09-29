import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type CommitId,
  entryId,
  laneNameForThread,
  NO_EDITOR,
} from "@pineta/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  bookmarkOf,
  commitsOf,
  commitTurn,
  conflictContent,
  conflictsIn,
  entryOfMessage,
  execute,
  executeOrThrow,
  fetchById,
  hostBytesRunner,
  hostJj,
  hostRunner,
  type LaneStep,
  laneIgnores,
  mergeYours,
  planBaseRefresh,
  planFetch,
  planForkSetup,
  protectLaneBookmarks,
  type Ran,
  type Runner,
  revisionMessage,
  run,
  sideHistory,
  takeInto,
  yoursNow,
} from "./index.ts"

const LANE = laneNameForThread("1")
const FORK = laneNameForThread("2")

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

/** jj on a lane's repo, with the lane's own config, as `JJ_CONFIG` gives it in a container. */
const laneJjAt =
  (dir: string): Runner =>
  args =>
    run("jj", ["-R", dir, "--no-pager", "--color=never", ...args], {
      env: { ...NO_EDITOR, JJ_CONFIG: path.join(dir, ".pineta-lane/jj.toml") },
    })

describe("a lane's repo, with jj", () => {
  let top = ""
  const exists = (p: string) =>
    stat(p).then(
      () => true,
      () => false,
    )
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

  test("the whole life of a lane: base, turn, fetch, land, take, fork", async () => {
    const yoursDir = path.join(top, "yours")
    const laneDir = path.join(top, "lane")
    const forkDir = path.join(top, "fork")
    await run("mkdir", ["-p", yoursDir, laneDir])
    await run("jj", ["git", "init", "--colocate", yoursDir])
    const yoursJj = hostJj(yoursDir)
    await protectLaneBookmarks(yoursJj)
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
    await inLane(laneDir, planForkSetup(LANE, base))
    expect(await readFile(path.join(laneDir, "shared.txt"), "utf8")).toContain(
      "two",
    )
    expect(await bookmarkOf(laneJj, LANE)).toBe(base[0])
    // The same change ids on both sides.
    const changeOf = async (jj: Runner, rev: string) =>
      (
        await jj([
          "log",
          "--no-graph",
          "--ignore-working-copy",
          "-r",
          rev,
          "-T",
          "change_id",
        ])
      ).stdout
    expect(await changeOf(laneJj, base[0] ?? "")).toBe(
      await changeOf(yoursJj, base[0] ?? ""),
    )

    // A turn that changed nothing records nothing; one that did, commits.
    const turn = { entry: entryId("e-1"), lane: LANE, title: "edit line two" }
    expect(await commitTurn(laneJj, turn)).toBeNull()
    await writeFile(
      path.join(laneDir, "shared.txt"),
      "one\ntwo (lane)\nthree\n",
    )
    // A shared directory, as a lane's mount would put it: never committed.
    await mkdir(path.join(laneDir, ".plans"), { recursive: true })
    await writeFile(path.join(laneDir, ".plans", "a.md"), "a plan\n")
    const r1 = await commitTurn(laneJj, turn)
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

    // Your repo fetches it by bundle, and cannot rewrite it.
    await fetchInto(laneDir, LANE, base)
    expect(await bookmarkOf(yoursJj, LANE)).toBe(r1)
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
    const yours = await yoursNow(yoursJj)

    // Landing: the lane fetches your @- by id and merges it; the line conflicts.
    await inLane(laneDir, [fetchById(yours)])
    const { ours, merge } = await mergeYours(laneJj, LANE, yours)
    expect(merge).not.toBeNull()
    expect(await conflictsIn(laneJj)).toEqual(["shared.txt"])
    expect(await conflictContent(laneJj, "shared.txt")).toContain("<<<<<<<")
    const sides = { ours, theirs: yours }
    expect(
      (await sideHistory(laneJj, sides, [ours], "shared.txt")).map(
        entryOfMessage,
      ),
    ).toEqual(["e-1"])
    expect(await sideHistory(laneJj, sides, yours, "shared.txt")).toEqual([
      "you edit line two",
    ])

    // The agent resolves; the resolution is a turn; nothing conflicts.
    await writeFile(
      path.join(laneDir, "shared.txt"),
      "one\ntwo (you, and lane)\nthree\n",
    )
    const resolved = await commitTurn(laneJj, {
      ...turn,
      entry: entryId("e-2"),
    })
    if (resolved === null) throw new Error("the resolution committed nothing")
    expect(await conflictsIn(laneJj)).toEqual([])
    // Landing again finds your work already there.
    expect((await mergeYours(laneJj, LANE, yours)).merge).toBeNull()

    // You take it: both changes, and your uncommitted file kept.
    await fetchInto(laneDir, LANE, [r1])
    await takeInto(yoursJj, resolved)
    expect(await readFile(path.join(yoursDir, "shared.txt"), "utf8")).toContain(
      "two (you, and lane)",
    )
    expect(await exists(path.join(yoursDir, "still-editing.txt"))).toBe(true)

    // A clean landing: the merge is committed even with nothing to resolve,
    // so the lane's newest revision holds your work, and its own.
    await writeFile(path.join(laneDir, "lane-only.txt"), "lane\n")
    await commitTurn(laneJj, { ...turn, entry: entryId("e-3") })
    await yoursJj(["new"])
    await writeFile(path.join(yoursDir, "yours-only.txt"), "yours\n")
    await yoursJj(["commit", "-m", "you add a file"])
    const clean = await yoursNow(yoursJj)
    await inLane(laneDir, [fetchById(clean)])
    const landed = await mergeYours(laneJj, LANE, clean)
    expect(landed.merge).not.toBeNull()
    expect(await conflictsIn(laneJj)).toEqual([])
    const newest = await bookmarkOf(laneJj, LANE)
    expect(
      (
        await commitsOf(laneJj, `(${clean[0]} | ${landed.ours}) & ::${newest}`)
      ).sort(),
    ).toEqual([clean[0], landed.ours].sort())

    // A fork: the lane's whole directory cloned, ignored files too, then its
    // own change on the fork commit. Both sides then work on.
    await writeFile(path.join(laneDir, "cache.bin"), "ignored state\n")
    await writeFile(path.join(laneDir, ".gitignore"), "cache.bin\n")
    const point = await commitTurn(laneJj, { ...turn, entry: entryId("e-4") })
    if (point === null) throw new Error("the fork point committed nothing")
    await fetchInto(laneDir, LANE, [resolved])
    await cp(laneDir, forkDir, { recursive: true, verbatimSymlinks: true })
    await inLane(forkDir, planForkSetup(FORK, [point]))
    const forkJj = laneJjAt(forkDir)
    expect(await readFile(path.join(forkDir, "cache.bin"), "utf8")).toBe(
      "ignored state\n",
    )

    await writeFile(path.join(laneDir, "shared.txt"), "parent\n")
    const parentNext = await commitTurn(laneJj, {
      ...turn,
      entry: entryId("e-5"),
    })
    await writeFile(path.join(forkDir, "shared.txt"), "fork\n")
    const forkNext = await commitTurn(forkJj, {
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
    expect(await bookmarkOf(yoursJj, FORK)).toBe(forkNext)
    // The fork's writes never reach its parent.
    expect(await readFile(path.join(laneDir, "shared.txt"), "utf8")).toBe(
      "parent\n",
    )
    // The fork cannot rewrite what it inherited.
    expect((await forkJj(["describe", "-r", point, "-m", "x"])).ok).toBe(false)
  }, 60_000)
})
