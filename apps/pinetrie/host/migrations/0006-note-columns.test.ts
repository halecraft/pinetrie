import { noteColumnIdFor, taskIdFor, threadIdFor } from "@pinetrie/core"
import { orderKeys } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { planNoteColumns } from "./0006-note-columns.ts"

const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const [A, B, C] = ["a", "b", "c"].map(threadIdFor) as [
  ReturnType<typeof threadIdFor>,
  ReturnType<typeof threadIdFor>,
  ReturnType<typeof threadIdFor>,
]
const [K1, K2] = orderKeys(2) as [string, string]
const blank = {
  owner: "",
  kind: "",
  root: "",
  at: "",
  lane: "",
  column: "",
  order: "",
  by: "",
  seen: "",
  command: "",
  fact: "",
  unsent: "",
  placer: "",
  holder: "",
  task: "",
  width: "",
}
const canvas = (order: string) => ({
  ...blank,
  owner: "w-ada",
  placer: "w-ada",
  kind: "canvas",
  task: TASK,
  order,
  width: "1",
})
const oldNote = (lane: string, cell: string) => ({
  ...blank,
  owner: "w-bea",
  placer: "w-bea",
  kind: "note",
  at: "e-1",
  lane,
  order: cell,
})
const made = (n: number) => noteColumnIdFor(`made-${n}`)
const plan = (rows: Record<string, Record<string, string>>) => {
  let n = 0
  return planNoteColumns({ rows, newColumn: () => made(++n) })
}

describe("planNoteColumns (ADR-0116)", () => {
  test("each thread's notes go to a note column made just after its card, in the board's reading order, gaps dropped; a note whose thread is on no canvas is left", () => {
    const p = plan({
      [A]: canvas(K1),
      [B]: canvas(K2),
      "n-two": oldNote(A, "2"),
      "n-zero": oldNote(A, "0"),
      "n-none": oldNote(A, ""),
      "n-b": oldNote(B, "5"),
      "n-lost": oldNote(C, "0"),
    })
    expect(p.columns).toBe(2)
    expect(p.lost).toEqual(["n-lost"])
    const first = p.rows[made(1)]
    expect(first).toMatchObject({ kind: "canvas", task: TASK, width: "1" })
    expect((first?.order ?? "") > K1 && (first?.order ?? "") < K2).toBe(true)
    const second = p.rows[made(2)]
    expect((second?.order ?? "") > K2).toBe(true)
    const [r0, r1, r2] = orderKeys(3)
    expect(p.rows["n-zero"]).toMatchObject({
      kind: "note",
      at: "",
      lane: "",
      column: made(1),
      order: r0,
      owner: "w-bea",
    })
    expect(p.rows["n-two"]).toMatchObject({ column: made(1), order: r1 })
    expect(p.rows["n-none"]).toMatchObject({ column: made(1), order: r2 })
    expect(p.rows["n-b"]).toMatchObject({ column: made(2), order: r0 })
    expect(p.rows["n-lost"]).toBeUndefined()
  })

  test("with no room after the thread's card, the crowded canvas cards are renumbered", () => {
    // The key just after A's: no key fits between.
    const tight = (Number.parseInt(K1, 36) + 1).toString(36).padStart(10, "0")
    const p = plan({
      [A]: canvas(K1),
      [B]: canvas(tight),
      "n-a": oldNote(A, "0"),
    })
    const order = p.rows[made(1)]?.order ?? ""
    const bOrder = p.rows[B]?.order ?? tight
    const aOrder = p.rows[A]?.order ?? K1
    expect(aOrder < order && order < bOrder).toBe(true)
  })

  test("a note already in a note column is left: a second run makes nothing", () => {
    const column = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
    const p = plan({
      [A]: canvas(K1),
      [column]: canvas(K2),
      "n-new": { ...blank, kind: "note", column, order: K1 },
    })
    expect(p).toEqual({ rows: {}, columns: 0, lost: [] })
  })
})
