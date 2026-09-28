import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { commitId, entryId, laneNameForThread, writerId } from "@pineta/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  bookmarkOf,
  commitTurn,
  conflictsIn,
  createWorkspace,
  ensureWorkspace,
  entryOfMessage,
  forgetWorkspace,
  jj,
  mergeYours,
  PINETA_HEADS,
  planEnsure,
  planExclude,
  planImmutable,
  planProject,
  planRelink,
  planSetup,
  planWhere,
  prepareProject,
  sideHistory,
  takeInto,
  workspaceDir,
  yoursNow,
} from "./index.ts"

const LANE = laneNameForThread("0198-a")
const OTHER = laneNameForThread("0198-b")

describe("planProject: jj first, then git, never home or /", () => {
  const home = "/Users/me"
  test("a jj repo is used where jj says it is", () => {
    expect(
      planProject({ dir: "/p/sub", jjRoot: "/p", gitTop: null, home }),
    ).toEqual({ kind: "use", root: "/p" })
  })
  test("a git repo is initialized at git's top level; a plain directory where it is", () => {
    expect(
      planProject({ dir: "/p/sub", jjRoot: null, gitTop: "/p", home }),
    ).toEqual({
      kind: "init",
      dir: "/p",
    })
    expect(
      planProject({ dir: "/p", jjRoot: null, gitTop: null, home }),
    ).toEqual({
      kind: "init",
      dir: "/p",
    })
  })
  test("a home directory that is a dotfiles repo is never initialized, nor /", () => {
    expect(
      planProject({ dir: "/Users/me/proj", jjRoot: null, gitTop: home, home }),
    ).toMatchObject({ kind: "direct", root: "/Users/me/proj" })
    expect(
      planProject({ dir: home, jjRoot: null, gitTop: null, home }),
    ).toMatchObject({
      kind: "direct",
    })
    expect(
      planProject({ dir: "/", jjRoot: null, gitTop: null, home }),
    ).toMatchObject({
      kind: "direct",
    })
  })
})

test("planExclude: adds the line once", () => {
  expect(planExclude("")).toBe("/workspace/\n")
  expect(planExclude("# git\n*.log")).toBe("# git\n*.log\n/workspace/\n")
  expect(planExclude("# git\n/workspace/\n")).toBeNull()
})

test("planImmutable: keeps your value, and is idempotent", () => {
  expect(planImmutable("builtin_immutable_heads()\n")).toBe(
    `(builtin_immutable_heads()) | ${PINETA_HEADS}`,
  )
  expect(planImmutable(`(trunk()) | ${PINETA_HEADS}`)).toBeNull()
})

test("planRelink: only relative targets that leave the workspace, from your working copy", () => {
  const links = [
    {
      path: "packages/pi/node_modules/@kyneta/schema",
      target: "../../../../../kyneta/schema",
    },
    {
      path: "packages/client/node_modules/@pineta/core",
      target: "../../../core",
    },
    { path: "node_modules/abs", target: "/opt/x" },
  ]
  expect(planRelink(links, "/h/pineta", "/h/pineta/workspace/t-1")).toEqual([
    {
      path: "packages/pi/node_modules/@kyneta/schema",
      target: "/h/kyneta/schema",
    },
  ])
})

test("planSetup: pnpm first, else a clone of what there is", () => {
  expect(planSetup({ pnpmLock: true, nodeModules: ["node_modules"] })).toEqual({
    kind: "pnpm",
  })
  expect(planSetup({ pnpmLock: false, nodeModules: ["node_modules"] })).toEqual(
    {
      kind: "clone",
      dirs: ["node_modules"],
    },
  )
  expect(planSetup({ pnpmLock: false, nodeModules: [] })).toEqual({
    kind: "none",
  })
})

