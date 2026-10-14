import type { ProjectDir } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { startJjProject } from "./jj/index.ts"
import { projectAdapter } from "./project.ts"

test("a folder project is refused, with how to make it a jj one; a jj project gets jj's adapter", () => {
  expect(projectAdapter({ kind: "folder", root: "/p" })).toEqual({
    refused:
      "/p has no jj repo: `jj git init --colocate` makes one, and gives its threads' agents their lanes",
  })
  expect(
    projectAdapter({
      kind: "refused",
      refusal: { kind: "missing", dir: "/q" },
    }),
  ).toEqual({ refused: "/q is not a directory" })
  expect("adapter" in projectAdapter({ kind: "jj", root: "/p" })).toBe(true)
})

test("jj's adapter starts only on a jj project", () => {
  const start = (dir: Extract<ProjectDir, { kind: "folder" }>) =>
    // @ts-expect-error: jj's adapter takes a jj project's folder alone
    startJjProject(dir)
  expect(start).toBeTypeOf("function")
})
