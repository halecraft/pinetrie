import { expect, test } from "vitest"
import { planInvocation, refusalText, storeChoice } from "./invocation.ts"

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

test("the store is PINETRIE_STORE when set, else .pinetrie/pinetrie.db in the project's root", () => {
  expect(storeChoice("/p", {})).toEqual({
    file: "/p/.pinetrie/pinetrie.db",
    from: "project",
  })
  expect(storeChoice("/p", { PINETRIE_STORE: "/tmp/s.db" })).toEqual({
    file: "/tmp/s.db",
    from: "PINETRIE_STORE",
  })
})
