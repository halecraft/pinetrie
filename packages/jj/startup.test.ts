import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { run } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { DEFAULT_REPO, isBookmarkName } from "./lane/names.ts"
import { prepareProjectDir, settleProjectDir } from "./startup.ts"

test("prepareProjectDir: a project's root and kind, written nowhere; a non-colocated repo refused; a git repo to be made colocated", async () => {
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
    const found = { kind: "jj", root: colocated, colocate: false }
    const tools = { tools: true }
    expect(await prepareProjectDir(path.join(colocated, "sub"), tools)).toEqual(
      found,
    )
    expect(await prepareProjectDir(colocated, tools)).toEqual(found)
    expect(await readFile(exclude, "utf8").catch(() => "")).toBe(before)
    expect((await readdir(colocated)).sort()).toEqual([".git", ".jj", "sub"])

    const apart = path.join(dir, "apart")
    await run("jj", ["git", "init", "--no-colocate", apart], { env })
    expect(await prepareProjectDir(apart, tools)).toEqual({
      kind: "refused",
      refusal: { kind: "not-colocated", root: apart },
    })

    const gitOnly = path.join(dir, "git-only")
    await run("git", ["init", "-q", gitOnly])
    expect(await prepareProjectDir(gitOnly, tools)).toEqual({
      kind: "jj",
      root: gitOnly,
      colocate: true,
    })
    expect((await readdir(gitOnly)).sort()).toEqual([".git"])
    expect(await prepareProjectDir(gitOnly, { tools: false })).toEqual({
      kind: "folder",
      root: gitOnly,
      jjMissing: false,
    })

    const plain = path.join(dir, "plain")
    await mkdir(plain)
    expect(await prepareProjectDir(plain, tools)).toEqual({
      kind: "folder",
      root: plain,
      jjMissing: false,
    })
    expect(await prepareProjectDir(path.join(dir, "missing"), tools)).toEqual({
      kind: "refused",
      refusal: { kind: "missing", dir: path.join(dir, "missing") },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("settleProjectDir: a git repo is made colocated, its branch and edits as they were", async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pinetrie-colocate-")),
  )
  try {
    const git = (...args: string[]) =>
      run("git", ["-c", "user.name=Probe", "-c", "user.email=p@x", ...args], {
        cwd: dir,
      })
    await git("init", "-q", "-b", "main")
    await writeFile(path.join(dir, "a.txt"), "one\n")
    await git("add", "a.txt")
    await git("commit", "-qm", "first")
    await writeFile(path.join(dir, "a.txt"), "one\ntwo\n")
    const status = (await git("status", "--short")).stdout
    const plan = await prepareProjectDir(dir, { tools: true })
    expect(await settleProjectDir(plan)).toEqual({ kind: "jj", root: dir })
    expect(await prepareProjectDir(dir, { tools: true })).toEqual({
      kind: "jj",
      root: dir,
      colocate: false,
    })
    expect((await git("branch", "--show-current")).stdout.trim()).toBe("main")
    expect((await git("status", "--short")).stdout).toBe(status)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("isBookmarkName: git's rules", () => {
  for (const ok of ["pinetrie-accepted", "wip/x", "a.b"])
    expect(isBookmarkName(ok)).toBe(true)
  for (const bad of ["", "a b", "a..b", "-a", "a/", "a.lock", "a@b", "a:b"])
    expect(isBookmarkName(bad)).toBe(false)
})

test("catching up is off unless a config turns it on", () => {
  expect(DEFAULT_REPO.publishCatchesUp).toBe(false)
})
