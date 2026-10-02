import { atEntry, entryId, laneNameForThread, writerId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import { composerPlace } from "./column-view.ts"
import {
  composerPlacesStore,
  dropProps,
  type PutTarget,
  placeOfTarget,
  targetOfElement,
} from "./put-target.ts"

const ME = writerId("ada@x.io")
/** An element carrying `attrs`, as the page spreads them. */
const marked = (attrs: Readonly<Record<string, string>>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
})
const LANE = laneNameForThread("x")
const E1 = atEntry(entryId("e-1"))

describe("one landing rule (ADR-0048: every input has full fidelity)", () => {
  const store = composerPlacesStore()
  const thread = composerPlace({ key: "k-thread", lane: LANE }, E1)
  const fresh = composerPlace({ key: "k-fresh", fresh: {} }, E1)
  store.set("k-thread", thread)
  store.set("k-fresh", fresh)
  const targets: PutTarget[] = [
    { kind: "column", key: "k-thread" },
    { kind: "column", key: "k-fresh" },
    { kind: "inventory", slot: 0 },
    { kind: "inventory", slot: 17 },
    { kind: "column", key: "k-closed" },
  ]

  test.each(targets)("a drop on %o lands where a put to it lands", target => {
    const dropped = targetOfElement(marked(dropProps(target)))
    expect(dropped).toEqual(target)
    expect(
      dropped === null ? null : placeOfTarget(dropped, store.current(), ME),
    ).toEqual(placeOfTarget(target, store.current(), ME))
  })

  test("a column lands as its composer place; a slot as your inventory; a column no store holds as nothing", () => {
    const at = (t: PutTarget) => placeOfTarget(t, store.current(), ME)
    expect(at(targets[0] as PutTarget)).toEqual({
      kind: "drafting",
      at: E1,
      lane: LANE,
    })
    expect(at(targets[1] as PutTarget)).toEqual({
      kind: "fresh",
      column: "k-fresh",
    })
    expect(at(targets[2] as PutTarget)).toEqual({
      kind: "inventory",
      holder: ME,
    })
    expect(at(targets[4] as PutTarget)).toBeNull()
  })

  test("an element with no mark, or a slot that is no number, is no target", () => {
    expect(targetOfElement(marked({}))).toBeNull()
    expect(targetOfElement(marked({ "data-put-slot": "x" }))).toBeNull()
  })
})

test("composerPlace: drafting at the end with the lane; fresh by key; none at the root", () => {
  expect(composerPlace({ key: "k", lane: LANE }, E1)).toEqual({
    kind: "drafting",
    at: E1,
    lane: LANE,
  })
  expect(composerPlace({ key: "k" }, E1)).toEqual({
    kind: "drafting",
    at: E1,
    lane: null,
  })
  expect(composerPlace({ key: "k", fresh: {} }, { kind: "root" })).toEqual({
    kind: "fresh",
    column: "k",
  })
  expect(composerPlace({ key: "k" }, { kind: "root" })).toBeNull()
})
