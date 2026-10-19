import { expect, test } from "vitest"
import {
  planInvocation,
  planTidyInvocation,
  refusalText,
  storeChoice,
} from "./invocation.ts"

test("no folder serves the base; one folder is read from the base, never the working directory", () => {
  expect(planInvocation([], "/elsewhere")).toEqual({
    kind: "start",
    folder: "/elsewhere",
  })
  expect(planInvocation(["/p/app"], "/elsewhere")).toEqual({
    kind: "start",
    folder: "/p/app",
  })
  expect(planInvocation(["../app"], "/src/pinetrie")).toEqual({
    kind: "start",
    folder: "/src/app",
  })
})

test("a flag, or a second folder, is refused", () => {
  expect(planInvocation(["--port", "1"], "/b")).toEqual({
    kind: "refused",
    refusal: { kind: "flag", arg: "--port" },
  })
  expect(planInvocation(["/a", "/b"], "/b")).toEqual({
    kind: "refused",
    refusal: { kind: "extra", args: ["/a", "/b"] },
  })
  expect(refusalText({ kind: "extra", args: ["/a", "/b"] }, "dev")).toContain(
    "usage: pnpm dev [folder]",
  )
  expect(refusalText({ kind: "flag", arg: "--port" }, "serve")).toContain(
    "usage: pinetrie serve [folder]",
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
  expect(planTidyInvocation([], "/elsewhere")).toEqual({
    kind: "tidy",
    folder: "/elsewhere",
    days: 7,
    dryRun: false,
  })
  expect(
    planTidyInvocation(
      ["../app", "--days", "3", "--dry-run"],
      "/src/pinetrie",
    ),
  ).toEqual({ kind: "tidy", folder: "/src/app", days: 3, dryRun: true })
  expect(planTidyInvocation(["--days", "0"], "/b").kind).toBe(
    "refused",
  )
  expect(planTidyInvocation(["--days"], "/b").kind).toBe("refused")
  expect(planTidyInvocation(["--now"], "/b").kind).toBe("refused")
  expect(planTidyInvocation(["/a", "/b"], "/b").kind).toBe("refused")
})
