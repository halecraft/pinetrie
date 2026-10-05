// A commit's writes as document operations and arrivals (`planCommit`).
import {
  appendList,
  deleteList,
  deleteValue,
  insertEntry,
  insertUsage,
  list,
  prepareStorageCommit,
  setValue,
  value,
} from "@earendil-works/pi-agent-core"
import { physicalKey } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { CHECKPOINT_NAMESPACE } from "./checkpoint.ts"
import { planCommit } from "./commit.ts"
import { emptyUsage } from "./deep.ts"

const counting = () => {
  let n = 0
  return () => `t${n++}`
}

test("planCommit: one operation and one arrival per write, with pi's seqs", () => {
  const usage = { ...emptyUsage(), input: 2 }
  const { writes } = prepareStorageCommit(
    [
      insertEntry({
        id: "e1",
        parentId: null,
        type: "message",
        message: { role: "user", content: "hi", timestamp: 1 },
      }),
      insertEntry({
        id: "e2",
        parentId: "e1",
        type: "custom",
        customType: "note",
        data: 1,
      }),
      insertUsage({ id: "u1", usage, adjustment: false }),
      setValue(value("ns", "k"), { a: 1 }),
      setValue(value(CHECKPOINT_NAMESPACE, "op:call"), {
        content: [{ type: "text", text: "out" }],
      }),
      appendList(list("ns", "l"), "x"),
      deleteList(list("ns", "gone")),
      deleteValue(value("ns", "k")),
    ],
    10,
    1000,
  )
  const { ops, batch } = planCommit(writes, {
    refOf: () => undefined,
    token: counting(),
  })

  expect(ops.map(op => op.kind)).toEqual([
    "entry",
    "entry",
    "usage",
    "value",
    "value",
    "element",
    "delete",
    "delete",
  ])
  expect(batch.arrivals).toEqual([
    { kind: "entry", id: "e1", seq: 10, message: true },
    { kind: "entry", id: "e2", seq: 11, message: false },
    { kind: "usage", id: "u1", seq: 12, usage },
    { kind: "value", pkey: physicalKey("ns", "k"), seq: 13, wid: "t0" },
    {
      kind: "value",
      pkey: physicalKey(CHECKPOINT_NAMESPACE, "op:call"),
      seq: 14,
      wid: "t1",
    },
    { kind: "element", pkey: physicalKey("ns", "l"), eid: "t2", seq: 15 },
    { kind: "gone", field: "lists", pkey: physicalKey("ns", "gone") },
    { kind: "gone", field: "values", pkey: physicalKey("ns", "k") },
  ])
  expect(batch.through).toBe(17)

  const [, , , plain, checkpoint] = ops
  expect(plain).toMatchObject({
    text: undefined,
    record: { value: { a: 1 }, wid: "t0" },
  })
  expect(plain?.kind === "value" && "sealed" in plain.record).toBe(false)
  expect(checkpoint).toMatchObject({ text: "out", record: { sealed: true } })
})
