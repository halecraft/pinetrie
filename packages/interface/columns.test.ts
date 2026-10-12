import { entryId, type LaneView, rootIdFor, threadIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  BOUND,
  type Column,
  keyText,
  threadAnchor,
  unstartedOf,
} from "./columns.ts"
import { TEST_TASK, threadOfEntry, tree } from "./fixtures.ts"

const lane = (tip: string, name: ReturnType<typeof threadIdFor>): LaneView => ({
  name,
  tip: entryId(tip),
  running: false,
  waiting: 0,
  askedBy: null,
  lastWaiting: null,
  heldBy: null,
})

test("threadAnchor: a thread's end, never a newer branch; with no entry yet, its lane's tip", () => {
  const A = threadOfEntry("1-a")
  expect(threadAnchor(tree({ "1-a": null, "2-b": "1-a" }), [], A)).toBe("2-b")
  expect(
    threadAnchor(tree({ "1-a": null, "2-b": "1-a", "3-x": "1-a" }), [], A),
  ).toBe("2-b")
  const T = threadIdFor("new")
  const i = tree({ "1-a": null, "2-t": "1-a" })
  expect(threadAnchor(i, [lane("2-t", T)], T)).toBe("2-t")
  expect(threadAnchor(i, [], T)).toBeNull()
})

test("keyText: a column's key as the page draws it, whatever its kind", () => {
  const T = threadIdFor("t")
  expect(keyText({ kind: "card", card: T })).toBe(T)
  expect(keyText({ kind: "task", task: TEST_TASK })).toBe(TEST_TASK)
})

test("a thread not yet started closes with ×; a started one does not", () => {
  const T = threadIdFor("new")
  const bound: Column = {
    key: T,
    anchor: entryId("1-a"),
    thread: T,
    mode: BOUND,
  }
  const unstarted: Column = {
    ...bound,
    mode: {
      kind: "unstarted",
      fork: entryId("1-a"),
      root: rootIdFor("01a0ffd2-0000-7000-8000-00000000000a"),
    },
  }
  expect(unstartedOf(bound)).toBeUndefined()
  expect(unstartedOf(unstarted)?.fork).toBe("1-a")
})
