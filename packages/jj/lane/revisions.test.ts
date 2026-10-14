import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { entryId, threadIdFor } from "@pinetrie/core"
import { type Runner, run } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { bookmarkOf } from "./bookmarks.ts"
import {
  changedPaths,
  commitsOf,
  commitToBookmark,
  commitTurn,
  conflictedFilesAt,
  copyFacts,
} from "./revisions.ts"

test("changedPaths: each path as it is named, a conflicted commit's included", async () => {
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

test("copyFacts: on its bookmark, after a merge, on the agent's own commit, on a split's stack", async () => {
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
    // next turn has no commit of its own to record.
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
