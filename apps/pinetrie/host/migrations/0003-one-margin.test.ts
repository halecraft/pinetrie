import {
  asPlaceFields,
  entryId,
  entryMargin,
  placeOfFields,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  marginFieldsNow,
  planMarginEvents,
  planMarginRows,
} from "./0003-one-margin.ts"

const thread = threadIdFor("x")
const old = { kind: "margin", at: "e-1", lane: thread, order: "c", seen: "" }

describe("one margin", () => {
  test("an entry's margin stored by its entry and thread becomes the entry's address, which reads as its place", () => {
    const now = marginFieldsNow(old)
    expect(now).toMatchObject({ at: `e/${thread}/e-1`, lane: "", seen: "" })
    expect(placeOfFields(asPlaceFields(now ?? {}))).toEqual({
      kind: "margin",
      on: entryMargin(thread, entryId("e-1")),
      order: "c",
      seen: "",
    })
  })

  test("a trashed comment's row is rewritten too", () => {
    expect(marginFieldsNow({ ...old, kind: "discarded-margin" })?.at).toBe(
      `e/${thread}/e-1`,
    )
  })

  test("plans nothing over its own output, nor for a place that is no margin", () => {
    const rows = { a: old, b: { ...old, kind: "note" } }
    const once = planMarginRows(rows)
    expect([...once.keys()]).toEqual(["a"])
    expect(planMarginRows(Object.fromEntries(once)).size).toBe(0)
  })

  test("a history's events and a trace's places are rewritten, and no other", () => {
    const history = {
      c: { events: [{ kind: "moved", from: null, to: old, at: 1, by: null }] },
      d: {
        events: [{ kind: "moved", from: null, to: { ...old, kind: "note" } }],
      },
    }
    const writes = planMarginEvents(history, "pinetrie.card-history")
    expect(writes.map(w => w.key)).toEqual(["c"])
    const trace = { t: { from: { ...old, kind: "queued" }, to: old } }
    expect(planMarginEvents(trace, "pinetrie.trace")).toMatchObject([
      { key: "t", value: { to: { at: `e/${thread}/e-1` } } },
    ])
    const rewritten = Object.fromEntries(
      writes.map(w => [w.key, w.kind === "set" ? w.value : null]),
    )
    expect(planMarginEvents(rewritten, "pinetrie.card-history")).toEqual([])
  })
})
