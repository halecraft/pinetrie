import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { entryId, snapshotId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  bookmarkOf,
  changedPaths,
  commitsOf,
  commitToBookmark,
  commitTurn,
  conflictedFilesAt,
  copyFacts,
  execute,
  HELPER,
  helperCommand,
  type LaneRuntime,
  prepareProjectDir,
  type Ran,
  type Runner,
  readConfigFile,
  run,
  runtimeNode,
  type Step,
} from "./index.ts"

// What a lane runs against jj itself, in throwaway repos, with your repo in
// it, is `@pinetrie/repo`'s `repo.test.ts`: every such test fetches into your
// repo.

const LANE = threadIdFor("1")

/** A runtime that records each call it is asked to make, and makes none. */
function recordingRuntime(seen: string[]): LaneRuntime {
  const no = () => {
    throw new Error("not recorded")
  }
  return {
    disk: async op => {
      seen.push(`disk: ${op.kind}`)
    },
    run: async shape => {
      seen.push(`run: ${shape.name}`)
    },
    execArgv: (container, argv) => ["exec", container, ...argv],
    diskExists: no,
    snapshotExists: no,
    runArgs: no,
    containerFacts: no,
    start: no,
    stop: no,
    remove: no,
    imageExists: no,
    buildImage: no,
    imagePath: no,
    runInImage: no,
  }
}

describe("execute", () => {
  const ok: Ran = { ok: true, code: 0, stdout: "", stderr: "" }
  test("runs each step where it says, in order, and stops at the first lane step that fails", async () => {
    const seen: string[] = []
    const lane: Runner = async argv => {
      seen.push(`lane: ${argv.join(" ")}`)
      return argv[0] === "bad"
        ? { ok: false, code: 1, stdout: "", stderr: "no" }
        : ok
    }
    const steps: Step[] = [
      { in: "runtime", op: { kind: "create", lane: LANE } },
      { in: "lane", argv: ["sync"] },
      {
        in: "runtime",
        op: { kind: "snapshot", lane: LANE, snapshot: snapshotId("s") },
      },
      { in: "lane", argv: ["bad"] },
      { in: "runtime", op: { kind: "delete", lane: LANE } },
    ]
    const done = await execute(steps, {
      runtime: recordingRuntime(seen),
      lane,
      laneBytes: async () => ({ ...ok, stdout: new Uint8Array() }),
    })
    expect(seen).toEqual([
      "disk: create",
      "lane: sync",
      "disk: snapshot",
      "lane: bad",
    ])
    expect(done).toMatchObject({ ok: false, step: steps[3] })
  })
})

test("helperCommand: the runtime's exec of the helper on the lane runtime's Node", () => {
  expect(helperCommand(recordingRuntime([]), "pinetrie-t-1")).toEqual([
    "exec",
    "pinetrie-t-1",
    ...runtimeNode(HELPER),
  ])
})

