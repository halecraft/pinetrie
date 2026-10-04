import type { Sha256 } from "@pineta/core"
import { commitId } from "@pineta/core"
import { diffUrl, reviewUrl } from "@pineta/rules"
import { describe, expect, test } from "vitest"
import { KEY_COOKIE, type RequestFacts } from "./admission.ts"
import { planRequest, planUpgrade, route } from "./routes.ts"

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
  const revision = { kind: "revision", commit: c } as const
  const range = { kind: "range", from: c, to: commitId("4567ef") } as const
  expect(at("GET", reviewUrl(revision))).toEqual({
    kind: "offer",
    ask: { kind: "review", span: revision },
  })
  expect(at("GET", diffUrl(range, "a b.txt"))).toEqual({
    kind: "offer",
    ask: { kind: "diff", span: range, path: "a b.txt" },
  })
  expect(at("POST", reviewUrl(revision))).toEqual({ kind: "bad" })
  expect(at("GET", "/offer/anything")).toEqual({ kind: "bad" })
  expect(at("GET", "/offer/2/review/0123..xyz")).toEqual({ kind: "bad" })
  expect(at("GET", "/offer/1/review/0123abcd")).toEqual({ kind: "bad" })
})

describe("planRequest and planUpgrade: admission first", () => {
  const KEY = "k3y"
  const HOST = "192.168.1.5:7391"
  const facts = (
    url: string,
    extra: Partial<RequestFacts> = {},
  ): RequestFacts => ({
    url,
    host: HOST,
    ...extra,
  })
  const withCookie = (url: string) =>
    facts(url, { cookie: `${KEY_COOKIE}=${KEY}` })

  test("with a key, a request without it is refused, whatever it asks for: a page, a blob, an upload, an offer's read", () => {
    const c = commitId("0123abcd")
    for (const [method, url] of [
      ["GET", "/"],
      ["GET", `/blob/${SHA}`],
      ["POST", "/blob"],
      ["GET", reviewUrl({ kind: "revision", commit: c })],
    ] as const)
      expect(planRequest(facts(url), KEY, method)).toEqual({ kind: "refuse" })
    expect(planRequest(withCookie(`/blob/${SHA}`), KEY, "GET")).toEqual({
      kind: "blob-get",
      sha: SHA,
    })
  })

  test("a request with ?key= is redirected without it; with the cookie, it is routed", () => {
    expect(planRequest(facts(`/?key=${KEY}&tab=2`), KEY, "GET")).toEqual({
      kind: "redirect",
      location: "/?tab=2",
    })
    expect(planRequest(withCookie("/"), KEY, "GET")).toEqual({ kind: "other" })
  })

  test("with a key, an upgrade without it is refused; with it, /ws is the Exchange's and any other path Vite's", () => {
    expect(planUpgrade(facts("/ws"), KEY)).toBe("refuse")
    expect(planUpgrade(withCookie("/ws"), KEY)).toBe("exchange")
    expect(planUpgrade(withCookie("/__vite_hmr"), KEY)).toBe("vite")
  })

  test("on loopback, an upgrade from another origin is refused, and from the page's own is the Exchange's", () => {
    const loopback = (origin: string) =>
      facts("/ws", { host: "127.0.0.1:7391", origin })
    expect(planUpgrade(loopback("http://evil.example"), null)).toBe("refuse")
    expect(planUpgrade(loopback("http://127.0.0.1:7391"), null)).toBe(
      "exchange",
    )
  })
})
