import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch, json, Schema } from "@kyneta/schema"
import {
  canvasIdFor,
  SESSION_TARGET,
  type Workflow,
  workflowStateIdFor,
} from "@pinetrie/core"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readWorkflow } from "@pinetrie/reads"
import { CARD_HISTORY, setRecord, TRACE, WORKFLOW } from "@pinetrie/rules"
import {
  applyRecordWrites,
  PlacesDoc,
  PlacesDocBeforeCanvas,
  SessionDoc,
} from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { planCanvasPlaces } from "./0019-canvas-places.ts"
import { migrate, planStoredOpen, readStored } from "./index.ts"

const exchangeOn = (store: ReturnType<typeof createInMemoryStore>) =>
  new Exchange({ principal: "host", type: "service", transports: [], store })

/** A stored document under a `moves:` id: its schema is never read. */
const StackStandIn = json.bind(Schema.struct({ n: Schema.number() }))

/** An old row's fields, each empty. */
const EMPTY_ROW = Object.fromEntries(
  [
    "owner",
    "kind",
    "at",
    "lane",
    "column",
    "order",
    "by",
    "seen",
    "command",
    "fact",
    "relay",
    "unsent",
    "placer",
    "holder",
    "task",
    "width",
    "state",
    "address",
    "quote",
    "origin",
  ].map(f => [f, ""]),
)

const K = canvasIdFor("01a0ffd2-0000-7000-8000-000000000001")
const [TOPICS, DOING, OWN, DONE] = ["b", "d", "o", "x"].map(workflowStateIdFor)
const workflow = (backlog: string, doing: string, done: string): Workflow => ({
  open: [
    { id: TOPICS ?? workflowStateIdFor("b"), name: backlog },
    { id: DOING ?? workflowStateIdFor("d"), name: doing },
    { id: OWN ?? workflowStateIdFor("o"), name: "Review" },
  ],
  archive: { id: DONE ?? workflowStateIdFor("x"), name: done },
})

const plan = (input: Partial<Parameters<typeof planCanvasPlaces>[0]>) =>
  planCanvasPlaces({
    rows: {},
    histories: {},
    traces: {},
    workflow: null,
    storedIds: [],
    ...input,
  })

describe("0019-canvas-places", () => {
  test("a place row's task becomes its canvas; a row naming none is left", () => {
    const { rows } = plan({
      rows: {
        "t-1": { kind: "canvas", task: K, order: "a", width: "1" },
        "c-1": { kind: "inventory", holder: "w-ada" },
      },
    })
    expect(rows).toEqual({
      "t-1": { kind: "canvas", canvas: K, order: "a", width: "1" },
    })
  })

  test("a pinned-to-the-task row, trashed or not, becomes pinned-to-the-canvas", () => {
    const { rows } = plan({
      rows: {
        "c-1": { kind: "task-pinned", task: K, order: "a" },
        "c-2": { kind: "discarded-task-pinned", task: K, order: "b" },
      },
    })
    expect(rows).toEqual({
      "c-1": { kind: "canvas-pinned", canvas: K, order: "a" },
      "c-2": { kind: "discarded-canvas-pinned", canvas: K, order: "b" },
    })
  })

  test("an undelivered fact names its canvas", () => {
    const fact = {
      kind: "undelivered",
      why: { kind: "archived", task: K, record: { task: K, by: "w-b", at: 1 } },
    }
    const { rows } = plan({
      rows: { "x-1": { kind: "queued", fact: JSON.stringify(fact) } },
    })
    expect(JSON.parse(String(rows["x-1"]?.fact))).toEqual({
      kind: "undelivered",
      why: {
        kind: "archived",
        canvas: K,
        record: { canvas: K, by: "w-b", at: 1 },
      },
    })
  })

  test("a card-history event and a trace name their canvas", () => {
    const { records } = plan({
      histories: {
        "c-1": {
          events: [
            {
              kind: "moved",
              from: { kind: "task-pinned", task: K },
              to: { kind: "canvas", task: K },
              at: 1,
            },
          ],
        },
        "c-2": {
          events: [{ kind: "created", from: null, to: { kind: "inventory" } }],
        },
      },
      traces: { tr: { from: { kind: "canvas", task: K }, to: null } },
    })
    expect(records).toEqual([
      {
        kind: "set",
        target: SESSION_TARGET,
        namespace: CARD_HISTORY.namespace,
        key: "c-1",
        value: {
          events: [
            {
              kind: "moved",
              from: { kind: "canvas-pinned", canvas: K },
              to: { kind: "canvas", canvas: K },
              at: 1,
            },
          ],
        },
      },
      {
        kind: "set",
        target: SESSION_TARGET,
        namespace: TRACE.namespace,
        key: "tr",
        value: { from: { kind: "canvas", canvas: K }, to: null },
      },
    ])
  })

  test("default state names become Topics, Active and Archive, and no other name changes", () => {
    expect(
      plan({ workflow: workflow("Backlog", "Doing", "Done") }).records,
    ).toEqual([setRecord(WORKFLOW, workflow("Topics", "Active", "Archive"))])
    expect(
      plan({ workflow: workflow("Ideas", "Doing later", "Shipped") }).records,
    ).toEqual([])
  })

  test("a store written before canvases opens with its rows, histories and states renamed, and no undo stack", async () => {
    const store = createInMemoryStore()
    const before = exchangeOn(store)
    const places = before.get(PLACES_DOC_ID, PlacesDocBeforeCanvas)
    await before.whenHydrated(PLACES_DOC_ID)
    batch(places, d =>
      d.cards.set("t-1", { ...EMPTY_ROW, kind: "canvas", task: K, order: "a" }),
    )
    const session = before.get(SESSION_DOC_ID, SessionDoc)
    await before.whenHydrated(SESSION_DOC_ID)
    applyRecordWrites(session, [
      setRecord(WORKFLOW, workflow("Backlog", "Doing", "Done")),
    ])
    const stack = before.get("moves:w-ada@x.io:k-1", StackStandIn)
    await before.whenHydrated("moves:w-ada@x.io:k-1")
    batch(stack, d => d.n.set(1))
    await before.flush()

    const stored = await readStored(store)
    const plan = planStoredOpen(stored)
    if (plan.kind !== "open") throw new Error(`refused: ${plan.kind}`)
    expect(plan.run.map(r => r.migration.name)).toEqual(["0019-canvas-places"])
    const after = exchangeOn(store)
    await migrate({
      plan,
      records: [],
      storedIds: [...stored.keys()],
      exchange: after,
      backup: null,
      log: () => {},
    })
    await after.flush()
    const read = exchangeOn(store)
    const now = read.get(PLACES_DOC_ID, PlacesDoc)
    await read.whenHydrated(PLACES_DOC_ID)
    expect(now.cards()["t-1"]).toMatchObject({
      kind: "canvas",
      canvas: K,
      order: "a",
    })
    const s = read.get(SESSION_DOC_ID, SessionDoc)
    await read.whenHydrated(SESSION_DOC_ID)
    expect(readWorkflow(s)?.open.map(st => st.name)).toEqual([
      "Topics",
      "Active",
      "Review",
    ])
    expect([...(await readStored(store)).keys()]).not.toContain(
      "moves:w-ada@x.io:k-1",
    )
    expect(planStoredOpen(await readStored(store))).toMatchObject({
      kind: "open",
      run: [],
    })
  })
})