test("planWhere: the others are every other own lane and the project; none when direct", () => {
  const project = {
    kind: "workspaces" as const,
    root: "/p",
    rootDefault: "own" as const,
  }
  const record = (
    lane: typeof LANE,
    work: { kind: "own" } | { kind: "direct"; dir: string },
  ) => ({
    lane,
    work,
    by: writerId("x"),
    createdAt: 0,
  })
  const records = new Map([
    [LANE, record(LANE, { kind: "own" })],
    [OTHER, record(OTHER, { kind: "own" })],
  ])
  expect(planWhere({ project, records }, LANE)).toEqual({
    dir: workspaceDir("/p", LANE),
    others: [workspaceDir("/p", OTHER), "/p"],
  })
  const direct = new Map([
    [LANE, record(LANE, { kind: "direct", dir: "/elsewhere" })],
  ])
  expect(planWhere({ project, records: direct }, LANE)).toEqual({
    dir: "/elsewhere",
    others: [],
  })
  expect(planWhere({ project, records }, laneNameForThread("none"))).toBeNull()
})

test("planEnsure: healthy gets the guard; missing is added again at the bookmark", () => {
  const at = commitId("c1")
  expect(planEnsure({ listed: true, dirExists: true, bookmark: at })).toEqual([
    { kind: "updateStale" },
  ])
  expect(planEnsure({ listed: true, dirExists: false, bookmark: at })).toEqual([
    { kind: "forget" },
    { kind: "add", at },
  ])
  expect(planEnsure({ listed: false, dirExists: true, bookmark: at })).toEqual([
    { kind: "clear" },
    { kind: "add", at },
  ])
  expect(
    planEnsure({ listed: false, dirExists: false, bookmark: null }),
  ).toEqual([])
})

test("entryOfMessage: reads back the trailer a revision was written with", () => {
  expect(
    entryOfMessage("fix it\n\nPineta-Entry: e-1\nPineta-Lane: t-1\n"),
  ).toBe("e-1")
  expect(entryOfMessage("your commit")).toBeNull()
})

// ── against jj itself, in a throwaway repo ────────────────────────────────

