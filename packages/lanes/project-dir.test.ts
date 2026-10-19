import { describe, expect, test } from "vitest"
import { HOME } from "./fixtures.ts"
import { planExclude, planProjectDir } from "./project-dir.ts"

describe("the host: its root", () => {
  test("planProjectDir: jj's root, a jj project; else git's, else the folder, a folder project; never missing, your home directory or /", () => {
    const facts = {
      dir: "/p/sub",
      isDirectory: true,
      jjRoot: "/p",
      gitTop: null,
      home: HOME,
    }
    expect(planProjectDir(facts)).toEqual({ kind: "jj", root: "/p" })
    expect(planProjectDir({ ...facts, jjRoot: null, gitTop: "/p" })).toEqual({
      kind: "folder",
      root: "/p",
    })
    expect(planProjectDir({ ...facts, jjRoot: null })).toEqual({
      kind: "folder",
      root: "/p/sub",
    })
    expect(planProjectDir({ ...facts, isDirectory: false })).toEqual({
      kind: "refused",
      refusal: { kind: "missing", dir: "/p/sub" },
    })
    expect(planProjectDir({ ...facts, jjRoot: HOME })).toEqual({
      kind: "refused",
      refusal: { kind: "unsafe", root: HOME },
    })
    expect(planProjectDir({ ...facts, jjRoot: null, gitTop: "/" })).toEqual({
      kind: "refused",
      refusal: { kind: "unsafe", root: "/" },
    })
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
