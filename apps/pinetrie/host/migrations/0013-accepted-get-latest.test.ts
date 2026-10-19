import { expect, test } from "vitest"
import { acceptedGetLatest } from "./0013-accepted-get-latest.ts"

const WORKING_COPY = {
  behind: 1,
  ahead: 0,
  conflicts: { commits: 0, files: [] },
}

test("accepted work's working copy names what getting the latest would do by its new name", () => {
  const preview = { changes: 2, conflicts: [], heads: 0 }
  expect(
    acceptedGetLatest({
      commit: "c",
      workingCopy: { ...WORKING_COPY, catchUp: preview },
    }),
  ).toEqual({
    commit: "c",
    workingCopy: { ...WORKING_COPY, getLatest: preview },
  })
})

test("a record already renamed, or a folder's with no working copy, needs nothing", () => {
  expect(
    acceptedGetLatest({ workingCopy: { ...WORKING_COPY, getLatest: null } }),
  ).toBeNull()
  expect(acceptedGetLatest({ kind: "folder", kept: [] })).toBeNull()
})
