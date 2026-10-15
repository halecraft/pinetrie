import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { run } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { DEFAULT_REPO, isBookmarkName } from "./lane/names.ts"
import { prepareProjectDir } from "./startup.ts"

test("prepareProjectDir: a project's root and kind, written nowhere; a non-colocated repo refused", async () => {
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
    const found = { kind: "jj", root: colocated }
    expect(await prepareProjectDir(path.join(colocated, "sub"))).toEqual(found)
    expect(await prepareProjectDir(colocated)).toEqual(found)
    expect(await readFile(exclude, "utf8").catch(() => "")).toBe(before)
    expect((await readdir(colocated)).sort()).toEqual([".git", ".jj", "sub"])

    const apart = path.join(dir, "apart")
    await run("jj", ["git", "init", "--no-colocate", apart], { env })
    expect(await prepareProjectDir(apart)).toEqual({
      kind: "refused",
      refusal: { kind: "not-colocated", root: apart },
    })

    const gitOnly = path.join(dir, "git-only")
    await run("git", ["init", "-q", gitOnly])
    expect(await prepareProjectDir(gitOnly)).toEqual({
      kind: "folder",
      root: gitOnly,
    })
    expect((await readdir(gitOnly)).sort()).toEqual([".git"])

    const plain = path.join(dir, "plain")
    await mkdir(plain)
    expect(await prepareProjectDir(plain)).toEqual({
      kind: "folder",
      root: plain,
    })
    expect(await prepareProjectDir(path.join(dir, "missing"))).toEqual({
      kind: "refused",
      refusal: { kind: "missing", dir: path.join(dir, "missing") },
    })
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
