import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { commitId, NO_EDITOR } from "@pinetrie/core"
import { lines, run } from "@pinetrie/lanes"
import { afterAll, expect, test } from "vitest"
import { DEFAULT_REPO } from "./lane/names.ts"
import { hostOps } from "./run.ts"
import { readShared } from "./shared.ts"

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

test("the shared facts' one read gives accepted work's commit, its accepted thread commits, and the files @ changes as jj diff lists them", async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "shared-")))
  dirs.push(dir)
  const jj = (...args: string[]) =>
    run("jj", ["-R", dir, ...args], { env: NO_EDITOR })
  const parent = async () =>
    commitId(
      (await jj("log", "--no-graph", "-r", "@-", "-T", "commit_id")).stdout,
    )
  await run("jj", ["git", "init", "--colocate", dir])
  await mkdir(path.join(dir, "d"))
  await writeFile(path.join(dir, "d", "a.txt"), "a\n")
  await jj("commit", "-m", "base")
  const base = await parent()
  await writeFile(path.join(dir, "b.txt"), "b\n")
  await jj(
    "commit",
    "-m",
    `feat: b\n\nPinetrie-Thread: t\nPinetrie-Source: ${base}\n`,
  )
  const threadCommit = await parent()
  await writeFile(path.join(dir, "c.txt"), "c\n")
  await jj("commit", "-m", "yours: c")
  const accepted = await parent()
  await jj("bookmark", "create", DEFAULT_REPO.acceptedBookmark, "-r", "@-")
  // Your edits: a rename into the root, and a file with a space.
  await rename(path.join(dir, "d", "a.txt"), path.join(dir, "moved.txt"))
  await writeFile(path.join(dir, "sp ace.txt"), "new\n")
  await jj("status")
  const ops = hostOps(dir)
  const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
    .stdout
  const shared = await readShared(op, ops, DEFAULT_REPO)
  const listed = lines((await ops(["diff", "-r", "@", "--name-only"])).stdout)
  expect(shared).toEqual({
    op,
    acceptedCommit: accepted,
    acceptedThreadCommits: [{ commit: threadCommit, sources: [base] }],
    untraced: [],
    editing: new Set(listed),
  })
  expect([...shared.editing].sort()).toEqual(["moved.txt", "sp ace.txt"])
}, 60_000)
