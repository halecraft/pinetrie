import { expect, test } from "vitest"
import {
  planInvocation,
  planTidyInvocation,
  refusalText,
  storeChoice,
} from "./invocation.ts"

const PINETRIE = "/src/pinetrie"

test("no folder serves pinetrie's repo; one folder is read from the base, never the working directory", () => {
  expect(planInvocation([], "/elsewhere", PINETRIE)).toEqual({
    kind: "start",
    folder: PINETRIE,
  })
  expect(planInvocation(["/p/app"], "/elsewhere", PINETRIE)).toEqual({
    kind: "start",
    folder: "/p/app",
  })
  expect(planInvocation(["../app"], "/src/pinetrie", PINETRIE)).toEqual({
    kind: "start",
    folder: "/src/app",
  })
})

test("a flag, or a second folder, is refused", () => {
  expect(planInvocation(["--port", "1"], "/b", PINETRIE)).toEqual({
    kind: "refused",
    refusal: { kind: "flag", arg: "--port" },
  })
  expect(planInvocation(["/a", "/b"], "/b", PINETRIE)).toEqual({
    kind: "refused",
    refusal: { kind: "extra", args: ["/a", "/b"] },
  })
  expect(refusalText({ kind: "extra", args: ["/a", "/b"] }, "dev")).toContain(
    "usage: pnpm dev [folder]",
  )
  expect(refusalText({ kind: "flag", arg: "--port" }, "serve")).toContain(
    "usage: pnpm serve [folder]",
  )
})

test("the store is PINETRIE_STORE when set, else the session's own", () => {
  expect(storeChoice("/d/sessions/p/pinetrie.db", {})).toEqual({
    file: "/d/sessions/p/pinetrie.db",
    from: "session",
  })
  expect(
    storeChoice("/d/sessions/p/pinetrie.db", { PINETRIE_STORE: "/tmp/s.db" }),
  ).toEqual({
    file: "/tmp/s.db",
    from: "PINETRIE_STORE",
  })
})

test("pnpm tidy's arguments: a folder as the host reads one, a window, a dry run; anything else refused", () => {
  expect(planTidyInvocation([], "/elsewhere", PINETRIE)).toEqual({
    kind: "tidy",
    folder: PINETRIE,
    days: 7,
    dryRun: false,
  })
  expect(
    planTidyInvocation(
      ["../app", "--days", "3", "--dry-run"],
      "/src/pinetrie",
      PINETRIE,
    ),
  ).toEqual({ kind: "tidy", folder: "/src/app", days: 3, dryRun: true })
  expect(planTidyInvocation(["--days", "0"], "/b", PINETRIE).kind).toBe(
    "refused",
  )
  expect(planTidyInvocation(["--days"], "/b", PINETRIE).kind).toBe("refused")
  expect(planTidyInvocation(["--now"], "/b", PINETRIE).kind).toBe("refused")
  expect(planTidyInvocation(["/a", "/b"], "/b", PINETRIE).kind).toBe("refused")
})
