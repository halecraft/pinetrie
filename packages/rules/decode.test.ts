import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Type } from "typebox"
import { expect, test, vi } from "vitest"
import { isWellFormed } from "./decode.ts"

const compiled = vi.hoisted(() => ({ count: 0 }))
vi.mock("typebox/compile", async original => {
  const actual = await original<typeof import("typebox/compile")>()
  return {
    ...actual,
    Compile: (...args: Parameters<typeof actual.Compile>) => {
      compiled.count += 1
      return actual.Compile(...args)
    },
  }
})

test("a schema is compiled once, however often it checks", () => {
  const schema = Type.Object({ n: Type.Integer() })
  const before = compiled.count
  expect(isWellFormed(schema, { n: 1 })).toBe(true)
  expect(isWellFormed(schema, { n: 1.5 })).toBe(false)
  expect(isWellFormed(schema, "n")).toBe(false)
  expect(compiled.count - before).toBe(1)
})

test("no decode builds its schema inline, which would compile it at every call", () => {
  const dir = import.meta.dirname
  const inline = /\b(recordDecoder|decodeWith|isWellFormed)\(\s*Type\./
  const found = readdirSync(dir)
    .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter(f => inline.test(readFileSync(path.join(dir, f), "utf8")))
  expect(found).toEqual([])
})
