import { WORKFLOW } from "@pinetrie/rules"
import { expect, test } from "vitest"
import { workflowMarksNow } from "./0028-workflow-marks.ts"

const state = (id: string, name: string) => ({ id: `w-${id}`, name })
const archive = state("x", "Archive")

/** The marks a migrated workflow decodes with, as a start reads it. */
const decodedMarks = (contents: object | null) => {
  const w =
    contents === null ? undefined : WORKFLOW.decode(contents, "workflow")
  return w === undefined ? undefined : [w.topics.name, w.active?.name ?? null]
}

test("marks the states named Topics and Active", () => {
  const stored = {
    open: [state("n", "Next"), state("t", "Topics"), state("a", "Active")],
    archive,
  }
  expect(WORKFLOW.decode(stored, "workflow")).toBeUndefined()
  expect(decodedMarks(workflowMarksNow(stored))).toEqual(["Topics", "Active"])
})

test("falls back to the first open state and no Active", () => {
  expect(
    decodedMarks(
      workflowMarksNow({
        open: [state("b", "Backlog"), state("d", "Doing")],
        archive,
      }),
    ),
  ).toEqual(["Backlog", null])
})

test("a marked workflow is left alone", () => {
  expect(
    workflowMarksNow({
      open: [{ ...state("t", "Topics"), mark: "topics" }, state("a", "Active")],
      archive,
    }),
  ).toBeNull()
})
