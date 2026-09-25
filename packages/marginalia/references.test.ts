import assert from "node:assert/strict"
import {
  atEntry,
  ERR,
  entryId,
  type LaneName,
  laneNameForWriter,
  ROOT,
  referenceId,
} from "@pineta/core"
import { test } from "vitest"
import {
  decodeReference,
  encodeReference,
  indexReferences,
  planReference,
  type Reference,
} from "./index.ts"

const A: LaneName = laneNameForWriter("a")
const E1 = entryId("e-1")
const E2 = entryId("e-2")
const at = (tip: typeof E1) => ({ kind: "lane", at: atEntry(tip) }) as const
const plan = (over: Partial<Parameters<typeof planReference>[0]>) =>
  planReference({
    author: A,
    lane: at(E2),
    at: { kind: "tip" },
    target: { kind: "entry", id: E1 },
    cited: { kind: "entry", text: "hello" },
    newId: referenceId("r-1"),
    ...over,
  })
const code = (d: ReturnType<typeof planReference>) =>
  d.kind === "refused" ? d.code : "wrote"

test("planReference: attached at the author's lane tip", () => {
  const d = plan({})
  assert.equal(d.kind === "write" ? d.reference.from : "", E2)
  assert.equal(d.kind === "write" ? d.reference.author : "", A)
})

test("planReference: attached where the author reads, with or without a lane", () => {
  const read = { kind: "entry", id: E1 } as const
  const withLane = plan({ at: read })
  const without = plan({ at: read, lane: { kind: "none" } })
  assert.equal(withLane.kind === "write" ? withLane.reference.from : "", E1)
  assert.equal(without.kind === "write" ? without.reference.from : "", E1)
})

test("planReference: no lane, or a lane at the root, has nowhere to attach", () => {
  assert.equal(code(plan({ lane: { kind: "none" } })), ERR.NO_LANE)
  assert.equal(code(plan({ lane: { kind: "lane", at: ROOT } })), ERR.NO_LANE)
})

test("planReference: an absent entry is unknown; a textless one is citable whole", () => {
  assert.equal(code(plan({ cited: { kind: "absent" } })), ERR.UNKNOWN_TARGET)
  // A compaction has no message text. Citing it as a whole is fine...
  assert.equal(
    code(plan({ cited: { kind: "entry", text: undefined } })),
    "wrote",
  )
  // ...but a span on it is an invalid span, not an unknown target.
  assert.equal(
    code(
      plan({
        target: { kind: "span", id: E1, start: 0, end: 1 },
        cited: { kind: "entry", text: undefined },
      }),
    ),
    ERR.INVALID_SPAN,
  )
})

test("planReference: spans must be non-empty and in bounds", () => {
  const span = (start: number, end: number) =>
    plan({ target: { kind: "span", id: E1, start, end } })
  assert.equal(code(span(0, 5)), "wrote")
  assert.equal(code(span(2, 2)), ERR.INVALID_SPAN)
  assert.equal(code(span(3, 1)), ERR.INVALID_SPAN)
  assert.equal(code(span(0, 6)), ERR.INVALID_SPAN)
})

test("planReference: spans are UTF-16 code units, as the client renders them", () => {
  // "a😀" is 2 code points but 3 UTF-16 code units. The emoji ends at 3.
  const d = plan({
    target: { kind: "span", id: E1, start: 1, end: 3 },
    cited: { kind: "entry", text: "a😀" },
  })
  assert.equal(code(d), "wrote")
})

const ref = (id: string, from: typeof E1, to: typeof E1): Reference => ({
  id: referenceId(id),
  from,
  to: { kind: "entry", id: to },
  author: A,
})

test("indexReferences: both directions, ascending id, input order irrelevant", () => {
  const refs = [ref("r-3", E2, E1), ref("r-1", E2, E1), ref("r-2", E1, E2)]
  for (const order of [refs, [...refs].reverse()]) {
    const ix = indexReferences(order)
    assert.deepEqual(
      ix.to.get(E1)?.map(r => r.id),
      ["r-1", "r-3"],
    )
    assert.deepEqual(
      ix.from.get(E2)?.map(r => r.id),
      ["r-1", "r-3"],
    )
    assert.deepEqual(
      ix.to.get(E2)?.map(r => r.id),
      ["r-2"],
    )
  }
})

test("decodeReference: round-trips, and drops a malformed value", () => {
  const r = ref("r-9", E2, E1)
  assert.deepEqual(decodeReference(encodeReference(r)), r)
  assert.equal(decodeReference({ id: "x" }), undefined)
  assert.equal(decodeReference(null), undefined)
  assert.equal(
    decodeReference({ ...encodeReference(r), to: { kind: "file" } }),
    undefined,
  )
})
