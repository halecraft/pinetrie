import {
  type ArchivedTask,
  type CardRecord,
  type ThreadName,
  taskIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { threadCardOf } from "./fixtures.ts"
import { awayWords, reachableAgents, reachWords, threadReach } from "./reach.ts"
import { indexTasks } from "./task.ts"

const ada = writerId("ada@example.com")
const bea = writerId("bea@example.com")
const open = taskIdFor("01a00000-0000-7000-8000-0000000000a1")
const done = taskIdFor("01a00000-0000-7000-8000-0000000000a2")
const fox = threadIdFor("fox")
const owl = threadIdFor("owl")
const elk = threadIdFor("elk")
const unnamed = threadIdFor("unnamed")
const cards: CardRecord[] = []
for (const [thread, task] of [
  [fox, open],
  [unnamed, open],
  [owl, done],
] as const)
  cards.push(threadCardOf({ thread, task, by: ada, cards }))
const held: CardRecord = {
  ...threadCardOf({ thread: elk, task: open, by: ada, cards }),
  place: { kind: "inventory", holder: bea, slot: 0 },
} as CardRecord
const all = [...cards, held]
const record: ArchivedTask = { task: done, by: ada, at: 1 }
const archived = new Map([[done, record]])
const names = new Map([
  [fox, "amber-fox" as ThreadName],
  [owl, "slate-owl" as ThreadName],
  [elk, "jolly-elk" as ThreadName],
])

describe("where a thread is (ADR-0128)", () => {
  test("open, archived with its record, held by whom, or gone", () => {
    const at = (t: typeof fox) => threadReach(t, { cards: all, archived })
    expect(at(fox)).toEqual({ kind: "open", task: open })
    expect(at(owl)).toEqual({ kind: "archived", task: done, record })
    expect(at(elk)).toEqual({ kind: "held", by: bea })
    expect(at(threadIdFor("none"))).toEqual({ kind: "gone" })
  })
  test("each away reach in words, a sentence and a few", () => {
    const nameOf = (w: typeof ada) => (w === ada ? "Ada" : "Bea")
    expect(
      reachWords("slate-owl", { kind: "archived", task: done, record }, nameOf),
    ).toBe("slate-owl's task was archived by Ada")
    expect(reachWords("jolly-elk", { kind: "held", by: bea }, nameOf)).toBe(
      "Bea has jolly-elk",
    )
    expect(reachWords("x", { kind: "gone" }, nameOf)).toBe(
      "x is no longer on any task",
    )
    expect(awayWords({ kind: "held", by: bea }, nameOf)).toBe("Bea has it")
  })
  test("in reach: named threads of open tasks; not an archived task's, an inventory's, or an unnamed one", () => {
    const { canvases } = indexTasks(all, new Map())
    expect(
      reachableAgents({ canvases, archived, names }).map(a => a.name),
    ).toEqual(["amber-fox"])
  })
})
