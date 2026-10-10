import {
  atEntry,
  cardIdOfKind,
  entryId,
  rootIdFor,
  taskIdFor,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { composerPlace } from "./column-view.ts"
import { BOUND } from "./columns.ts"
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
/** A thread opened and not yet started (ADR-0126). */
const UNSTARTED = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const E1 = atEntry(entryId("e-1"))

describe("one landing rule (ADR-0048: every input has full fidelity)", () => {
  const store = composerPlacesStore()
  const thread = composerPlace({ thread: LANE, mode: BOUND }, E1)
  const fresh = composerPlace(
    {
      thread: UNSTARTED,
      mode: { kind: "unstarted", fork: entryId("e-1"), root: TEST_ROOT },
    },
    E1,
  )
  store.set(
    "k-thread",
    thread === null ? null : { place: thread, message: null },
  )
  store.set("k-fresh", fresh === null ? null : { place: fresh, message: null })
  const targets: PutTarget[] = [
    { kind: "column", key: "k-thread" },
    { kind: "column", key: "k-fresh" },
    { kind: "composer", key: "k-thread" },
    { kind: "inventory", slot: 0 },
    { kind: "inventory", slot: 17 },
    { kind: "column", key: "k-closed" },
    { kind: "pinned", key: "k-thread" },
    { kind: "pinned", key: "k-fresh" },
    {
      kind: "notes",
      column: cardIdOfKind(
        "note-column",
        "01a0ffd2-0000-7000-8000-0000000000a1",
      ),
    },
    { kind: "state", state: workflowStateIdFor("s-1") },
    { kind: "sidebar", before: TEST_TASK },
    { kind: "sidebar", before: null },
    { kind: "taskPinned", task: TEST_TASK },
    { kind: "canvas", task: TEST_TASK, after: LANE },
    { kind: "canvas", task: TEST_TASK, after: null },
  ]

  test.each(targets)("a drop on %o lands where a put to it lands", target => {
    const dropped = targetOfElement(marked(dropProps(target)))
    expect(dropped).toEqual(target)
    expect(
      dropped === null ? null : placeOfTarget(dropped, store.current(), ME),
    ).toEqual(placeOfTarget(target, store.current(), ME))
  })

  test("a column lands at its thread's nearest notes, an unstarted thread's too, its composer as your message; a slot as your inventory; a note column at its end; a column no store holds as nothing", () => {
    const at = (t: PutTarget) => placeOfTarget(t, store.current(), ME)
    const end = { thread: LANE }
    expect(at(targets[0] as PutTarget)).toEqual({
      kind: "notes",
      near: "thread",
      thread: LANE,
    })
    expect(at(targets[8] as PutTarget)).toEqual({
      kind: "note",
      column: cardIdOfKind(
        "note-column",
        "01a0ffd2-0000-7000-8000-0000000000a1",
      ),
    })
    expect(at(targets[1] as PutTarget)).toEqual({
      kind: "notes",
      near: "thread",
      thread: UNSTARTED,
    })
    expect(at(targets[2] as PutTarget)).toEqual({ kind: "composing", ...end })
    expect(at(targets[3] as PutTarget)).toEqual({
      kind: "inventory",
      holder: ME,
    })
    expect(at(targets[5] as PutTarget)).toBeNull()
  })

  test("a column's pinned strip lands pinned at its composer's thread, an unstarted one's too (ADR-0126)", () => {
    const at = (t: PutTarget) => placeOfTarget(t, store.current(), ME)
    expect(at(targets[6] as PutTarget)).toEqual({
      kind: "pinned",
      thread: LANE,
    })
    expect(at(targets[7] as PutTarget)).toEqual({
      kind: "pinned",
      thread: UNSTARTED,
    })
  })

  test("a task column's pins land pinned to the task (ADR-0116)", () => {
    expect(
      placeOfTarget(targets[12] as PutTarget, store.current(), ME),
    ).toEqual({ kind: "task-pinned", task: TEST_TASK })
  })

  test("a composer takes a put as your message; a column, at its notes", () => {
    expect(intoMessage(targets[2] as PutTarget)).toBe(true)
    expect(intoMessage(targets[1] as PutTarget)).toBe(false)
    expect(intoMessage(targets[0] as PutTarget)).toBe(false)
  })

  test("an element with no mark, or a slot that is no number, is no target", () => {
    expect(targetOfElement(marked({}))).toBeNull()
    expect(targetOfElement(marked({ "data-put-slot": "x" }))).toBeNull()
  })
})

test("composerPlace: your message at its thread, at its end once it has one, or at an unstarted thread's; none for a started thread with no end here (ADR-0126)", () => {
  expect(composerPlace({ thread: LANE, mode: BOUND }, E1)).toEqual({
    kind: "composing",
    thread: LANE,
  })
  expect(
    composerPlace(
      {
        thread: UNSTARTED,
        mode: { kind: "unstarted", fork: null, root: NEW_ROOT },
      },
      { kind: "root" },
    ),
  ).toEqual({ kind: "composing", thread: UNSTARTED })
  expect(
    composerPlace({ thread: LANE, mode: BOUND }, { kind: "root" }),
  ).toBeNull()
})
