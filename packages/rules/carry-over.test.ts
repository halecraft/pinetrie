import {
  entryId,
  type RootId,
  type RootRecord,
  rootIdFor,
  writerId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { BOARD, WORKFLOW } from "./board.ts"
import { ARCHIVE, carryOverWrites, planCarryOver } from "./carry-over.ts"
import { recordsOf } from "./records.ts"

const ADA = writerId("ada@x.io")
const HOST = writerId("host@pinetrie")
const R = (n: number) =>
  rootIdFor(`01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`)
const rootAt = (
  root: RootId,
  entry: string | null,
  writers = [ADA],
): [RootId, RootRecord] => [
  root,
  {
    root,
    entry: entry === null ? null : entryId(entry),
    first: null,
    firstLine: "",
    title: null,
    messages: 0,
    newest: null,
    writers,
    threads: {},
    mentions: [],
    images: [],
  },
]
const roots = new Map([
  rootAt(R(1), "e-1"),
  rootAt(R(2), "e-2"),
  rootAt(R(3), null, []),
])
const archive = new Map([
  [
    entryId("e-1"),
    { root: entryId("e-1"), state: "archived" as const, by: ADA, at: 7 },
  ],
  [
    entryId("e-2"),
    { root: entryId("e-2"), state: "restored" as const, by: ADA, at: 8 },
  ],
])

test("the default workflow; archived roots in Done, by who archived them; the rest in Doing, by their first writer; the old records deleted", () => {
  let n = 0
  const plan = planCarryOver({
    workflow: null,
    roots,
    archive,
    host: HOST,
    now: 9,
    newId: () => `${n++}`,
  })
  if (plan === null) throw new Error("no plan")
  const writes = carryOverWrites(plan)
  const sets = writes.flatMap(w => (w.kind === "set" ? [w] : []))
  const workflow = recordsOf(WORKFLOW, sets).get("workflow")
  const board = recordsOf(BOARD, sets)
  expect(workflow?.open.map(s => s.name)).toEqual(["Backlog", "Doing"])
  const doing = workflow?.open[1]?.id
  expect(board.get(R(1))).toMatchObject({
    state: workflow?.closed.id,
    by: ADA,
    at: 7,
  })
  expect(board.get(R(2))).toMatchObject({ state: doing, by: ADA, at: 9 })
  expect(board.get(R(3))).toMatchObject({ state: doing, by: HOST })
  expect(
    writes.filter(w => w.kind === "delete").map(w => [w.namespace, w.key]),
  ).toEqual([
    [ARCHIVE.namespace, "e-1"],
    [ARCHIVE.namespace, "e-2"],
  ])
})

test("a store with a workflow is not carried over again", () => {
  const plan = planCarryOver({
    workflow: { open: [], closed: { id: "w-x" as never, name: "Done" } },
    roots,
    archive,
    host: HOST,
    now: 9,
    newId: () => "x",
  })
  expect(plan).toBeNull()
})
