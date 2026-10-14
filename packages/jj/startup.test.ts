import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { run } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { DEFAULT_REPO, isBookmarkName } from "./lane/names.ts"
import { prepareProjectDir, repoConfig } from "./startup.ts"

describe("repoConfig: the project's values win, and a bad one falls back", () => {
  const none = {
    acceptedBookmark: null,
    wipPrefix: null,
    publish: null,
    catchUp: null,
    offers: false,
  }
  test("defaults with nothing set", () => {
    expect(repoConfig(none, none)).toEqual({
      repoConfig: DEFAULT_REPO,
      refused: [],
    })
  })
  test("the project's name wins over the user's", () => {
    expect(
      repoConfig(
        {
          ...none,
          acceptedBookmark: "mine",
          wipPrefix: "draft/",
          publish: "master",
          catchUp: true,
        },
        { ...none, acceptedBookmark: "trunk" },
      ).repoConfig,
    ).toEqual({
      acceptedBookmark: "trunk",
      wipPrefix: "draft/",
      publish: "master",
      publishCatchesUp: true,
    })
  })
  test("catching up is off unless set, and the project's setting wins", () => {
    expect(DEFAULT_REPO.publishCatchesUp).toBe(false)
    expect(
      repoConfig({ ...none, catchUp: true }, { ...none, catchUp: false })
        .repoConfig.publishCatchesUp,
    ).toBe(false)
    expect(
      repoConfig(none, { ...none, catchUp: true }).repoConfig.publishCatchesUp,
    ).toBe(true)
  })
  test("a catchUp that is not true or false falls back to off, saying why", () => {
    const r = repoConfig(
      { ...none, catchUp: true },
      { ...none, catchUp: { invalid: '"yes"' } },
    )
    expect(r.repoConfig.publishCatchesUp).toBe(false)
    expect(r.refused).toEqual([
      'publish.catchUp "yes" is not true or false; using false',
    ])
  })
  test("a name that is no bookmark falls back, saying why", () => {
    const r = repoConfig(none, {
      ...none,
      acceptedBookmark: "has space",
      wipPrefix: "a..b/",
      publish: "a:b",
    })
    expect(r.repoConfig).toEqual(DEFAULT_REPO)
    expect(r.refused).toEqual([
      `accepted.bookmark "has space" is not a bookmark name; using "${DEFAULT_REPO.acceptedBookmark}"`,
      'wip.prefix "a..b/" is not a bookmark name; using "wip/"',
      'publish.bookmark "a:b" is not a bookmark name; using "main"',
    ])
  })
  test("a config that still has offers is named, and nothing of it is read", () => {
    const r = repoConfig({ ...none, offers: true }, { ...none, offers: true })
    expect(r.repoConfig).toEqual(DEFAULT_REPO)
    expect(r.refused).toEqual([
      "your config: offers is no longer read; use accepted.bookmark, wip.prefix, publish.bookmark and publish.catchUp",
      "pinetrie.json: offers is no longer read; use accepted.bookmark, wip.prefix, publish.bookmark and publish.catchUp",
    ])
  })
  test("isBookmarkName: git's rules", () => {
    for (const ok of ["pinetrie-accepted", "wip/x", "a.b"])
      expect(isBookmarkName(ok)).toBe(true)
    for (const bad of ["", "a b", "a..b", "-a", "a/", "a.lock", "a@b", "a:b"])
      expect(isBookmarkName(bad)).toBe(false)
  })
})

test("prepareProjectDir: .pinetrie/ excluded once, in a git repo too; a non-colocated repo refused; a plain folder untouched", async () => {
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
    expect(await readFile(exclude, "utf8")).toBe(`${before}/.pinetrie/\n`)

    const apart = path.join(dir, "apart")
    await run("jj", ["git", "init", "--no-colocate", apart], { env })
    expect(await prepareProjectDir(apart)).toEqual({
      kind: "refused",
      refusal: { kind: "unexcludable", root: apart },
    })

    const gitOnly = path.join(dir, "git-only")
    await run("git", ["init", "-q", gitOnly])
    expect(await prepareProjectDir(gitOnly)).toEqual({
      kind: "folder",
      root: gitOnly,
    })
    expect(
      await readFile(path.join(gitOnly, ".git", "info", "exclude"), "utf8"),
    ).toContain("/.pinetrie/\n")

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