test("changedPaths: a path with a space and an accent comes back as it is named (S70), and a conflicted commit's paths are its files (S99)", async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pinetrie-paths-")),
  )
  try {
    const env = {
      ...process.env,
      JJ_USER: "Probe",
      JJ_EMAIL: "probe@example.com",
    }
    await run("jj", ["git", "init", "--colocate", dir], { env })
    const jj = (args: string[]) => run("jj", ["-R", dir, ...args], { env })
    const jjAt: Runner = args => run("jj", ["-R", dir, ...args], { env })
    await writeFile(path.join(dir, "a.txt"), "a\n")
    await jj(["commit", "-m", "one"])
    const [from] = await commitsOf(jjAt, "@-")
    await mkdir(path.join(dir, "d"), { recursive: true })
    await writeFile(path.join(dir, "d", "c é.txt"), "c\n")
    await jj(["commit", "-m", "two"])
    const [to] = await commitsOf(jjAt, "@-")
    if (from === undefined || to === undefined) throw new Error("no commits")
    expect(await changedPaths(jjAt, from, to)).toEqual(["d/c é.txt"])
    // Two sides change one file; their merge conflicts, and a commit
    // resolves it. Git would list every side's tree under `.jjconflict-*`.
    await writeFile(path.join(dir, "a.txt"), "left\n")
    await jj(["commit", "-m", "left"])
    const [left] = await commitsOf(jjAt, "@-")
    await jj(["new", from])
    await writeFile(path.join(dir, "a.txt"), "right\n")
    await jj(["commit", "-m", "right"])
    const [right] = await commitsOf(jjAt, "@-")
    if (left === undefined || right === undefined) throw new Error("no sides")
    await jj(["new", left, right])
    await jj(["commit", "-m", "merge"])
    const [merged] = await commitsOf(jjAt, "@-")
    if (merged === undefined) throw new Error("no merge")
    expect(await conflictedFilesAt(jjAt, merged)).toEqual(["a.txt"])
    await writeFile(path.join(dir, "a.txt"), "both\n")
    await jj(["commit", "-m", "resolved"])
    const [resolved] = await commitsOf(jjAt, "@-")
    if (resolved === undefined) throw new Error("no resolution")
    expect(await changedPaths(jjAt, merged, resolved)).toEqual(["a.txt"])
    expect(await changedPaths(jjAt, null, resolved)).toEqual(["a.txt"])
    expect(await conflictedFilesAt(jjAt, resolved)).toEqual([])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("copyFacts (S103, ADR-0080): the copy on its bookmark, on the merge whose turn commits nothing of its own, on the agent's own commit, and on a split's stack", async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pinetrie-copy-")),
  )
  try {
    const env = {
      ...process.env,
      JJ_USER: "Probe",
      JJ_EMAIL: "probe@example.com",
    }
    await run("jj", ["git", "init", "--colocate", dir], { env })
    const jj: Runner = args => run("jj", ["-R", dir, ...args], { env })
    const lane = threadIdFor("0123456789abcdef")
    const head = async (rev: string) => {
      const [id] = await commitsOf(jj, rev)
      if (id === undefined) throw new Error(`no ${rev}`)
      return id
    }
    await writeFile(path.join(dir, "base.txt"), "base\n")
    await jj(["commit", "-m", "B"])
    const base = await head("@-")
    await writeFile(path.join(dir, "line.txt"), "line\n")
    await jj(["commit", "-m", "B2"])
    const line = await head("@-")
    await jj(["new", base])
    await writeFile(path.join(dir, "lane.txt"), "lane\n")
    const own = await commitToBookmark(jj, lane, "L")
    // On the bookmark.
    expect(await copyFacts(jj, lane)).toEqual({
      parents: [own],
      bookmark: own,
      descends: false,
    })
    // The merge as `mergeUpdate` makes it: the bookmark moves to it, and the
    // next turn has no commit of its own to record (S103 item 3).
    await jj(["new", (await bookmarkOf(jj, lane)) ?? "", line, "-m", "merge"])
    const merge = await commitToBookmark(jj, lane, "merge")
    expect(
      await commitTurn(jj, {
        title: "catch_up",
        entry: entryId("e-1"),
        lane,
        bookmark: merge,
      }),
    ).toEqual({ commit: null, conflicted: false })
    expect(await copyFacts(jj, lane)).toEqual({
      parents: [merge],
      bookmark: merge,
      descends: false,
    })
    // The agent's own commit on accepted work descends from the bookmark.
    await writeFile(path.join(dir, "mine.txt"), "mine\n")
    await jj(["commit", "-m", "mine"])
    const mine = await head("@-")
    expect(await copyFacts(jj, lane)).toEqual({
      parents: [mine],
      bookmark: merge,
      descends: true,
    })
    // A split's stack, built on the base: off the lane's line.
    await jj(["new", base])
    await writeFile(path.join(dir, "stack.txt"), "stack\n")
    await jj(["commit", "-m", "stack 1"])
    const stack = await head("@-")
    expect(await copyFacts(jj, lane)).toEqual({
      parents: [stack],
      bookmark: merge,
      descends: false,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("prepareProjectDir (ADR-0086, S108): a repo's root with .pinetrie/ excluded once; a non-colocated repo refused; a plain folder untouched", async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pinetrie-dir-")),
  )
  try {
    const env = {
      ...process.env,
      JJ_USER: "Probe",
      JJ_EMAIL: "probe@example.com",
    }
    const colocated = path.join(dir, "colocated")
    await run("jj", ["git", "init", "--colocate", colocated], { env })
    await mkdir(path.join(colocated, "sub"))
    const exclude = path.join(colocated, ".git", "info", "exclude")
    const before = await readFile(exclude, "utf8").catch(() => "")
    const found = { kind: "found", root: colocated, repo: "jj" }
    expect(await prepareProjectDir(path.join(colocated, "sub"))).toEqual(found)
    expect(await prepareProjectDir(colocated)).toEqual(found)
    expect(await readFile(exclude, "utf8")).toBe(`${before}/.pinetrie/\n`)

    const apart = path.join(dir, "apart")
    await run("jj", ["git", "init", "--no-colocate", apart], { env })
    expect(await prepareProjectDir(apart)).toEqual({
      kind: "refused",
      refusal: { kind: "unexcludable", root: apart },
    })

    const plain = path.join(dir, "plain")
    await mkdir(plain)
    expect(await prepareProjectDir(plain)).toEqual({
      kind: "found",
      root: plain,
      repo: null,
    })
    expect(await prepareProjectDir(path.join(dir, "missing"))).toEqual({
      kind: "refused",
      refusal: { kind: "missing", dir: path.join(dir, "missing") },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("readConfigFile: a file read, a missing one, and one that cannot be read or parsed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-config-"))
  try {
    const at = (name: string) => path.join(dir, name)
    await writeFile(at("good.json"), '{ "digests": { "enabled": false } }')
    await writeFile(at("bad.json"), "{ bad")
    await mkdir(at("folder.json"))
    expect(await readConfigFile(at("good.json"))).toEqual({
      kind: "read",
      json: { digests: { enabled: false } },
    })
    expect(await readConfigFile(at("none.json"))).toEqual({ kind: "missing" })
    expect(await readConfigFile(at("bad.json"))).toEqual({
      kind: "broken",
      reason: expect.stringContaining("JSON"),
    })
    expect(await readConfigFile(at("folder.json"))).toEqual({
      kind: "broken",
      reason: expect.stringContaining("EISDIR"),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
