import { describe, expect, test } from "vitest"
import { identityCodec, nameOnJoin, parseIdentity } from "./identity.ts"

describe("identity (ADR-0037)", () => {
  test("the form's input is normalized, or names the field that is not usable", () => {
    expect(parseIdentity(" Ada@X.io ", " Ada ")).toEqual({
      ok: true,
      identity: { email: "ada@x.io", name: "Ada" },
    })
    expect(parseIdentity("ada", "Ada")).toEqual({ ok: false, problem: "email" })
    expect(parseIdentity("ada@x.io", "  ")).toEqual({
      ok: false,
      problem: "name",
    })
    expect(parseIdentity("ada@x.io", "agent")).toEqual({
      ok: false,
      problem: "name",
    })
  })

  test("the stored form decodes whole, or not at all", () => {
    const ada = { email: "ada@x.io", name: "Ada" }
    expect(identityCodec.decode(identityCodec.encode(ada))).toEqual(ada)
    for (const raw of [
      undefined,
      { email: "ada@x.io", name: "Ada" },
      { v: 2, email: "ada@x.io", name: "Ada" },
      { v: 1, email: "ada", name: "Ada" },
      { v: 1, email: "ada@x.io" },
    ])
      expect(identityCodec.decode(raw)).toBeUndefined()
  })

  test("the stored name is sent only to a session that has none", () => {
    const ada = { email: "ada@x.io", name: "Ada" }
    expect(nameOnJoin(ada, undefined)).toBe("Ada")
    expect(nameOnJoin(ada, "Ada Lovelace")).toBeNull()
  })
})
