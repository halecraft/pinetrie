import {
  entryId,
  indexTree,
  NO_CONTENT,
  type TextCard,
  type ThreadName,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  cardIdFor,
  entriesById,
  entry,
  fromParents,
  threadOfEntry,
} from "@pinetrie/core/fixtures"
import { NO_INTENTS, type Slots, settleSlots } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { inventoryView, slotKey } from "./inventory-view.ts"
import { faceStatus, threadFace, threadPreview } from "./thread-face.ts"

const ADA = writerId("ada@x.io")
const A = cardIdFor("ca")
const B = cardIdFor("cb")
const slotsOf = (o: Record<string, string>): Slots =>
  Object.fromEntries(Object.entries(o).map(([s, c]) => [s, textCardId(c)]))

describe("inventoryView", () => {
  const record = (id: typeof A): TextCard => ({
    kind: "text",
    id,
    owner: ADA,
    placer: ADA,
    place: { kind: "inventory", holder: ADA },
    content: { command: null, unsent: null, origin: null },
  })

  test("draws exactly settleSlots, the selection, and first lines", () => {
    const held = [record(A), record(B)]
    const slots = slotsOf({ "10": cardIdFor("cb") })
    const view = inventoryView({
      held,
      slots,
      intents: NO_INTENTS,
      selected: 10,
      me: ADA,
      texts: new Map([[B, "\n  plan: ship it\nsecond line"]]),
      threads: new Map(),
      open: false,
    })
    const drawn = Object.fromEntries(
      view.grid.cells.flatMap(s =>
        s.card === null ? [] : [[String(s.index), s.card.id]],
      ),
    )
    expect(drawn).toEqual(
      settleSlots(
        held.map(c => c.id),
        slots,
        NO_INTENTS,
      ),
    )
    expect(view.grid.card?.id).toBe(B)
    expect(view.grid.cells[10]).toMatchObject({
      face: {
        lines: "plan: ship it\nsecond line",
        key: null,
        tone: "inventory",
      },
      selected: true,
    })
    expect(view.free).toBe(16)
  })

  test("labels the first nine slots 1–9 on their faces", () => {
    const view = inventoryView({
      held: [record(A)],
      slots: slotsOf({ "0": cardIdFor("ca") }),
      intents: NO_INTENTS,
      selected: 0,
      me: ADA,
      texts: new Map(),
      threads: new Map(),
      open: false,
    })
    const face = view.grid.cells[0]?.face
    expect(face?.kind === "text" && face.key).toBe("1")
    expect(Array.from({ length: 18 }, (_, n) => slotKey(n))).toEqual([
      ..."123456789".split(""),
      ...Array(9).fill(null),
    ])
  })

  test("previews the selected card, normal and one column wide; an empty slot or an open card, none", () => {
    const view = (selected: number, open: boolean) =>
      inventoryView({
        held: [record(A)],
        slots: slotsOf({ "3": cardIdFor("ca") }),
        intents: NO_INTENTS,
        selected,
        me: ADA,
        texts: new Map(),
        threads: new Map(),
        open,
      }).preview
    expect(view(3, false)).toEqual({
      card: record(A),
      detail: "normal",
      width: 1,
    })
    expect(view(4, false)).toBeNull()
    expect(view(3, true)).toBeNull()
  })

  test("a slot's × is drawn on a card you may discard, never on an empty slot", () => {
    const cells = (me: typeof ADA) =>
      inventoryView({
        held: [record(A)],
        slots: slotsOf({ "0": cardIdFor("ca") }),
        intents: NO_INTENTS,
        selected: 0,
        me,
        texts: new Map(),
        threads: new Map(),
        open: false,
      }).grid.cells
    expect(cells(ADA).map(c => c.discards)).toEqual([
      true,
      ...Array(17).fill(false),
    ])
    expect(cells(writerId("bea@x.io"))[0]?.discards).toBe(false)
  })
})

test("a thread's card is drawn by its face: its name, its first line, where it ended, and its status", () => {
  const T = threadIdFor("t")
  const index = indexTree(
    fromParents({ "1-r": null, "2-a": "1-r" }, id => ({
      role: "person",
      content: "",
      details: { author: ADA, authorName: "Ada", text: `said ${id}` },
    })),
  )
  const thread = threadOfEntry("1-r")
  const face = threadFace({
    thread,
    index,
    lanes: [
      {
        name: thread,
        tip: entryId("2-a"),
        running: false,
        waiting: 2,
        askedBy: null,
        lastWaiting: null,
        heldBy: null,
      },
    ],
    names: new Map([[thread, "amber-fox" as ThreadName]]),
    iconFor: () => null,
  })
  expect(face).toMatchObject({ name: "amber-fox", queued: 2, stopped: false })
  expect(faceStatus(face)).toBe("2 cards queued")
  expect(faceStatus({ ...face, stopped: true, queued: 0 })).toBe("stopped")
  const view = inventoryView({
    held: [
      {
        kind: "thread",
        id: T,
        owner: ADA,
        placer: ADA,
        place: { kind: "inventory", holder: ADA },
        content: NO_CONTENT,
      },
    ],
    slots: {},
    intents: NO_INTENTS,
    selected: 0,
    me: ADA,
    texts: new Map(),
    threads: new Map([[T, { ...face, thread: T }]]),
    open: false,
  })
  expect(view.grid.cells[0]?.face).toMatchObject({
    kind: "thread",
    name: "amber-fox",
  })
})

test("a thread's face reads its first message, not the context entry its first run wrote above it", () => {
  const T = threadIdFor("t")
  const B = threadIdFor("b")
  const index = indexTree(
    entriesById([
      entry("1-r", null, { role: "person", content: "plan" }, { thread: T }),
      entry(
        "2-cb",
        "1-r",
        { role: "canvas", content: "<canvas>" },
        { thread: B },
      ),
      entry(
        "3-b",
        "2-cb",
        { role: "person", content: "an aside" },
        { thread: B },
      ),
      entry("4-a", "3-b", { role: "assistant", content: "ok" }, { thread: B }),
    ]),
  )
  const face = threadFace({
    thread: B,
    index,
    lanes: [],
    names: new Map(),
    iconFor: () => null,
  })
  expect([face.first, face.last]).toEqual(["an aside", "ok"])
})

test("a thread's preview is its path from its root, read only", () => {
  const index = indexTree(
    fromParents({ "1-r": null, "2-a": "1-r", "3-b": "1-r" }, id => ({
      role: "person",
      content: id,
      details: { author: ADA, authorName: "Ada", text: id },
    })),
  )
  const preview = threadPreview(threadOfEntry("3-b"), index, null)
  expect(preview.kind).toBe("preview")
  expect(preview.rows.map(r => r.id)).toEqual(["1-r", "3-b"])
})
