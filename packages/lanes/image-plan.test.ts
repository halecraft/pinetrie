import { RUNTIME_BASH } from "@pinetrie/core"
import { expect, test } from "vitest"
import { imageRefusal, planImages } from "./image-plan.ts"

test("planImages: pinetrie's image is pinned to the app's Playwright, a project's is not", () => {
  const input = {
    pinetrie: {
      file: "/pinetrie/Containerfile",
      content: "FROM node",
      sources: ["int main"],
    },
    project: {
      file: "/p/pinetrie.Containerfile",
      content: "FROM alpine",
      sources: [],
    },
    jjVersion: "0.44.0",
    playwrightVersion: "1.56.0",
  }
  const plans = planImages(input)
  const bumped = planImages({ ...input, playwrightVersion: "1.57.0" })
  expect(plans.pinetrie.buildArgs).toEqual([
    "JJ_VERSION=0.44.0",
    "PLAYWRIGHT_VERSION=1.56.0",
    `BASH_VERSION=${RUNTIME_BASH.version}`,
    `BASH_PATCHES=${RUNTIME_BASH.patches}`,
  ])
  expect(bumped.pinetrie.tag).not.toBe(plans.pinetrie.tag)
  expect(plans.project?.buildArgs).toEqual(["JJ_VERSION=0.44.0"])
  expect(bumped.project?.tag).toBe(plans.project?.tag)
  expect(planImages({ ...input, project: null }).project).toBeNull()
})

test("planImages: a change to a file the build copies in is a new image", () => {
  const input = {
    pinetrie: {
      file: "/pinetrie/Containerfile",
      content: "FROM node",
      sources: ["a"],
    },
    project: null,
    jjVersion: "0.44.0",
    playwrightVersion: "1.56.0",
  }
  const changed = { ...input, pinetrie: { ...input.pinetrie, sources: ["b"] } }
  expect(planImages(changed).pinetrie.tag).not.toBe(
    planImages(input).pinetrie.tag,
  )
})

test("imageRefusal: git 2.41 or later, named when missing or old", () => {
  expect(imageRefusal("git version 2.49.1\n")).toBeNull()
  expect(imageRefusal("git version 3.0.0")).toBeNull()
  expect(imageRefusal("git version 2.40.9")).toContain("git 2.40")
  expect(imageRefusal("")).toContain("has no git")
})
