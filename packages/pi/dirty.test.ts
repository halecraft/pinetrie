// Which of pi's indexes a replayed change invalidates (`dirtyFrom`).
import { describe, expect, test } from "vitest"
import { dirtyFrom } from "./storage.ts"

/** A path, as Kyneta's segments present one: each answers `coord()`. */
const at = (...keys: string[]) =>
  keys.map(key => ({ coord: () => key }) as never)
const map = (set?: Record<string, unknown>, del?: string[]) => ({
  type: "map",
  ...(set === undefined ? {} : { set }),
  ...(del === undefined ? {} : { delete: del }),
})

describe("dirtyFrom: only pi's fields are re-indexed", () => {
  test("a field pi does not own is ignored, whatever it is called", () => {
    for (const field of [
      "streams",
      "streamText",
      "activeRuns",
      "checkpointText",
      "addedLater",
    ])
      expect(dirtyFrom(at(field), map({ x: 1 }))).toEqual({ kind: "none" })
  })
  test("a change with no field replaces the document: everything", () => {
    expect(dirtyFrom([], {})).toEqual({ kind: "all" })
  })
  test("pi's fields are re-indexed by the keys a map change names", () => {
    expect(dirtyFrom(at("entries"), map({ e1: {} }))).toEqual({
      kind: "entries",
      keys: ["e1"],
    })
    expect(dirtyFrom(at("entries"), map(undefined, ["e1"]))).toEqual({
      kind: "entries",
      keys: "all",
    })
    expect(dirtyFrom(at("values"), map({ v1: 1 }, ["v2"]))).toEqual({
      kind: "values",
      keys: ["v1", "v2"],
    })
    expect(dirtyFrom(at("lists", "l1"), {})).toEqual({
      kind: "lists",
      keys: ["l1"],
    })
    expect(dirtyFrom(at("values"), { type: "replace" })).toEqual({
      kind: "values",
      keys: "all",
    })
    expect(dirtyFrom(at("usageRows"), {})).toEqual({ kind: "usage" })
  })
})
