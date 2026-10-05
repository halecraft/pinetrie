import { expect, test } from "vitest"
import { planInvocation, refusalText, storeFile } from "./invocation.ts"

const PINETA = "/src/pineta"

test("no folder serves Pineta's repo; one folder is read from the base, never the working directory", () => {
  expect(planInvocation([], "/elsewhere", PINETA)).toEqual({
    kind: "start",
    folder: PINETA,
  })
  expect(planInvocation(["/p/app"], "/elsewhere", PINETA)).toEqual({
    kind: "start",
    folder: "/p/app",
  })
  expect(planInvocation(["../app"], "/src/pineta", PINETA)).toEqual({
    kind: "start",
    folder: "/src/app",
  })
})

test("a flag, or a second folder, is refused", () => {
  expect(planInvocation(["--port", "1"], "/b", PINETA)).toEqual({
    kind: "refused",
    refusal: { kind: "flag", arg: "--port" },
  })
  expect(planInvocation(["/a", "/b"], "/b", PINETA)).toEqual({
    kind: "refused",
    refusal: { kind: "extra", args: ["/a", "/b"] },
  })
  expect(refusalText({ kind: "extra", args: ["/a", "/b"] })).toContain(
    "usage: pnpm host [folder]",
  )
})

test("the store is PINETA_STORE when set, else .pineta/pineta.db in the project's root", () => {
  expect(storeFile("/p", {})).toBe("/p/.pineta/pineta.db")
  expect(storeFile("/p", { PINETA_STORE: "/tmp/s.db" })).toBe("/tmp/s.db")
})
