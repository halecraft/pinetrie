import { describe, expect, test } from "vitest"
import {
  admits,
  DEFAULT_BIND,
  isLoopback,
  isLoopbackHost,
  KEY_COOKIE,
  requestFacts,
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

  test("with no key, everything from this machine's names is admitted", () => {
    for (const host of [
      "127.0.0.1:5173",
      "localhost:5173",
      "[::1]:5173",
      "127.1.2.3",
    ])
      expect(admits({ url: "/src/app.tsx", host }, null)).toEqual({
        kind: "admit",
      })
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
    // A Host of this machine's own, so only the key can refuse them.
    const host = "127.0.0.1:5173"
    expect(admits({ url: "/?key=nope", host }, "s3cret")).toEqual(refused)
    expect(admits({ url: "/?key=", host }, "s3cret")).toEqual(refused)
    expect(admits({ url: "/ws", host }, "s3cret")).toEqual(refused)
    expect(
      admits({ url: "/", cookie: `${KEY_COOKIE}=s3cre`, host }, "s3cret"),
    ).toEqual(refused)
  })

  test("with no key, a Host that is not this machine's name is refused: a rebound name", () => {
    for (const host of [
      "evil.example:5173",
      "192.168.1.20:5173",
      "",
      undefined,
    ])
      expect(admits({ url: "/ws", host }, null)).toEqual({ kind: "refuse" })
    expect(isLoopbackHost("evil.example")).toBe(false)
    expect(isLoopbackHost("LOCALHOST:1")).toBe(true)
  })

  test("an Origin naming another host is refused, key or no key", () => {
    const refused = { kind: "refuse" }
    const host = "127.0.0.1:5173"
    for (const origin of [
      "https://evil.example",
      "http://127.0.0.1:9999",
      "null",
      "not a url",
    ])
      expect(admits({ url: "/ws", host, origin }, null)).toEqual(refused)
    const cookie = `${KEY_COOKIE}=s3cret`
    expect(
      admits(
        {
          url: "/ws",
          cookie,
          host: "10.0.0.2:5173",
          origin: "https://evil.example",
        },
        "s3cret",
      ),
    ).toEqual(refused)
  })

  test("an Origin naming the host itself, or none, is judged by the key", () => {
    const admit = { kind: "admit" }
    expect(
      admits(
        { url: "/ws", host: "localhost:5173", origin: "http://localhost:5173" },
        null,
      ),
    ).toEqual(admit)
    const cookie = `${KEY_COOKIE}=s3cret`
    expect(
      admits(
        {
          url: "/blob",
          cookie,
          host: "10.0.0.2:5173",
          origin: "http://10.0.0.2:5173",
        },
        "s3cret",
      ),
    ).toEqual(admit)
    // Off loopback the Host may be any name: the key decides.
    expect(
      admits({ url: "/ws", cookie, host: "pineta.example" }, "s3cret"),
    ).toEqual(admit)
    expect(admits({ url: "/ws", host: "pineta.example" }, "s3cret")).toEqual({
      kind: "refuse",
    })
  })

  test("requestFacts reads the url and the three headers", () => {
    expect(
      requestFacts({
        url: "/ws?x=1",
        headers: { cookie: "a=1", origin: "http://h:1", host: "h:1" },
      }),
    ).toEqual({
      url: "/ws?x=1",
      cookie: "a=1",
      origin: "http://h:1",
      host: "h:1",
    })
    expect(requestFacts({ headers: {} }).url).toBe("/")
  })

  test("urlHost writes a bound address as this machine can open it", () => {
    expect(urlHost("0.0.0.0")).toBe("127.0.0.1")
    expect(urlHost("::")).toBe("[::1]")
    expect(urlHost("192.168.1.20")).toBe("192.168.1.20")
  })
})
