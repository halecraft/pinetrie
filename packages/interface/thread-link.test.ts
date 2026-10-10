import {
  type CardRecord,
  entryId,
  NO_CONTENT,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import {
  crossTaskLinks,
  linkWords,
  openOf,
  opens,
  threadLink,
} from "./thread-link.ts"

const T = threadIdFor("t")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
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

test("a link opens a thread's task, your own held thread's preview, and nothing for someone else's (ADR-0117, ADR-0124)", () => {
  const open = threadLink(
    T,
    at({ kind: "canvas", task: TASK, order: "1", width: 1 }),
    ADA,
  )
  expect(openOf(open, E)).toEqual({ kind: "task", task: TASK, entry: E })
  expect(linkWords(open, reader, () => "Fix the sync bug")).toBe(
    "Fix the sync bug",
  )
  const mine = threadLink(T, at({ kind: "inventory", holder: ADA }), ADA)
  expect(openOf(mine, E)).toEqual({ kind: "preview", thread: T })
  expect(linkWords(mine, reader, () => "")).toBe("in your inventory")
  const held = threadLink(T, at({ kind: "inventory", holder: BEA }), ADA)
  expect([openOf(held, E), opens(held)]).toEqual([{ kind: "nothing" }, false])
  expect(linkWords(held, reader, () => "")).toBe("Bea has it")
  const gone = threadLink(T, [], ADA)
  expect([openOf(gone, E), opens(gone)]).toEqual([{ kind: "nothing" }, false])
})

test("a link is made only by threadLink", () => {
  // @ts-expect-error: a link is threadLink's to make, so none reaches a held thread
  const forged: Parameters<typeof openOf>[0] = {
    kind: "open",
    thread: T,
    task: TASK,
  }
  expect(forged.kind).toBe("open")
})

test("a row from another task's thread says where it is; from this task, nothing (ADR-0128)", () => {
  const canvas = at({ kind: "canvas", task: TASK, order: "1", width: 1 })
  const nodes = [
    { id: entryId("a"), role: "answer", from: T },
    { id: entryId("b"), role: "assistant" },
  ]
  const facts = { cards: canvas, reader, labelOf: () => "Sync bug" }
  const came = crossTaskLinks(nodes, { ...facts, here: null })
  expect([...came.keys()]).toEqual([entryId("a")])
  expect(came.get(entryId("a"))?.words).toBe("Sync bug")
  expect(crossTaskLinks(nodes, { ...facts, here: TASK }).size).toBe(0)
  const held = crossTaskLinks(nodes, {
    ...facts,
    cards: at({ kind: "inventory", holder: BEA }),
    here: TASK,
  })
  expect(held.get(entryId("a"))?.words).toBe("Bea has it")
})
