// Which of pi's indexes a replayed change invalidates (`dirtyFrom`), and how
// one changeset's changes fold into a scope (`scopeOf`, `join`).
import { describe, expect, test } from "vitest"
import {
  CLEAN,
  dirtyFrom,
  EVERYTHING,
  isClean,
  join,
  type Scope,
  scopeOf,
} from "./dirty.ts"

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
    for (const field of ["checkpointText", "addedLater"])
      expect(dirtyFrom(at(field), map({ x: 1 }))).toEqual({ kind: "none" })
  })
  test("a change with no field replaces the document: everything", () => {
    expect(dirtyFrom([], {})).toEqual({ kind: "all" })
  })
  test("pi's fields are re-indexed by the keys a map change names", () => {
    expect(dirtyFrom(at("entries"), map({ e1: {} }))).toEqual({
      kind: "field",
      field: "entries",
      keys: ["e1"],
    })
    expect(dirtyFrom(at("entries"), map(undefined, ["e1"]))).toEqual({
      kind: "field",
      field: "entries",
      keys: "all",
    })
    expect(dirtyFrom(at("values"), map({ v1: 1 }, ["v2"]))).toEqual({
      kind: "field",
      field: "values",
      keys: ["v1", "v2"],
    })
    expect(dirtyFrom(at("lists", "l1"), {})).toEqual({
      kind: "field",
      field: "lists",
      keys: ["l1"],
    })
    expect(dirtyFrom(at("values"), { type: "replace" })).toEqual({
      kind: "field",
      field: "values",
      keys: "all",
    })
  })
  test("a usage row set is re-indexed by its key; a change setting none, all of them", () => {
    expect(dirtyFrom(at("usageRows"), map({ u1: {} }))).toEqual({
      kind: "field",
      field: "usageRows",
      keys: ["u1"],
    })
    expect(dirtyFrom(at("usageRows"), map(undefined, ["u1"]))).toEqual({
      kind: "field",
      field: "usageRows",
      keys: "all",
    })
  })
})

describe("scopeOf and join", () => {
  const change = (field: string, set: Record<string, unknown>) => ({
    path: { segments: at(field) },
    change: map(set),
  })
  const keys = (scope: Scope) =>
    Object.fromEntries(
      Object.entries(scope).map(([f, k]) => [
        f,
        k === "all" ? k : [...k].sort(),
      ]),
    )

  test("a changeset's keys are united per field; a whole-document change is everything", () => {
    expect(
      keys(
        scopeOf([
          change("entries", { b: 1 }),
          change("entries", { a: 1 }),
          change("streams", { s: 1 }),
        ]),
      ),
    ).toEqual({ entries: ["a", "b"], usageRows: [], values: [], lists: [] })
    expect(scopeOf([change("values", { v: 1 }), { change: {} }])).toBe(
      EVERYTHING,
    )
  })

  test("join unites keys; all absorbs keys on either side; CLEAN changes nothing", () => {
    const some = scopeOf([change("values", { v1: 1 })])
    const more = scopeOf([change("values", { v2: 1 })])
    expect(keys(join(some, more)).values).toEqual(["v1", "v2"])
    expect(join(some, EVERYTHING).values).toBe("all")
    expect(join(EVERYTHING, some).values).toBe("all")
    expect(keys(join(CLEAN, some))).toEqual(keys(some))
    expect(isClean(CLEAN)).toBe(true)
    expect(isClean(some)).toBe(false)
  })
})
