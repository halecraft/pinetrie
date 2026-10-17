import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { SESSION_TARGET, type ValueWrite } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { RUN_END_REPORT } from "@pinetrie/rules"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { runEndReport, runEndReportMove } from "./0024-run-end-report.ts"

const OLD = "pinetrie.verdict"
const NEW = RUN_END_REPORT.namespace

/** What a stored verdict moves to: the new record's set and the old one's delete. */
const moved = (lane: string, value: object): readonly ValueWrite[] => [
  { kind: "set", target: SESSION_TARGET, namespace: NEW, key: lane, value },
  { kind: "delete", target: SESSION_TARGET, namespace: OLD, key: lane },
]

async function storeWith(stored: Record<string, unknown>) {
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: createInMemoryStore(),
  })
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)
  applyRecordWrites(
    doc,
    Object.entries(stored).map(([key, value]) => ({
      kind: "set" as const,
      target: SESSION_TARGET,
      namespace: OLD,
      key,
      value,
    })),
  )
  const run = () =>
    runEndReport.run({
      exchange,
      docIds: [SESSION_DOC_ID, "pinetrie:places"],
      hydrated: id => exchange.whenHydrated(id),
    })
  return {
    run,
    old: () => readNamespace(doc, OLD),
    now: () => readNamespace(doc, NEW),
  }
}

test("each stored report moves to the new namespace, and the old one is deleted", async () => {
  const store = await storeWith({
    "t-1": { ask: "p-1", end: "e-1", verdict: { kind: "pending" } },
  })
  await (await store.run())?.()
  expect(store.now()).toEqual({
    "t-1": { ask: "p-1", end: "e-1", report: { kind: "pending" } },
  })
  expect(RUN_END_REPORT.decode(store.now()["t-1"], "t-1")).toEqual({
    lane: "t-1",
    ask: "p-1",
    end: "e-1",
    report: { kind: "pending" },
  })
})

test("a moved run-end report leaves nothing under the old namespace", async () => {
  const store = await storeWith({
    "t-1": { ask: "p-1", end: "e-1", verdict: { kind: "unclassified" } },
    "t-2": { ask: "p-2", end: "e-2", verdict: { kind: "pending" } },
  })
  await (await store.run())?.()
  expect(store.old()).toEqual({})
  expect(await store.run()).toBeNull()
})

test("a model's urgency moves with its reason", () => {
  expect(
    runEndReportMove({
      "t-1": {
        ask: "p-1",
        end: "e-1",
        verdict: { kind: "said", said: "needsYou", reason: "pick a name" },
      },
      "t-2": {
        ask: "p-2",
        end: "e-2",
        verdict: { kind: "said", said: "done", reason: null },
      },
    }),
  ).toEqual([
    ...moved("t-1", {
      ask: "p-1",
      end: "e-1",
      report: { kind: "modelSaid", urgency: "needsYou", reason: "pick a name" },
    }),
    ...moved("t-2", {
      ask: "p-2",
      end: "e-2",
      report: { kind: "modelSaid", urgency: "done", reason: null },
    }),
  ])
})

test("a failed, stopped, pending or unclassified report keeps its fields", () => {
  const reports = [
    { kind: "failed", error: "rate limited" },
    { kind: "stopped", by: "ada@x.io" },
    { kind: "stopped", by: null },
    { kind: "pending" },
    { kind: "unclassified" },
  ]
  expect(
    runEndReportMove(
      Object.fromEntries(
        reports.map((verdict, i) => [
          `t-${i}`,
          { ask: "p", end: "e", verdict },
        ]),
      ),
    ),
  ).toEqual(
    reports.flatMap((report, i) =>
      moved(`t-${i}`, { ask: "p", end: "e", report }),
    ),
  )
})

test("a record in no known shape is not moved", () => {
  expect(
    runEndReportMove({
      "t-1": {
        ask: "p-1",
        end: "e-1",
        verdict: { kind: "said", said: "maybe" },
      },
      "t-2": { ask: "p-2", verdict: { kind: "pending" } },
      "t-3": { ask: "p-3", end: "e-3", verdict: { kind: "guessed" } },
      "t-4": "pending",
    }),
  ).toEqual([])
})

test("a store with no old records needs nothing", async () => {
  const store = await storeWith({})
  expect(await store.run()).toBeNull()
})
