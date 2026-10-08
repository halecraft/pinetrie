import {
  atEntry,
  entryId,
  ROOT,
  rootIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { composerPlace } from "./column-view.ts"
import {
  composerPlacesStore,
  dropProps,
  intoMessage,
  type PutTarget,
  placeOfTarget,
  targetOfElement,
} from "./put-target.ts"

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")

const ME = writerId("ada@x.io")
/** An element carrying `attrs`, as the page spreads them. */
const marked = (attrs: Readonly<Record<string, string>>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
})
const LANE = threadIdFor("x")
/** Thread `LANE` has a lane, named by its id. */
const LANES = [
  {
    name: LANE,
    tip: entryId("e-1"),
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
  },
]
const E1 = atEntry(entryId("e-1"))

describe("one landing rule (ADR-0048: every input has full fidelity)", () => {
  const store = composerPlacesStore()
  const thread = composerPlace(
    { key: "k-thread", thread: LANE },
    E1,
    TEST_ROOT,
    LANES,
  )
  const fresh = composerPlace(
    { key: "k-fresh", fresh: {} },
    E1,
    TEST_ROOT,
    LANES,
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
    { kind: "sidebar", before: entryId("1-r1") },
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
    const end = { root: TEST_ROOT, at: E1, lane: LANE }
    expect(at(targets[0] as PutTarget)).toEqual({
      kind: "note",
      ...end,
      cell: null,
    })
    expect(at(targets[1] as PutTarget)).toEqual({
      kind: "fresh",
      column: "k-fresh",
      root: TEST_ROOT,
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
      root: TEST_ROOT,
      at: E1,
      lane: LANE,
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

test("composerPlace: your message at the end with its thread's lane, in its root; fresh by key, in its root; none at the root, nor in no root", () => {
  expect(
    composerPlace({ key: "k", thread: LANE }, E1, TEST_ROOT, LANES),
  ).toEqual({
    kind: "composing",
    root: TEST_ROOT,
    at: E1,
    lane: LANE,
  })
  expect(composerPlace({ key: "k" }, E1, TEST_ROOT, LANES)).toEqual({
    kind: "composing",
    root: TEST_ROOT,
    at: E1,
    lane: null,
  })
  // A branch: its tab's root, at its branch point.
  expect(composerPlace({ key: "k", fresh: {} }, E1, TEST_ROOT, LANES)).toEqual({
    kind: "fresh",
    column: "k",
    root: TEST_ROOT,
    at: E1,
  })
  // A new tab: the root it minted as it opened (ADR-0066).
  expect(
    composerPlace(
      { key: "k", fresh: { root: NEW_ROOT } },
      { kind: "root" },
      undefined,
      LANES,
    ),
  ).toEqual({ kind: "fresh", column: "k", root: NEW_ROOT, at: ROOT })
  expect(
    composerPlace({ key: "k", fresh: {} }, { kind: "root" }, undefined, LANES),
  ).toBeNull()
  expect(
    composerPlace({ key: "k" }, { kind: "root" }, undefined, LANES),
  ).toBeNull()
  expect(composerPlace({ key: "k" }, E1, undefined, LANES)).toBeNull()
})
