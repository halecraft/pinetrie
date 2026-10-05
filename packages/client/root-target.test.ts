import { entryId, rootIdFor, workflowStateIdFor } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  encodeRootDrag,
  landingIn,
  parseRootDrag,
  placeAfter,
  planRootDrop,
  type RootDrag,
  type RootTarget,
  rootDropProps,
  rootTargetOfElement,
  stepsIn,
} from "./root-target.ts"

const [DOING, DONE] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
const R1 = rootIdFor("01a0ffd2-0000-7000-8000-000000000001")
const R2 = rootIdFor("01a0ffd2-0000-7000-8000-000000000002")
const drag: RootDrag = { root: R1, entry: entryId("1-r"), state: DOING }
const element = (attrs: Readonly<Record<string, string>>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
})

describe("a root's drop lands where a key could move it", () => {
  test.each<[string, RootTarget]>([
    ["a column's end", { kind: "state", state: DONE, before: null }],
    ["before a root in a column", { kind: "state", state: DOING, before: R2 }],
    ["your list's end", { kind: "list", before: null }],
    ["before a root in your list", { kind: "list", before: entryId("2-r") }],
  ])("%s: the attributes read back as the target", (_, target) => {
    expect(rootTargetOfElement(element(rootDropProps(target)))).toEqual(target)
  })

  test("a drop and the keyboard's move give the same intent", () => {
    // Move to ▸ Done, as `boardView` and `openListView` offer it.
    expect(
      planRootDrop(
        drag,
        { kind: "state", state: DONE, before: null },
        DONE,
        null,
      ),
    ).toEqual({
      kind: "moveRoot",
      root: R1,
      from: DOING,
      to: DONE,
      before: null,
      closes: true,
    })
    // Move up, as `openListView` offers it.
    expect(
      planRootDrop(drag, { kind: "list", before: entryId("2-r") }, DONE, null),
    ).toEqual({ kind: "moveInList", root: "1-r", before: "2-r" })
  })

  test("a root dropped before itself does nothing", () => {
    expect(
      planRootDrop(drag, { kind: "list", before: entryId("1-r") }, DONE, null),
    ).toBeNull()
    expect(
      planRootDrop(
        drag,
        { kind: "state", state: DOING, before: R1 },
        DONE,
        null,
      ),
    ).toBeNull()
  })

  test("a root dropped just after itself, where it was dragged from, does nothing", () => {
    const home: RootTarget = { kind: "state", state: DOING, before: R2 }
    expect(planRootDrop(drag, home, DONE, home)).toBeNull()
    expect(
      planRootDrop(
        drag,
        { kind: "state", state: DONE, before: R2 },
        DONE,
        home,
      ),
    ).not.toBeNull()
    const end: RootTarget = { kind: "list", before: null }
    expect(planRootDrop(drag, end, DONE, end)).toBeNull()
    expect(
      planRootDrop(drag, end, DONE, {
        kind: "state",
        state: DOING,
        before: null,
      }),
    ).not.toBeNull()
  })

  test("an element with no mark, or a drag that is no root's, lands nowhere", () => {
    expect(rootTargetOfElement(element({}))).toBeNull()
    expect(parseRootDrag(encodeRootDrag(drag))).toEqual(drag)
    for (const bad of [
      "",
      "{",
      JSON.stringify({ ...drag, root: "x" }),
      JSON.stringify({ ...drag, state: "doing" }),
    ])
      expect(parseRootDrag(bad)).toBeNull()
  })
})

describe("landingIn", () => {
  const items = [
    { zone: "a", mid: 10 },
    { zone: "b", mid: 30 },
  ]

  test("a drop lands before the first item whose centre is below it", () => {
    expect(landingIn(items, "end", 0)).toBe("a")
    expect(landingIn(items, "end", 15)).toBe("b")
    expect(landingIn(items, "end", 29)).toBe("b")
  })

  test("past the last centre, or among no items, a drop lands at the end", () => {
    expect(landingIn(items, "end", 31)).toBe("end")
    expect(landingIn([], "end", 0)).toBe("end")
  })

  test("the gap between two items lands with the item below it", () => {
    // Between a's bottom (20) and b's top (22), the place does not flicker.
    for (const y of [19, 20, 21, 22, 23])
      expect(landingIn(items, "end", y)).toBe("b")
  })
})

describe("placeAfter", () => {
  test("an item's place after it is the next item's, or the end's", () => {
    expect(placeAfter(["a", "b"], "a", "end")).toBe("b")
    expect(placeAfter(["a", "b"], "b", "end")).toBe("end")
  })

  test("an item that is no place, a closed row, is at the end", () => {
    expect(placeAfter(["a", "b"], "z", "end")).toBe("end")
  })
})

describe("stepsIn", () => {
  test("up goes before the one above; down before the one after next, or to the end", () => {
    expect(stepsIn(["a", "b", "c"], "a")).toEqual({
      up: null,
      down: { before: "c" },
    })
    expect(stepsIn(["a", "b", "c"], "b")).toEqual({
      up: { before: "a" },
      down: { before: null },
    })
    expect(stepsIn(["a", "b", "c"], "c")).toEqual({
      up: { before: "b" },
      down: null,
    })
  })

  test("an item not in the order steps nowhere", () => {
    expect(stepsIn(["a"], "z")).toEqual({ up: null, down: null })
  })
})
