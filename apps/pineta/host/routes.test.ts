import type { Sha256 } from "@pineta/core"
import { commitId } from "@pineta/core"
import { diffUrl, reviewUrl } from "@pineta/marginalia"
import { expect, test } from "vitest"
import { route } from "./routes.ts"

const SHA = "a".repeat(64) as Sha256
const at = (method: string, path: string) =>
  route(method, new URL(path, "http://host"))

test("a blob's GET, with its hash or null; the upload's POST; else Vite", () => {
  expect(at("GET", `/blob/${SHA}`)).toEqual({ kind: "blob-get", sha: SHA })
  expect(at("GET", "/blob/nope")).toEqual({ kind: "blob-get", sha: null })
  expect(at("POST", "/blob")).toEqual({ kind: "blob-post" })
  expect(at("GET", "/blob")).toEqual({ kind: "other" })
  expect(at("POST", `/blob/${SHA}`)).toEqual({ kind: "other" })
  expect(at("GET", "/src/app.tsx")).toEqual({ kind: "other" })
  expect(at("GET", "/")).toEqual({ kind: "other" })
})

test("an offer's read is a GET the wire accepts; anything else under /offer/ is bad", () => {
  const c = commitId("0123abcd")
  expect(at("GET", reviewUrl(c))).toEqual({
    kind: "offer",
    ask: { kind: "review", commit: c },
  })
  expect(at("GET", diffUrl(c, "a b.txt"))).toEqual({
    kind: "offer",
    ask: { kind: "diff", commit: c, path: "a b.txt" },
  })
  expect(at("POST", reviewUrl(c))).toEqual({ kind: "bad" })
  expect(at("GET", "/offer/anything")).toEqual({ kind: "bad" })
})
