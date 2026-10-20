import {
  canvasIdFor,
  entryId,
  indexTree,
  type TextCard,
  type ThreadName,
  textCardId,
  threadIdFor,
  UNTICKED,
  writerId,
} from "@pinetrie/core"
import {
  cardIdFor,
  entriesById,
  entry,
  fromParents,
  personMessage,
  threadOfEntry,
} from "@pinetrie/core/fixtures"
import { NO_INTENTS, type Slots, settleSlots } from "@pinetrie/session"
import { describe, expect, test } from "vitest"
import { inventoryView, slotKey } from "./inventory-view.ts"
import { glanceStatus, threadGlance, threadPreview } from "./thread-glance.ts"

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

  test("draws exactly settleSlots, the selection, and first lines; counts the cards held of 12", () => {
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
      threadNames: new Map(),
      media: new Map(),
      titles: new Map(),
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
      compact: {
        lead: { kind: "text", text: "plan: ship it" },
        second: "second line",
        badge: null,
        tone: "inventory",
      },
      selected: true,
    })
    expect(view.held).toBe(2)
    expect(view.grid.cells).toHaveLength(12)
  })

  test("labels the first nine slots 1–9 on their compacts", () => {
    const view = inventoryView({
      held: [record(A)],
      slots: slotsOf({ "0": cardIdFor("ca") }),
      intents: NO_INTENTS,
      selected: 0,
      me: ADA,
      texts: new Map(),
      threads: new Map(),
      threadNames: new Map(),
      media: new Map(),
      titles: new Map(),
      open: false,
    })
    expect(view.grid.cells[0]?.compact?.badge).toEqual({
      kind: "key",
      key: "1",
    })
    expect(Array.from({ length: 12 }, (_, n) => slotKey(n))).toEqual([
      ..."123456789".split(""),
      ...Array(3).fill(null),
    ])
  })

  test("the bench: an empty slot's number, a card normal, opened full", () => {
    const view = (selected: number, open: boolean) =>
      inventoryView({
        held: [record(A)],
        slots: slotsOf({ "3": cardIdFor("ca") }),
        intents: NO_INTENTS,
        selected,
        me: ADA,
        texts: new Map(),
        threads: new Map(),
        threadNames: new Map(),
        media: new Map(),
        titles: new Map(),
        open,
      }).bench
    expect(view(3, false)).toEqual({
      kind: "card",
      card: record(A),
      detail: "normal",
    })
    expect(view(4, false)).toEqual({ kind: "empty", slot: 4 })
    expect(view(4, true)).toEqual({ kind: "empty", slot: 4 })
    expect(view(3, true)).toMatchObject({ detail: "full" })
  })

  test("a slot's card may be trashed from it only if you may trash it, never an empty slot", () => {
    const cells = (me: typeof ADA) =>
      inventoryView({
        held: [record(A)],
        slots: slotsOf({ "0": cardIdFor("ca") }),
        intents: NO_INTENTS,
        selected: 0,
        me,
        texts: new Map(),
        threads: new Map(),
        threadNames: new Map(),
        media: new Map(),
        titles: new Map(),
        open: false,
      }).grid.cells
    expect(cells(ADA).map(c => c.trashes)).toEqual([
      true,
      ...Array(11).fill(false),
    ])
    expect(cells(writerId("bea@x.io"))[0]?.trashes).toBe(false)
  })
})

test("a thread's glance: its name, its first line, where it ended, and its status", () => {
  const T = threadIdFor("t")
  const index = indexTree(
    fromParents({ "1-r": null, "2-a": "1-r" }, id =>
      personMessage("", { author: "Ada", writer: ADA, sendId: `s-${id}` }),
    ),
  )
  const thread = threadOfEntry("1-r")
  const glance = threadGlance({
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
    focuses: new Map(),
    statuses: new Map(),
    iconFor: () => null,
  })
  expect(glance).toMatchObject({ name: "amber-fox", queued: 2, stopped: false })
  expect(glanceStatus(glance)).toBe("2 cards queued")
  expect(glanceStatus({ ...glance, stopped: true, queued: 0 })).toBe("stopped")
  const view = inventoryView({
    held: [
      {
        kind: "thread",
        id: T,
        owner: ADA,
        placer: ADA,
        place: { kind: "inventory", holder: ADA },
        content: UNTICKED,
      },
    ],
    slots: {},
    intents: NO_INTENTS,
    selected: 0,
    me: ADA,
    texts: new Map(),
    threads: new Map([[T, { ...glance, thread: T }]]),
    threadNames: new Map(),
    media: new Map(),
    titles: new Map(),
    open: false,
  })
  expect(view.grid.cells[0]?.compact).toMatchObject({
    kind: "thread",
    lead: { kind: "text", text: "amber-fox" },
  })
})

test("a thread's glance reads its first message, not the context entry its first run wrote above it", () => {
  const T = threadIdFor("t")
  const B = threadIdFor("b")
  const index = indexTree(
    entriesById([
      entry("1-r", null, personMessage("plan"), { thread: T }),
      entry(
        "2-cb",
        "1-r",
        {
          role: "canvas",
          content: "",
          canvas: { canvas: canvasIdFor("c"), title: "c", lines: [], more: 0 },
        },
        { thread: B },
      ),
      entry("3-b", "2-cb", personMessage("an aside"), { thread: B }),
      entry("4-a", "3-b", { role: "assistant", content: "ok" }, { thread: B }),
    ]),
  )
  const glance = threadGlance({
    thread: B,
    index,
    lanes: [],
    names: new Map(),
    focuses: new Map(),
    statuses: new Map(),
    iconFor: () => null,
  })
  expect([glance.first, glance.last]).toEqual(["an aside", "ok"])
})

test("a thread's preview is its path from its root, read only", () => {
  const index = indexTree(
    fromParents({ "1-r": null, "2-a": "1-r", "3-b": "1-r" }, id =>
      personMessage(id, { author: "Ada", writer: ADA }),
    ),
  )
  const preview = threadPreview(threadOfEntry("3-b"), index, null)
  expect(preview.kind).toBe("preview")
  expect(preview.rows.map(r => r.id)).toEqual(["1-r", "3-b"])
})
