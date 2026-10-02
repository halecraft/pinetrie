import {
  atEntry,
  type CardId,
  type CardRecord,
  cardId,
  type EntryId,
  type EntryLike,
  entryId,
  type TreeIndex,
  writerId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import { cardMarks, holdsText, ownCards, withFilled } from "./card-marks.ts"
import { entry, indexOf } from "./fixtures.ts"
import { initialLayout, type Layout, tabOfColumn } from "./layout.ts"

const ADA = writerId("p-ada")
const BEA = writerId("p-bea")

const said = (id: string, parentId: string | null): EntryLike =>
  entry(id, parentId, { role: "user", content: `text of ${id}` })
/** Two roots: e1 -> e2, and g1. */
const tree = (...more: EntryLike[]): TreeIndex =>
  indexOf([said("e1", null), said("e2", "e1"), said("g1", null), ...more])
const drafting = (id: string, at: string, owner = ADA): CardRecord => ({
  id: cardId(id),
  owner,
  placer: owner,
  place: { kind: "drafting", at: atEntry(entryId(at)), lane: null },
  command: null,
  unsent: null,
})
const fresh = (id: string, column: string): CardRecord => ({
  id: cardId(id),
  owner: ADA,
  placer: ADA,
  place: { kind: "fresh", column },
  command: null,
  unsent: null,
})
/** e1's tab open, holding a branch column; a new tab; g1's tab closed. */
const layout: Layout = {
  ...initialLayout(),
  open: [entryId("e1")],
  roots: new Map([
    [
      entryId("e1"),
      [
        { key: "first-e1", anchor: entryId("e1") },
        { key: "branch", anchor: entryId("e1"), fresh: {} },
      ],
    ],
    [entryId("g1"), [{ key: "first-g1", anchor: entryId("g1") }]],
  ]),
  newTabs: [{ key: "new-1", anchor: null, fresh: {} }],
}
const marks = (
  cards: readonly CardRecord[],
  filled: readonly string[] = cards.map(c => c.id),
  over: { layout?: Layout; index?: TreeIndex; archived?: Set<EntryId> } = {},
) =>
  cardMarks({
    mine: ownCards(ADA, cards),
    filled: new Set(filled.map(cardId)),
    layout: over.layout ?? layout,
    archived: over.archived ?? new Set(),
    lanes: [],
    index: over.index ?? tree(),
  })
const sets = (m: ReturnType<typeof marks>) => ({
  roots: [...m.roots],
  newTabs: [...m.newTabs],
  ends: [...m.ends],
  elsewhere: m.elsewhere,
})

test("holdsText: what would make a card, a bare @agent nothing", () => {
  expect(holdsText("fix it")).toBe(true)
  expect(holdsText("  \n")).toBe(false)
  expect(holdsText("@agent ")).toBe(false)
  expect(holdsText("@agent fix it")).toBe(true)
})

test("withFilled: the same set unless the card flips", () => {
  const C: CardId = cardId("c")
  const none: ReadonlySet<CardId> = new Set()
  const some: ReadonlySet<CardId> = new Set([C])
  expect(withFilled(some, C, true)).toBe(some)
  expect(withFilled(none, C, false)).toBe(none)
  expect([...withFilled(none, C, true)]).toEqual([C])
  expect([...withFilled(some, C, false)]).toEqual([])
})

test("tabOfColumn: a new tab's column, a root's open or closed, or none", () => {
  expect(tabOfColumn(layout, "new-1")).toEqual({ kind: "new", key: "new-1" })
  expect(tabOfColumn(layout, "branch")).toEqual({ kind: "root", root: "e1" })
  expect(tabOfColumn(layout, "first-g1")).toEqual({
    kind: "root",
    root: "g1",
  })
  expect(tabOfColumn(layout, "elsewhere")).toBeUndefined()
})

describe("cardMarks", () => {
  test("a drafting card marks its root and its thread's end", () => {
    expect(sets(marks([drafting("c", "e2")]))).toEqual({
      roots: ["e1"],
      newTabs: [],
      ends: ["e2"],
      elsewhere: false,
    })
  })

  test("it follows its thread as the thread grows", () => {
    const grown = tree(said("e3", "e2"))
    expect([
      ...marks([drafting("c", "e2")], ["c"], { index: grown }).ends,
    ]).toEqual(["e3"])
  })

  test("a fresh card marks the tab its column is in", () => {
    expect(sets(marks([fresh("c", "branch"), fresh("d", "new-1")]))).toEqual({
      roots: ["e1"],
      newTabs: ["new-1"],
      ends: [],
      elsewhere: false,
    })
  })

  test("a fresh card in a column this layout lacks marks nothing", () => {
    expect(sets(marks([fresh("c", "elsewhere")])).roots).toEqual([])
  })

  test("only your cards, only with text, only where their place still is", () => {
    const none = { roots: [], newTabs: [], ends: [], elsewhere: false }
    expect(sets(marks([drafting("c", "e2", BEA)]))).toEqual(none)
    expect(sets(marks([drafting("c", "e2")], []))).toEqual(none)
    expect(sets(marks([drafting("c", "gone")]))).toEqual(none)
  })

  test("elsewhere: a marked root whose tab you closed", () => {
    expect(marks([drafting("c", "g1")]).elsewhere).toBe(true)
    expect(marks([fresh("c", "first-g1")]).elsewhere).toBe(true)
    const closed = { ...layout, open: [] }
    expect(
      marks([drafting("c", "e2")], ["c"], { layout: closed }).elsewhere,
    ).toBe(true)
  })

  test("an archived root marks its row, never the Archive tab", () => {
    const m = marks([drafting("c", "g1")], ["c"], {
      archived: new Set([entryId("g1")]),
    })
    expect([...m.roots]).toEqual(["g1"])
    expect(m.elsewhere).toBe(false)
  })
})
