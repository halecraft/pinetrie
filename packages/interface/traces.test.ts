import {
  entryId,
  rootIdFor,
  type TracedPlace,
  type TraceRecord,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import { endTraces, keptTraces, seenBatches, traceGroups } from "./traces.ts"

const _ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const CAL = writerId("cal@x.io")
const HERE = entryId("e-here")
/** Pinned at the thread named for the entry its end is. */
const at = (id: string): TracedPlace => ({
  kind: "pinned",
  thread: threadIdFor(id),
})
const queued: TracedPlace = {
  kind: "queued",
  thread: threadIdFor("x"),
  seen: "",
}
const trace = (over: Partial<TraceRecord>): TraceRecord => ({
  id: "t",
  for: ADA,
  card: cardIdFor("c1"),
  by: BEA,
  from: at("e-here"),
  to: queued,
  message: null,
  at: 1,
  ...over,
})

test("endTraces: yours, whose place resolves to this end, oldest first", () => {
  const endOf = (from: TracedPlace) =>
    from.kind === "pinned" ? entryId(from.thread.slice(2)) : null
  const traces = [
    trace({ id: "late", at: 3 }),
    trace({ id: "early", at: 1 }),
    trace({ id: "not-yours", for: BEA }),
    trace({ id: "elsewhere", from: at("e-other") }),
  ]
  expect(endTraces(traces, ADA, HERE, endOf).map(t => t.id)).toEqual([
    "early",
    "late",
  ])
})

test("traceGroups: one line per person and verb, in the order each first happened", () => {
  const groups = traceGroups([
    trace({ id: "1" }),
    trace({ id: "2", by: CAL, to: { kind: "inventory", holder: CAL } }),
    trace({ id: "3" }),
    trace({ id: "4", to: null }),
  ])
  expect(groups.map(g => [g.by, g.verb, g.traces.map(t => t.id)])).toEqual([
    [BEA, "queued", ["1", "3"]],
    [CAL, "took-into-inventory", ["2"]],
    [BEA, "sent", ["4"]],
  ])
})

test("keptTraces: what was drawn stays after the host deletes it, once each", () => {
  const drawn = new Map([["1", trace({ id: "1", at: 1 })]])
  expect(
    keptTraces(drawn, [
      trace({ id: "2", at: 2 }),
      trace({ id: "1", at: 1 }),
    ]).map(t => t.id),
  ).toEqual(["1", "2"])
  expect(keptTraces(drawn, []).map(t => t.id)).toEqual(["1"])
})

test("seenBatches: no request names more ids than the host takes", () => {
  expect(seenBatches(["a", "b", "c", "d", "e"], 2)).toEqual([
    ["a", "b"],
    ["c", "d"],
    ["e"],
  ])
  expect(seenBatches([])).toEqual([])
})
