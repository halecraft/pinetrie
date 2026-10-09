import {
  atEntry,
  entryId,
  ROOT,
  rootIdFor,
  taskIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { composerPlace } from "./column-view.ts"
import { NEW_TASK } from "./fixtures.ts"
import {
  composerPlacesStore,
  dropProps,
  intoMessage,
  type PutTarget,
  placeOfTarget,
  targetOfElement,
} from "./put-target.ts"

const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")

const ME = writerId("ada@x.io")
/** An element carrying `attrs`, as the page spreads them. */
const marked = (attrs: Readonly<Record<string, string>>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
})
const LANE = threadIdFor("x")
const E1 = atEntry(entryId("e-1"))

describe("one landing rule (ADR-0048: every input has full fidelity)", () => {
  const store = composerPlacesStore()
  const thread = composerPlace(
    { key: "k-thread", thread: LANE },
    E1,
    TEST_ROOT,
    TEST_TASK,
  )
  const fresh = composerPlace(
    { key: "k-fresh", fresh: {} },
    E1,
    TEST_ROOT,
    TEST_TASK,
  )
  store.set(
    "k-thread",
    thread === null ? null : { place: thread, message: null, cells: new Map() },
  )
  store.set(
    "k-fresh",
    fresh === null ? null : { place: fresh, message: null, cells: new Map() },
  )
  const targets: PutTarget[] = [
    { kind: "column", key: "k-thread" },
    { kind: "column", key: "k-fresh" },
    { kind: "composer", key: "k-thread" },
    { kind: "inventory", slot: 0 },
    { kind: "inventory", slot: 17 },
    { kind: "column", key: "k-closed" },
    { kind: "pinned", key: "k-thread" },
    { kind: "pinned", key: "k-fresh" },
    { kind: "cell", key: "k-thread", cell: 6 },
    { kind: "state", state: workflowStateIdFor("s-1") },
    { kind: "sidebar", before: TEST_TASK },
    { kind: "sidebar", before: null },
  ]

  test.each(targets)("a drop on %o lands where a put to it lands", target => {
    const dropped = targetOfElement(marked(dropProps(target)))
    expect(dropped).toEqual(target)
    expect(
      dropped === null ? null : placeOfTarget(dropped, store.current(), ME),
    ).toEqual(placeOfTarget(target, store.current(), ME))
  })

  test("a column lands as a note at its end, its composer as your message; a fresh column as its message; a slot as your inventory; a column no store holds as nothing", () => {
    const at = (t: PutTarget) => placeOfTarget(t, store.current(), ME)
    const end = { at: E1, thread: LANE }
    expect(at(targets[0] as PutTarget)).toEqual({
      kind: "note",
      ...end,
      cell: null,
    })
    expect(at(targets[1] as PutTarget)).toEqual({
      kind: "fresh",
      column: "k-fresh",
      root: TEST_ROOT,
      task: TEST_TASK,
      at: E1,
    })
    expect(at(targets[2] as PutTarget)).toEqual({ kind: "composing", ...end })
    expect(at(targets[3] as PutTarget)).toEqual({
      kind: "inventory",
      holder: ME,
    })
    expect(at(targets[5] as PutTarget)).toBeNull()
  })

  test("a column's pinned strip lands pinned at its composer's thread end; a fresh column has none", () => {
    const at = (t: PutTarget) => placeOfTarget(t, store.current(), ME)
    expect(at(targets[6] as PutTarget)).toEqual({
      kind: "pinned",
      at: E1,
      thread: LANE,
    })
    expect(at(targets[7] as PutTarget)).toBeNull()
  })

  test("a composer, or a fresh column, takes a put as your message", () => {
    expect(intoMessage(targets[2] as PutTarget, store.current())).toBe(true)
    expect(intoMessage(targets[1] as PutTarget, store.current())).toBe(true)
    expect(intoMessage(targets[0] as PutTarget, store.current())).toBe(false)
  })

  test("an element with no mark, or a slot that is no number, is no target", () => {
    expect(targetOfElement(marked({}))).toBeNull()
    expect(targetOfElement(marked({ "data-put-slot": "x" }))).toBeNull()
  })
})

test("composerPlace: your message at the end of its thread; fresh by key, in its root and the task it is on; none at the root, nor a fresh one in no root, nor with no thread yet", () => {
  expect(
    composerPlace({ key: "k", thread: LANE }, E1, TEST_ROOT, TEST_TASK),
  ).toEqual({
    kind: "composing",
    at: E1,
    thread: LANE,
  })
  // A column opened at an entry, before it settles on its thread.
  expect(composerPlace({ key: "k" }, E1, TEST_ROOT, TEST_TASK)).toBeNull()
  // A branch: its tab's root, at its branch point, on the task you are on.
  expect(
    composerPlace({ key: "k", fresh: {} }, E1, TEST_ROOT, TEST_TASK),
  ).toEqual({
    kind: "fresh",
    column: "k",
    root: TEST_ROOT,
    task: TEST_TASK,
    at: E1,
  })
  // A new tab: the root and the task it minted as it opened (ADR-0066).
  expect(
    composerPlace(
      { key: "k", fresh: { root: NEW_ROOT, task: NEW_TASK } },
      { kind: "root" },
      undefined,
      null,
    ),
  ).toEqual({
    kind: "fresh",
    column: "k",
    root: NEW_ROOT,
    task: NEW_TASK,
    at: ROOT,
  })
  expect(
    composerPlace(
      { key: "k", fresh: {} },
      { kind: "root" },
      undefined,
      TEST_TASK,
    ),
  ).toBeNull()
  expect(
    composerPlace(
      { key: "k", fresh: { root: NEW_ROOT } },
      { kind: "root" },
      undefined,
      null,
    ),
  ).toBeNull()
  expect(
    composerPlace(
      { key: "k", thread: LANE },
      { kind: "root" },
      undefined,
      TEST_TASK,
    ),
  ).toBeNull()
  // A thread's place needs no root: the thread's record names it.
  expect(
    composerPlace({ key: "k", thread: LANE }, E1, undefined, TEST_TASK),
  ).toEqual({ kind: "composing", at: E1, thread: LANE })
})
