import { describe, expect, test } from "vitest"
import { HOME } from "./fixtures.ts"
import {
  jjRootAnswer,
  parsedJjVersion,
  planExclude,
  planProjectDir,
  projectPlanLine,
  type RootFacts,
} from "./project-dir.ts"

describe("the host: its root", () => {
  const facts: RootFacts = {
    dir: "/p/sub",
    isDirectory: true,
    home: HOME,
    jjVersion: "0.45.1",
    jj: { kind: "root", root: "/p" },
    git: true,
    gitTop: null,
    gitBesideJj: true,
    vcsMarker: null,
  }
  const tools = { tools: true }
  const inGit = { ...facts, jj: { kind: "no-repo" }, gitTop: "/p" } as const
  const noJj = { ...facts, jjVersion: null, jj: null } as const

  test("planProjectDir: jj's root, a jj project; else git's, else the folder; never missing, your home directory or /", () => {
    expect(planProjectDir(facts, tools)).toEqual({
      kind: "jj",
      root: "/p",
      colocate: false,
    })
    expect(
      planProjectDir({ ...facts, jj: { kind: "no-repo" } }, tools),
    ).toEqual({ kind: "folder", root: "/p/sub", jjMissing: false })
    expect(planProjectDir({ ...facts, isDirectory: false }, tools)).toEqual({
      kind: "refused",
      refusal: { kind: "missing", dir: "/p/sub" },
    })
    expect(
      planProjectDir({ ...facts, jj: { kind: "root", root: HOME } }, tools),
    ).toEqual({ kind: "refused", refusal: { kind: "unsafe", root: HOME } })
    expect(planProjectDir({ ...inGit, gitTop: "/" }, tools)).toEqual({
      kind: "refused",
      refusal: { kind: "unsafe", root: "/" },
    })
  })

  test("planProjectDir: a git repo with no jj workspace is a jj project once made colocated", () => {
    expect(planProjectDir(inGit, tools)).toEqual({
      kind: "jj",
      root: "/p",
      colocate: true,
    })
  })

  test("planProjectDir: a jj repo with no git directory beside it is refused", () => {
    expect(planProjectDir({ ...facts, gitBesideJj: false }, tools)).toEqual({
      kind: "refused",
      refusal: { kind: "not-colocated", root: "/p" },
    })
  })

  test("planProjectDir: with no jj, a folder under no version control is a folder project, said so", () => {
    expect(planProjectDir(noJj, tools)).toEqual({
      kind: "folder",
      root: "/p/sub",
      jjMissing: true,
    })
  })

  test("planProjectDir: with no jj, a folder under version control is refused, naming what found it", () => {
    expect(planProjectDir({ ...noJj, vcsMarker: "/p/.git" }, tools)).toEqual({
      kind: "refused",
      refusal: { kind: "jj-missing", marker: "/p/.git" },
    })
  })

  test("planProjectDir: jj failing is refused in its words, never read as no repo", () => {
    expect(
      planProjectDir(
        { ...facts, jj: { kind: "failed", said: "Config error" } },
        tools,
      ),
    ).toEqual({
      kind: "refused",
      refusal: { kind: "jj-failed", dir: "/p/sub", said: "Config error" },
    })
  })

  test("planProjectDir: a jj or git project with no git is refused", () => {
    const noGit = { ...facts, git: false }
    expect(planProjectDir(noGit, tools)).toEqual({
      kind: "refused",
      refusal: { kind: "git-missing", root: "/p" },
    })
    expect(
      planProjectDir(
        { ...noGit, jj: { kind: "no-repo" }, vcsMarker: "/p/.git" },
        tools,
      ),
    ).toEqual({
      kind: "refused",
      refusal: { kind: "git-missing", root: "/p/sub" },
    })
    expect(
      planProjectDir({ ...noGit, jj: { kind: "no-repo" } }, tools),
    ).toEqual({ kind: "folder", root: "/p/sub", jjMissing: false })
  })

  test("planProjectDir: without tools, the root alone, nothing refused for jj or git and nothing made colocated", () => {
    const off = { tools: false }
    expect(planProjectDir(inGit, off)).toEqual({
      kind: "folder",
      root: "/p",
      jjMissing: false,
    })
    expect(planProjectDir({ ...noJj, vcsMarker: "/p/.git" }, off)).toEqual({
      kind: "folder",
      root: "/p/sub",
      jjMissing: true,
    })
    expect(
      planProjectDir({ ...facts, gitBesideJj: false, git: false }, off),
    ).toEqual({ kind: "jj", root: "/p", colocate: false })
  })

  test("jjRootAnswer: a root; no repo only in jj's own words; any other failure, its first line", () => {
    const ran = (code: number, stdout: string, stderr: string) => ({
      ok: code === 0,
      code,
      stdout,
      stderr,
    })
    expect(jjRootAnswer(ran(0, "/p\n", ""))).toEqual({
      kind: "root",
      root: "/p",
    })
    expect(
      jjRootAnswer(ran(1, "", 'Error: There is no jj repo in "."\n')),
    ).toEqual({ kind: "no-repo" })
    expect(
      jjRootAnswer(
        ran(
          1,
          "",
          "Config error: Configuration cannot be parsed\nCaused by: x\n",
        ),
      ),
    ).toEqual({
      kind: "failed",
      said: "Config error: Configuration cannot be parsed",
    })
    expect(jjRootAnswer(ran(255, "", ""))).toEqual({
      kind: "failed",
      said: "exit 255",
    })
  })

  test("parsedJjVersion: the version jj names, or null when it did not run", () => {
    expect(
      parsedJjVersion({ ok: true, code: 0, stdout: "jj 0.45.1\n", stderr: "" }),
    ).toBe("0.45.1")
    expect(
      parsedJjVersion({ ok: false, code: -1, stdout: "", stderr: "ENOENT" }),
    ).toBeNull()
  })

  test("projectPlanLine: says a git repo is made colocated, and a folder served with no jj", () => {
    expect(
      projectPlanLine({ kind: "jj", root: "/p", colocate: true }),
    ).toContain("jj git init --colocate")
    expect(
      projectPlanLine({ kind: "folder", root: "/p", jjMissing: true }),
    ).toContain("jj does not run")
    expect(
      projectPlanLine({ kind: "jj", root: "/p", colocate: false }),
    ).toBeNull()
    expect(
      projectPlanLine({ kind: "folder", root: "/p", jjMissing: false }),
    ).toBeNull()
  })
  test("planExclude: adds each missing line once, on a line of its own", () => {
    expect(planExclude("", ["/.notes/"])).toBe("/.notes/\n")
    expect(planExclude("# x", ["/.notes/", "/.plans/"])).toBe(
      "# x\n/.notes/\n/.plans/\n",
    )
    expect(planExclude("a\n/.notes/\n", ["/.notes/", "/.plans/"])).toBe(
      "a\n/.notes/\n/.plans/\n",
    )
    expect(planExclude("a\n/.notes/\n", ["/.notes/"])).toBeNull()
  })
})