describe("a lane's workspace, with jj", () => {
  let root = ""
  const exists = (p: string) =>
    stat(p).then(
      () => true,
      () => false,
    )
  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "pineta-ws-")))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("the whole life of a lane: create, turn, recreate, land, take, forget", async () => {
    const log: string[] = []
    const project = await prepareProject(root, m => log.push(m))
    expect(project).toEqual({ kind: "workspaces", root, rootDefault: "own" })
    expect(log.join("\n")).toContain("initialized a jj repo")
    for (const [k, v] of [
      ["user.name", "Probe"],
      ["user.email", "probe@example.com"],
    ] as const)
      await jj(root, ["config", "set", "--repo", k, v])
    expect(
      await readFile(path.join(root, ".git/info/exclude"), "utf8"),
    ).toContain("/workspace/")
    // Preparing again changes nothing.
    expect(await prepareProject(root, () => {})).toEqual(project)

    // Your committed work: a file with three lines.
    await writeFile(path.join(root, "shared.txt"), "one\ntwo\nthree\n")
    await jj(root, ["commit", "-m", "your base"])
    const base = await yoursNow(root)
    expect(base).toHaveLength(1)

    // A lane at your @-, with its bookmark there.
    const at = await createWorkspace(root, LANE, base)
    const ws = workspaceDir(root, LANE)
    expect(at).toBe(base[0])
    expect(await bookmarkOf(root, LANE)).toBe(at)
    expect(await readFile(path.join(ws, "shared.txt"), "utf8")).toContain("two")
    expect(await exists(path.join(ws, "workspace"))).toBe(false)

    // A turn that changed nothing records nothing; one that did, commits.
    const turn = { entry: entryId("e-1"), lane: LANE, title: "edit line two" }
    expect(await commitTurn(root, ws, turn)).toBeNull()
    await writeFile(path.join(ws, "shared.txt"), "one\ntwo (lane)\nthree\n")
    const r1 = await commitTurn(root, ws, turn)
    expect(r1).not.toBeNull()
    expect(await bookmarkOf(root, LANE)).toBe(r1)

    // The base a lane builds on is immutable, even from your working copy.
    const describe = await jj(root, ["describe", "-r", at, "-m", "rewritten"])
    expect(describe.ok).toBe(false)

    // A lost directory is added again at the bookmark, with the lane's files.
    await rm(ws, { recursive: true, force: true })
    expect(await ensureWorkspace(root, LANE)).toEqual({
      added: true,
      usable: true,
    })
    expect(await readFile(path.join(ws, "shared.txt"), "utf8")).toContain(
      "(lane)",
    )
    expect(await ensureWorkspace(root, LANE)).toEqual({
      added: false,
      usable: true,
    })

    // You change the same line, commit, and keep editing.
    await jj(root, ["new"])
    await writeFile(path.join(root, "shared.txt"), "one\ntwo (you)\nthree\n")
    await jj(root, ["commit", "-m", "you edit line two"])
    await writeFile(path.join(root, "still-editing.txt"), "wip\n")
    const yours = await yoursNow(root)

    // Landing: the lane merges your work; the line conflicts.
    const { ours, merge } = await mergeYours(root, ws, LANE, yours)
    expect(merge).not.toBeNull()
    expect(await conflictsIn(ws)).toEqual(["shared.txt"])
    const oursHistory = await sideHistory(
      ws,
      { ours, theirs: yours },
      [ours],
      "shared.txt",
    )
    expect(oursHistory.map(entryOfMessage)).toEqual(["e-1"])
    const theirsHistory = await sideHistory(
      ws,
      { ours, theirs: yours },
      yours,
      "shared.txt",
    )
    expect(theirsHistory).toEqual(["you edit line two"])

    // The agent resolves; the resolution is a turn; nothing conflicts.
    await writeFile(
      path.join(ws, "shared.txt"),
      "one\ntwo (you, and lane)\nthree\n",
    )
    const resolved = await commitTurn(root, ws, {
      ...turn,
      entry: entryId("e-2"),
    })
    expect(await conflictsIn(ws)).toEqual([])
    // Landing again finds your work already there.
    expect((await mergeYours(root, ws, LANE, yours)).merge).toBeNull()

    // You take it: both changes, and your uncommitted file kept.
    if (resolved === null) throw new Error("the resolution committed nothing")
    await takeInto(root, resolved)
    expect(await readFile(path.join(root, "shared.txt"), "utf8")).toContain(
      "two (you, and lane)",
    )
    expect(await exists(path.join(root, "still-editing.txt"))).toBe(true)

    // A clean landing: the merge is committed even with nothing to resolve,
    // so the lane's newest revision holds your work, and taking it keeps it.
    // Each side moves on after the take, so neither holds the other.
    await writeFile(path.join(ws, "lane-only.txt"), "lane\n")
    await commitTurn(root, ws, { ...turn, entry: entryId("e-3") })
    await jj(root, ["new"])
    await writeFile(path.join(root, "yours-only.txt"), "yours\n")
    await jj(root, ["commit", "-m", "you add a file"])
    const clean = await yoursNow(root)
    const landed = await mergeYours(root, ws, LANE, clean)
    expect(landed.merge).not.toBeNull()
    expect(await conflictsIn(ws)).toEqual([])
    const newest = await bookmarkOf(root, LANE)
    // Both sides are under the lane's newest revision: yours, and its own.
    const holds = await jj(root, [
      "log",
      "--ignore-working-copy",
      "--no-graph",
      "-r",
      `(${clean[0]} | ${landed.ours}) & ::${newest}`,
      "-T",
      'commit_id ++ "\\n"',
    ])
    expect(holds.stdout.trim().split("\n").sort()).toEqual(
      [clean[0], landed.ours].sort(),
    )

    // Forgotten: no directory, no bookmark; the commits stay.
    await forgetWorkspace(root, LANE)
    expect(await exists(ws)).toBe(false)
    expect(await bookmarkOf(root, LANE)).toBeNull()
  }, 60_000)
})
