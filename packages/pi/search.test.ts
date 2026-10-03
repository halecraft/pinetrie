// The search tools' plans and words, decided without rg or fd.

import { execFileSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import {
  findArgs,
  grepArgs,
  type SearchOutcome,
  searchOutcome,
  searchText,
  shellCommand,
} from "./search.ts"

describe("grepArgs", () => {
  test("each option, and the pattern after --", () => {
    const args = grepArgs({
      pattern: "-x",
      path: "src",
      glob: "*.ts",
      ignoreCase: true,
      literal: true,
      context: 2,
    })
    expect(args.slice(-9)).toEqual([
      "-i",
      "-F",
      "-g",
      "*.ts",
      "-C",
      "2",
      "--",
      "-x",
      "src",
    ])
  })

  test("no path searches the working directory, so paths have no ./", () => {
    expect(grepArgs({ pattern: "a" }).slice(-2)).toEqual(["--", "a"])
  })
})

describe("findArgs", () => {
  test("a name pattern matches the basename", () => {
    const args = findArgs({ pattern: "*.ts" })
    expect(args).not.toContain("--full-path")
    expect(args.slice(-2)).toEqual(["--", "*.ts"])
  })

  test("a pattern with a / matches the full path, under **", () => {
    expect(findArgs({ pattern: "src/*.ts" }).slice(-3)).toEqual([
      "--full-path",
      "--",
      "**/src/*.ts",
    ])
    expect(findArgs({ pattern: "**/x/*.ts" }).slice(-1)).toEqual(["**/x/*.ts"])
    expect(findArgs({ pattern: "/abs/*.ts" }).slice(-1)).toEqual(["/abs/*.ts"])
  })

  test("asks fd for one result more than the limit", () => {
    const args = findArgs({ pattern: "*", limit: 10 })
    expect(args[args.indexOf("--max-results") + 1]).toBe("11")
  })
})

test("shellCommand: each word reaches the program whole", () => {
  const words = ["it's", "$HOME", "a b", "-x", '"q"']
  const printed = execFileSync(
    "sh",
    ["-c", shellCommand("printf", ["%s\\n", ...words])],
    { encoding: "utf8" },
  )
  expect(printed).toBe(`${words.join("\n")}\n`)
})

describe("searchOutcome", () => {
  const ran = (exit: number, text = "") =>
    ({ ok: true, exit, text, cut: null }) as const

  test("rg: 0 is found, 1 is none, 2 is a failure with its message", () => {
    expect(searchOutcome("grep", ran(0, "a:1: x\n"))).toEqual({
      kind: "found",
      text: "a:1: x",
      cut: null,
    })
    expect(searchOutcome("grep", ran(1))).toEqual({ kind: "none" })
    expect(searchOutcome("grep", ran(2, "rg: regex parse error"))).toEqual({
      kind: "failed",
      text: "rg: regex parse error",
    })
  })

  test("fd: 0 with no output is none, 1 is a failure", () => {
    expect(searchOutcome("find", ran(0, "a.ts\n")).kind).toBe("found")
    expect(searchOutcome("find", ran(0))).toEqual({ kind: "none" })
    expect(searchOutcome("find", ran(1))).toEqual({
      kind: "failed",
      text: "fd exited with code 1",
    })
  })

  test("an exec that did not finish is stopped, never found", () => {
    for (const [code, why] of [
      ["aborted", "aborted"],
      ["timeout", "timeout"],
      ["spawn_error", "error"],
      ["shell_unavailable", "error"],
      ["unknown", "error"],
    ] as const)
      expect(searchOutcome("grep", { ok: false, code, message: "m" })).toEqual({
        kind: "stopped",
        why,
        message: "m",
      })
  })

  test("the cut is the capture's", () => {
    expect(
      searchOutcome("find", { ok: true, exit: 0, text: "a\n", cut: "lines" }),
    ).toEqual({ kind: "found", text: "a", cut: "lines" })
  })
})

describe("searchText", () => {
  const found = (cut: "lines" | "bytes" | null): SearchOutcome => ({
    kind: "found",
    text: "a:1: x",
    cut,
  })

  test("a cut says which limit, and how to see more", () => {
    expect(searchText("grep", found(null), 200)).toEqual({
      ok: true,
      text: "a:1: x",
    })
    expect(searchText("grep", found("lines"), 200).text).toContain(
      "[limit of 200 lines reached: narrow the pattern or raise limit]",
    )
    expect(searchText("find", found("lines"), 5).text).toContain(
      "[limit of 5 results reached",
    )
    expect(searchText("grep", found("bytes"), 200).text).toContain(
      "[output cut at 50.0KB: narrow the pattern]",
    )
  })

  test("nothing found is an answer; the rest are errors", () => {
    expect(searchText("grep", { kind: "none" }, 1)).toEqual({
      ok: true,
      text: "No matches found",
    })
    expect(searchText("find", { kind: "none" }, 1).text).toBe("No files found")
    expect(searchText("grep", { kind: "failed", text: "bad" }, 1)).toEqual({
      ok: false,
      text: "bad",
    })
    expect(
      searchText("grep", { kind: "unavailable", program: "rg" }, 1),
    ).toEqual({
      ok: false,
      text: "rg is not available on this host and could not be fetched; search with bash.",
    })
    expect(
      searchText("find", { kind: "stopped", why: "aborted", message: "x" }, 1),
    ).toEqual({ ok: false, text: "Search aborted" })
    expect(
      searchText("find", { kind: "stopped", why: "error", message: "no sh" }, 1)
        .text,
    ).toBe("no sh")
  })
})
