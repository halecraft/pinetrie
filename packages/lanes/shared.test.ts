import { describe, expect, test } from "vitest"
import { planLinks, planShared } from "./shared.ts"

describe("planShared: which shared directories apply, and what the host does for them", () => {
  const none = new Set<string>()
  const facts = {
    entries: [".plans", "notes/", ".plans", "shared/data"],
    exists: new Set([".plans"]),
    tracked: none,
    ignored: new Set([".plans"]),
  }
  test("in order, normalized, each once", () => {
    expect(planShared(facts).shared).toEqual([".plans", "notes", "shared/data"])
  })
  test("created when missing; excluded in your repo unless already ignored", () => {
    const planned = planShared(facts)
    expect(planned.create).toEqual(["notes", "shared/data"])
    expect(planned.exclude).toEqual(["notes", "shared/data"])
  })
  test("refused, with a reason: absolute, leaving the project, in a repo or dependencies, tracked", () => {
    const planned = planShared({
      ...facts,
      entries: [
        "/abs",
        "../out",
        ".",
        ".jj/plans",
        ".git",
        "node_modules/y",
        "docs",
      ],
      tracked: new Set(["docs"]),
    })
    expect(planned.shared).toEqual([])
    expect(planned.refused.map(r => `${r.path}: ${r.reason}`)).toEqual([
      "/abs: it is absolute",
      "../out: it leaves the project",
      ".: it leaves the project",
      ".jj/plans: it is inside .jj",
      ".git: it is inside .git",
      "node_modules/y: it is inside node_modules",
      "docs: it holds files jj tracks",
    ])
  })
})

test("planLinks: the directory beside the project that a link leaves for, mounted where it resolves", () => {
  expect(
    planLinks("/w/pinetrie", [
      { path: "node_modules/@k/a", target: "../../../kyneta/packages/a" },
      {
        path: "packages/x/node_modules/@k/a",
        target: "../../../../kyneta/packages/b",
      },
      { path: "node_modules/far", target: "../../../other/c" },
      { path: "node_modules/in", target: "../packages/in" },
      { path: "node_modules/abs", target: "/opt/abs" },
    ]),
  ).toEqual([
    { source: "/other", target: "/other", readonly: true },
    { source: "/w/kyneta", target: "/kyneta", readonly: true },
  ])
})
