import {
  type CardRecord,
  canvasIdFor,
  entryId,
  NO_CONTENT,
  type TranscriptMessage,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  crossCanvasLinks,
  linkOpen,
  linkWords,
  opens,
  threadLink,
} from "./thread-link.ts"

const T = threadIdFor("t")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const reader = { me: ADA, nameOf: new Map([[BEA, "Bea"]]) }
const at = (place: CardRecord["place"]): CardRecord[] => [
  {
    kind: "thread",
    id: T,
    owner: ADA,
    placer: ADA,
    place,
    content: NO_CONTENT,
  } as CardRecord,
]
const E = entryId("e-1")

test("a link opens a thread's canvas, your own held thread's preview, and nothing for someone else's", () => {
  const open = threadLink(
    T,
    at({ kind: "canvas", canvas: CANVAS, order: "1", width: 1 }),
    ADA,
  )
  expect(linkOpen(open, E)).toEqual({
    kind: "canvas",
    canvas: CANVAS,
    entry: E,
  })
  expect(linkWords(open, reader, () => "Fix the sync bug")).toBe(
    "Fix the sync bug",
  )
  const mine = threadLink(T, at({ kind: "inventory", holder: ADA }), ADA)
  expect(linkOpen(mine, E)).toEqual({ kind: "preview", thread: T })
  expect(linkWords(mine, reader, () => "")).toBe("in your inventory")
  const held = threadLink(T, at({ kind: "inventory", holder: BEA }), ADA)
  expect([linkOpen(held, E), opens(held)]).toEqual([{ kind: "nothing" }, false])
  expect(linkWords(held, reader, () => "")).toBe("Bea has it")
  const gone = threadLink(T, [], ADA)
  expect([linkOpen(gone, E), opens(gone)]).toEqual([{ kind: "nothing" }, false])
  expect(linkWords(gone, reader, () => "")).toBe("deleted")
})

test("a link to a trashed thread names the canvas it left, says so, and restores it", () => {
  const trashed = threadLink(
    T,
    at({
      kind: "trash",
      left: { kind: "canvas", canvas: CANVAS, order: "1", width: 1 },
    }),
    ADA,
  )
  expect(trashed).toMatchObject({ kind: "trashed", thread: T, canvas: CANVAS })
  expect([linkOpen(trashed, E), opens(trashed)]).toEqual([
    { kind: "restore", thread: T },
    true,
  ])
  expect(linkWords(trashed, reader, () => "")).toBe("in the trash")
})

test("a link is made only by threadLink", () => {
  // @ts-expect-error: a link is threadLink's to make, so none reaches a held thread
  const forged: Parameters<typeof linkOpen>[0] = {
    kind: "open",
    thread: T,
    canvas: CANVAS,
  }
  expect(forged.kind).toBe("open")
})

test("a row from another canvas's thread says where it is; from this canvas, nothing", () => {
  const placed = at({ kind: "canvas", canvas: CANVAS, order: "1", width: 1 })
  const nodes: readonly TranscriptMessage[] = [
    {
      id: entryId("a"),
      thread: T,
      text: "",
      role: "answer",
      author: "amber-fox",
      from: T,
    },
    { id: entryId("b"), thread: T, text: "", role: "assistant" },
  ]
  const facts = { cards: placed, reader, labelOf: () => "Sync bug" }
  const came = crossCanvasLinks(nodes, { ...facts, here: null })
  expect([...came.keys()]).toEqual([entryId("a")])
  expect(came.get(entryId("a"))?.words).toBe("Sync bug")
  expect(crossCanvasLinks(nodes, { ...facts, here: CANVAS }).size).toBe(0)
  const held = crossCanvasLinks(nodes, {
    ...facts,
    cards: at({ kind: "inventory", holder: BEA }),
    here: CANVAS,
  })
  expect(held.get(entryId("a"))?.words).toBe("Bea has it")
})
