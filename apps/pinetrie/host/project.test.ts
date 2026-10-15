import type { ProjectDir } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { startJjProject } from "./jj/index.ts"
import { projectAdapter } from "./project.ts"

test("each project gets its kind's adapter; a folder lanes cannot serve is refused", () => {
  const folder = projectAdapter({ kind: "folder", root: "/p" })
  expect("adapter" in folder ? folder.adapter.kind : folder).toBe("folder")
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
