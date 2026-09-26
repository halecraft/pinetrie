import { describe, expect, test } from "vitest"
import {
  admits,
  DEFAULT_BIND,
  isLoopback,
  KEY_COOKIE,
  urlHost,
} from "./admission.ts"

describe("admission: an invite key off loopback", () => {
  test("loopback is 127.0.0.0/8 and ::1; the default bind is loopback", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1"])
      expect(isLoopback(a)).toBe(true)
    for (const a of ["0.0.0.0", "::", "192.168.1.20", "128.0.0.1"])
      expect(isLoopback(a)).toBe(false)
    expect(isLoopback(DEFAULT_BIND)).toBe(true)
  })

  test("with no key, everything is admitted", () => {
    expect(admits({ url: "/src/app.tsx" }, null)).toEqual({ kind: "admit" })
  })

  test("a page with the right ?key= is admitted, then sent to the URL without it", () => {
    expect(admits({ url: "/?key=s3cret&x=1" }, "s3cret")).toEqual({
      kind: "admitAndForget",
      location: "/?x=1",
    })
  })

  test("the cookie a link sets admits the page's own requests", () => {
    const cookie = `other=1; ${KEY_COOKIE}=s3cret`
    expect(admits({ url: "/src/app.tsx", cookie }, "s3cret")).toEqual({
      kind: "admit",
    })
  })

  test("a wrong, empty or missing key is refused", () => {
    const refused = { kind: "refuse" }
    expect(admits({ url: "/?key=nope" }, "s3cret")).toEqual(refused)
    expect(admits({ url: "/?key=" }, "s3cret")).toEqual(refused)
    expect(admits({ url: "/ws" }, "s3cret")).toEqual(refused)
    expect(
      admits({ url: "/", cookie: `${KEY_COOKIE}=s3cre` }, "s3cret"),
    ).toEqual(refused)
  })

  test("urlHost writes a bound address as this machine can open it", () => {
    expect(urlHost("0.0.0.0")).toBe("127.0.0.1")
    expect(urlHost("::")).toBe("[::1]")
    expect(urlHost("192.168.1.20")).toBe("192.168.1.20")
  })
})
