import {
  type ArchivedCanvas,
  type CardPlace,
  type CardRecord,
  canvasIdFor,
  type LivePlace,
  rootIdFor,
  type ThreadName,
  type ThreadRecord,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { indexCanvases, rootsHeld } from "./canvas-index.ts"
import { threadCardOf } from "./fixtures.ts"
import {
  awayWords,
  lateAway,
  reachableAgents,
  reachWords,
  threadReach,
} from "./reach.ts"

const ada = writerId("ada@example.com")
const bea = writerId("bea@example.com")
const open = canvasIdFor("01a00000-0000-7000-8000-0000000000a1")
const done = canvasIdFor("01a00000-0000-7000-8000-0000000000a2")
const fox = threadIdFor("fox")
const owl = threadIdFor("owl")
const elk = threadIdFor("elk")
const unnamed = threadIdFor("unnamed")
const cards: CardRecord[] = []
for (const [thread, canvas] of [
  [fox, open],
  [unnamed, open],
  [owl, done],
] as const)
  cards.push(threadCardOf({ thread, canvas, by: ada, cards }))
const held: CardRecord = {
  ...threadCardOf({ thread: elk, canvas: open, by: ada, cards }),
  place: { kind: "inventory", holder: bea, slot: 0 },
} as CardRecord
const all = [...cards, held]
const record: ArchivedCanvas = { canvas: done, by: ada, at: 1 }
const archived = new Map([[done, record]])
const names = new Map([
  [fox, "amber-fox" as ThreadName],
  [owl, "slate-owl" as ThreadName],
  [elk, "jolly-elk" as ThreadName],
])

describe("where a thread is", () => {
  test("open, archived with its record, held by whom, or gone", () => {
    const at = (t: typeof fox) => threadReach(t, { cards: all, archived })
    expect(at(fox)).toEqual({ kind: "open", canvas: open })
    expect(at(owl)).toEqual({ kind: "archived", canvas: done, record })
    expect(at(elk)).toEqual({ kind: "held", by: bea })
    expect(at(threadIdFor("none"))).toEqual({ kind: "gone" })
  })
  test("each away reach in words, a sentence and a few", () => {
    const nameOf = (w: typeof ada) => (w === ada ? "Ada" : "Bea")
    expect(
      reachWords(
        "slate-owl",
        { kind: "archived", canvas: done, record },
        nameOf,
      ),
    ).toBe("slate-owl's canvas was archived by Ada")
    expect(reachWords("jolly-elk", { kind: "held", by: bea }, nameOf)).toBe(
      "Bea has jolly-elk",
    )
    expect(reachWords("x", { kind: "gone" }, nameOf)).toBe(
      "x is no longer on any canvas",
    )
    expect(awayWords({ kind: "held", by: bea }, nameOf)).toBe("Bea has it")
  })
  test("in reach: named threads of open canvases; not an archived canvas's, an inventory's, or an unnamed one", () => {
    const { cardsOn } = indexCanvases(all, new Map())
    expect(
      reachableAgents({ cardsOn, archived, names }).map(a => a.name),
    ).toEqual(["amber-fox"])
  })
})

describe("a late write of the host's", () => {
  const placeOnCanvas = (canvas: typeof open): LivePlace => {
    const place = cards.find(c => c.id === fox)?.place
    if (place?.kind !== "canvas") throw new Error("fox is on a canvas")
    return { ...place, canvas }
  }
  const inventory: LivePlace = { kind: "inventory", holder: bea }
  const places: Readonly<Record<string, CardPlace | null>> = {
    "an open canvas": placeOnCanvas(open),
    "an archived canvas": placeOnCanvas(done),
    "an inventory": inventory,
    "the trash, from an open canvas": {
      kind: "trash",
      left: placeOnCanvas(open),
    },
    "the trash, from an archived canvas": {
      kind: "trash",
      left: placeOnCanvas(done),
    },
    "the trash, from an inventory": { kind: "trash", left: inventory },
    "no card": null,
  }
  const cardsAt = (place: CardPlace | null): CardRecord[] => {
    const card = cards.find(c => c.id === fox)
    return place === null || card === undefined
      ? []
      : [{ ...card, place } as CardRecord]
  }
  const opened = new Set([fox])
  const away = (place: CardPlace | null) =>
    lateAway(
      { kind: "thread", thread: fox },
      { cards: cardsAt(place), archived, opened },
    )?.kind ?? null

  test("lands in a thread on an open canvas, in an inventory, or trashed from either", () => {
    for (const where of [
      "an open canvas",
      "an inventory",
      "the trash, from an open canvas",
      "the trash, from an inventory",
    ])
      expect(away(places[where] ?? null), where).toBeNull()
  })
  test("is refused in a thread on an archived canvas, trashed from one, or with no card", () => {
    expect(away(places["an archived canvas"] ?? null)).toBe("archived")
    expect(away(places["the trash, from an archived canvas"] ?? null)).toBe(
      "trashed",
    )
    expect(away(null)).toBe("gone")
  })
  test("lands in a thread not opened yet, which is in no canvas", () => {
    expect(
      lateAway(
        { kind: "thread", thread: fox },
        { cards: [], archived, opened: new Set() },
      ),
    ).toBeNull()
  })
  test("to an archived canvas is refused, with who archived it", () => {
    expect(
      lateAway(
        { kind: "canvas", canvas: done },
        { cards: [], archived, opened },
      ),
    ).toEqual({ kind: "archived", canvas: done, record })
    expect(
      lateAway(
        { kind: "canvas", canvas: open },
        { cards: [], archived, opened },
      ),
    ).toBeNull()
  })
  test("lands only in a thread whose root is held, wherever its card is", () => {
    const root = rootIdFor("01a00000-0000-7000-8000-0000000000c1")
    const threads = new Map<typeof fox, ThreadRecord>([
      [
        fox,
        { thread: fox, root, by: ada, createdAt: 0, origin: { kind: "root" } },
      ],
    ])
    for (const [where, place] of Object.entries(places)) {
      const held = rootsHeld(
        cardsAt(place),
        threads,
        new Set(archived.keys()),
        new Set([root]),
      ).has(root)
      expect(away(place) === null, where).toBe(held)
    }
  })
})
