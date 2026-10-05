import { entryId, rootIdFor, workflowStateIdFor } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  encodeRootDrag,
  parseRootDrag,
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
      planRootDrop(drag, { kind: "state", state: DONE, before: null }, DONE),
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
      planRootDrop(drag, { kind: "list", before: entryId("2-r") }, DONE),
    ).toEqual({ kind: "moveInList", root: "1-r", before: "2-r" })
  })

  test("a root dropped before itself does nothing", () => {
    expect(
      planRootDrop(drag, { kind: "list", before: entryId("1-r") }, DONE),
    ).toBeNull()
    expect(
      planRootDrop(drag, { kind: "state", state: DOING, before: R1 }, DONE),
    ).toBeNull()
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
