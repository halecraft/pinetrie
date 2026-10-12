import {
  cardIdOfKind,
  rootIdFor,
  taskIdFor,
  threadIdFor,
  workflowStateIdFor,
} from "@pinetrie/core"
import { cardIdFor, taskCard } from "@pinetrie/core/fixtures"
import { CARD_HISTORY, decodeCard, THREAD } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import { planUnstartedThreads } from "./0012-unstarted-threads.ts"
import { oldTrashRows } from "./0014-trash-left.ts"

const ADA = "w-ada@x.io"
const ROW = {
  owner: ADA,
  placer: ADA,
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
  holder: "",
  task: "",
  width: "",
  address: "",
  quote: "",
  origin: "",
}
const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const NEW_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEW_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const BRANCH = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f1")
const TAB = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f2")
const SPUN = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f3")
const [M1, M2, M3, S1, ASK] = [
  cardIdFor("c1"),
  cardIdFor("c2"),
  cardIdFor("c3"),
  cardIdFor("c4"),
  cardIdOfKind("ask", "01a0ffd2-0000-7000-8000-0000000000e1"),
]
const fresh = (column: string, root: string, task: string, at: string) => ({
  ...ROW,
  kind: "fresh",
  column,
  root,
  task,
  at,
})
const RELAY = JSON.stringify({
  from: BRANCH,
  fromName: "sable-meadow",
  source: "5",
  asker: { kind: "agent", thread: BRANCH },
  askerName: "sable-meadow",
  text: "hi",
  budget: "1",
  by: ADA,
})
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a9",
)
const plan = () =>
  planUnstartedThreads({
    rows: {
      // A branch's fresh column with two of Ada's cards; a new tab's with one.
      [M1]: fresh(BRANCH, ROOT, TASK, "e-1"),
      [M2]: fresh(BRANCH, ROOT, TASK, "e-1"),
      [M3]: fresh(TAB, NEW_ROOT, NEW_TASK, ""),
      // A card spun into a thread, and an ask with its relay in `fact`.
      [S1]: {
        ...ROW,
        kind: "spun",
        task: TASK,
        holder: ADA,
        lane: SPUN,
        column: NEW_ROOT,
      },
      [ASK]: {
        ...ROW,
        kind: "queued",
        lane: BRANCH,
        order: "a",
        by: ADA,
        fact: RELAY,
      },
    },
    threads: new Set(),
    taskCards: [taskCard(TASK, "a", workflowStateIdFor("d"))],
    workflow: {
      open: [{ id: workflowStateIdFor("d"), name: "Doing" }],
      archive: { id: workflowStateIdFor("x"), name: "Done" },
    },
    histories: {
      [M1]: {
        events: [
          { kind: "followed", by: null, from: null, to: {}, at: 1 },
          { kind: "moved", by: ADA, from: null, to: {}, at: 2 },
        ],
      },
      [M3]: { events: [{ kind: "moved", by: ADA, from: null, to: {}, at: 2 }] },
    },
    now: 9,
    newColumn: () => NOTES,
  })

describe("0012-unstarted-threads (ADR-0126)", () => {
  test("a fresh column becomes its thread opened, a new tab's task's card with it; your newest card is your message on its dock, the rest notes", () => {
    const { rows, records } = plan()
    const sets = records.flatMap(r =>
      r.kind === "set" ? [[r.namespace, r.key] as const] : [],
    )
    expect(sets).toEqual(
      expect.arrayContaining([
        [THREAD.namespace, BRANCH],
        [THREAD.namespace, TAB],
      ]),
    )
    expect(
      records.find(r => r.kind === "set" && r.key === BRANCH),
    ).toMatchObject({
      value: { root: ROOT, origin: { kind: "fork", at: "e-1", how: "branch" } },
    })
    const card = (id: string) => decodeCard(id, rows[id])
    expect(card(BRANCH)?.place).toMatchObject({ kind: "canvas", task: TASK })
    expect(card(TAB)?.place).toMatchObject({ kind: "canvas", task: NEW_TASK })
    expect(card(M2)?.place).toEqual({ kind: "composing", thread: BRANCH })
    expect(card(M1)?.place).toMatchObject({ kind: "note", column: NOTES })
    expect(card(M3)?.place).toEqual({ kind: "composing", thread: TAB })
    expect(card(NOTES)?.place).toMatchObject({ kind: "canvas", task: TASK })
    expect(card(TASK)?.place).toMatchObject({ kind: "board" })
    expect(card(NEW_TASK)?.place).toMatchObject({
      kind: "board",
      state: workflowStateIdFor("d"),
    })
  })

  test("a spun card is in its spinner's trash, in the old shape 0014-trash-left deletes; an ask's relay is in `relay`; no row keeps a root", () => {
    const { rows } = plan()
    expect(rows[S1]).toMatchObject({ kind: "discarded", holder: ADA })
    expect(oldTrashRows({ s: rows[S1] ?? {} })).toEqual(["s"])
    expect(decodeCard(ASK, rows[ASK])).toMatchObject({
      kind: "ask",
      content: { relay: { text: "hi" } },
    })
    expect(Object.values(rows).every(r => !("root" in r))).toBe(true)
  })

  test("a history's followed event reads moved; one with none is left", () => {
    const { records } = plan()
    const histories = records.filter(
      r => r.namespace === CARD_HISTORY.namespace,
    )
    expect(histories).toMatchObject([
      { key: M1, value: { events: [{ kind: "moved" }, { kind: "moved" }] } },
    ])
  })
})
