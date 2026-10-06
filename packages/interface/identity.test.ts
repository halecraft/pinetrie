import { ERR } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  identityCodec,
  nameHint,
  parseIdentity,
  planRename,
  reconcileName,
  renameProblem,
} from "./identity.ts"
import { failedWords } from "./send.ts"

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

  test("the stored name is sent only to a session that has none, and follows the session's", () => {
    const ada = { email: "ada@x.io", name: "Ada" }
    const rows: [Parameters<typeof reconcileName>, unknown][] = [
      [[undefined, "ada@x.io", "Ada"], null],
      [[ada, "bea@x.io", undefined], null],
      [[ada, "ada@x.io", undefined], { kind: "send", name: "Ada" }],
      [[ada, "ada@x.io", "Ada"], null],
      [
        [ada, "ada@x.io", "Ada Lovelace"],
        {
          kind: "store",
          identity: { email: "ada@x.io", name: "Ada Lovelace" },
        },
      ],
    ]
    for (const [args, step] of rows)
      expect(reconcileName(...args)).toEqual(step)
  })

  test("a rename is refused, unchanged, or sent normalized", () => {
    const rows: [string, string | undefined, unknown][] = [
      ["!!", "Ada", { kind: "refuse" }],
      ["agent", "Ada", { kind: "refuse" }],
      ["a".repeat(41), "Ada", { kind: "refuse" }],
      ["  Ada ", "Ada", { kind: "unchanged" }],
      ["ada", undefined, { kind: "send", name: "ada" }],
      [" Ada Lovelace ", "Ada", { kind: "send", name: "Ada Lovelace" }],
    ]
    for (const [draft, current, plan] of rows)
      expect(planRename(draft, current)).toEqual(plan)
  })

  test("a rename the host refused or failed shows why; one that took shows nothing", () => {
    expect(
      renameProblem({
        kind: "refused",
        code: ERR.INVALID_NAME,
        message: "too long",
      }),
    ).toEqual({ code: ERR.INVALID_NAME, message: "too long" })
    expect(renameProblem({ kind: "failed", message: "store closed" })).toEqual({
      code: "failed",
      message: failedWords("store closed"),
    })
    expect(renameProblem({ kind: "named" })).toBeNull()
  })

  test("the hint is the handle a typed name gives, or none for a refused name", () => {
    expect(nameHint("Ada Lovelace")).toBe("adalovelace")
    expect(nameHint("O'Brien")).toBe("obrien")
    expect(nameHint("agent")).toBeNull()
  })
})
