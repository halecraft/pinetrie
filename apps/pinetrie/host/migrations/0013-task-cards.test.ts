import { taskIdFor, workflowStateIdFor, writerId } from "@pinetrie/core"
import { CARD_HISTORY, orderKeys } from "@pinetrie/rules"
import { describe, expect, test } from "vitest"
import {
  BOARD_NAMESPACE,
  planTaskCards,
  TASK_NAMESPACE,
} from "./0013-task-cards.ts"

const [LOW, HIGH] = orderKeys(2) as [string, string]
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const [BACKLOG, DOING, DONE] = ["b", "d", "x"].map(workflowStateIdFor)
const WORKFLOW = {
  open: [
    { id: BACKLOG ?? workflowStateIdFor("b"), name: "Backlog" },
    { id: DOING ?? workflowStateIdFor("d"), name: "Doing" },
  ],
  archive: { id: DONE ?? workflowStateIdFor("x"), name: "Done" },
}
const [K1, K2, K3] = ["1", "2", "3"].map(n =>
  taskIdFor(`01a0ffd2-0000-7000-8000-00000000000${n}`),
)

describe("0013-task-cards (ADR-0126)", () => {
  const plan = planTaskCards({
    tasks: {
      [K1 ?? ""]: { by: ADA, createdAt: 1 },
      [K2 ?? ""]: { by: ADA, createdAt: 2 },
      [K3 ?? ""]: { by: BEA, createdAt: 3 },
      "not-a-task": { by: ADA, createdAt: 4 },
    },
    board: {
      [K1 ?? ""]: { state: DONE, rank: HIGH, by: BEA, at: 9 },
      [K2 ?? ""]: {
        state: workflowStateIdFor("gone"),
        rank: LOW,
        by: BEA,
        at: 5,
      },
    },
    workflow: WORKFLOW,
  })

  test("each task's card is on the board in its place's state at its rank, its opener its owner and its placer the place's mover", () => {
    expect(plan.cards).toMatchObject([
      {
        kind: "task",
        id: K1,
        owner: ADA,
        placer: BEA,
        place: { kind: "board", state: DONE, order: HIGH },
      },
      // In a state gone: the first open state, at its rank.
      { id: K2, place: { kind: "board", state: BACKLOG, order: LOW } },
      // With no place: the end of the first open state, placed by its opener.
      { id: K3, owner: BEA, placer: BEA, place: { state: BACKLOG } },
    ])
    const k3 = plan.cards[2]
    expect(k3?.place.kind === "board" && k3.place.order > LOW).toBe(true)
  })

  test("its history: created by its opener in the first open state, then moved by its placer into its state, so the archive's mover and time read as they were", () => {
    const history = plan.records.find(
      r => r.namespace === CARD_HISTORY.namespace && r.key === K1,
    )
    expect(history).toMatchObject({
      kind: "set",
      value: {
        events: [
          {
            kind: "created",
            by: ADA,
            from: null,
            to: { kind: "board" },
            at: 1,
          },
          { kind: "moved", by: BEA, to: { kind: "board", state: DONE }, at: 9 },
        ],
      },
    })
    expect(
      plan.records.find(
        r => r.namespace === CARD_HISTORY.namespace && r.key === K3,
      ),
    ).toMatchObject({ value: { events: [{ kind: "created" }] } })
  })

  test("both old records are deleted, every key; none is made before there is a workflow", () => {
    const deletes = plan.records.flatMap(r =>
      r.kind === "delete" ? [[r.namespace, r.key]] : [],
    )
    expect(deletes).toEqual([
      [TASK_NAMESPACE, K1],
      [TASK_NAMESPACE, K2],
      [TASK_NAMESPACE, K3],
      [TASK_NAMESPACE, "not-a-task"],
      [BOARD_NAMESPACE, K1],
      [BOARD_NAMESPACE, K2],
    ])
    expect(
      planTaskCards({
        tasks: { [K1 ?? ""]: { by: ADA, createdAt: 1 } },
        board: {},
        workflow: null,
      }).cards,
    ).toEqual([])
  })
})
