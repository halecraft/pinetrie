import type { ProjectRecord } from "@pinetrie/core"
import { expect, test } from "vitest"
import { projectOf } from "./runtime.ts"

test("projectOf keeps a project's own copies, and turns its default direct only with PINETRIE_LANES=0", () => {
  const lanes: ProjectRecord = {
    kind: "lanes",
    root: "/repo",
    rootDefault: "own",
  }
  const direct: ProjectRecord = {
    kind: "direct",
    root: "/repo",
    reason: "no container",
  }
  expect(projectOf({ project: lanes }, true)).toEqual({
    ...lanes,
    rootDefault: "direct",
  })
  expect(projectOf({ project: lanes }, false)).toEqual(lanes)
  expect(projectOf({ project: direct }, true)).toEqual(direct)
  expect(projectOf({ project: direct }, false)).toEqual(direct)
  expect(projectOf(null, true)).toBe(null)
})
