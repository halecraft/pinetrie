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
import { NO_FOCUS } from "./fixtures.ts"
import type { Focus } from "./focus.ts"
import {
  composerPlacesStore,
  dropProps,
  intoMessage,
  type PutTarget,
  placeOfTarget,
  targetOfElement,
  targetOfFocus,
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
/** A thread opened and not yet started. */
const UNSTARTED = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const E1 = atEntry(entryId("e-1"))

describe("one landing rule: every input has full fidelity", () => {
  const store = composerPlacesStore()
  const thread = composerPlace({ thread: LANE, mode: BOUND }, E1)
  const unstarted = composerPlace(
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
  store.set(
    "k-unstarted",
    unstarted === null ? null : { place: unstarted, message: null },
  )
  const targets = [
    { kind: "column", key: "k-thread" },
    { kind: "column", key: "k-unstarted" },
    { kind: "composer", key: "k-thread" },
    { kind: "inventory", slot: 0 },
    { kind: "inventory", slot: 17 },
    { kind: "column", key: "k-closed" },
    { kind: "pinned", key: "k-thread" },
    { kind: "pinned", key: "k-unstarted" },
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
    { kind: "task", task: TEST_TASK },
  ] satisfies PutTarget[]
  /** A kind of target missing from `targets` fails to compile; a text box is never marked. */
  const everyKind: [
    Exclude<PutTarget["kind"], (typeof targets)[number]["kind"] | "text-box">,
  ] extends [never]
    ? true
    : never = true

  test("every kind a drop can mark is round-tripped below; a missing one fails to compile", () => {
    expect(everyKind).toBe(true)
  })

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

  test("a column's pinned strip lands pinned at its composer's thread, an unstarted one's too", () => {
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

  test("a task column's pins land pinned to the task", () => {
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

test("composerPlace: at the thread's end, or an unstarted thread's; none for a started thread with no end here", () => {
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

describe("targetOfFocus", () => {
  const zone = { kind: "inventory", slot: 3 } as const
  test("the text box that has focus, else the drop zone around focus, else the column last focused", () => {
    const at = (over: Partial<Focus>) => targetOfFocus({ ...NO_FOCUS, ...over })
    expect(at({ inText: true, zone, column: "k" })).toEqual({
      kind: "text-box",
    })
    expect(at({ zone, column: "k" })).toEqual(zone)
    expect(at({ column: "k" })).toEqual({ kind: "column", key: "k" })
    expect(at({})).toBeNull()
  })
})
