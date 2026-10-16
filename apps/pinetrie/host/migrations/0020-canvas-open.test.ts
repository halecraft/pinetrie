import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import { writerId } from "@pinetrie/core"
import { personDocId } from "@pinetrie/protocol/writers"
import { OpenDoc, OpenDocBeforeCanvas } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { planCanvasOpen } from "./0020-canvas-open.ts"
import { migrate, planStoredOpen, readStored } from "./index.ts"

const exchangeOn = (store: ReturnType<typeof createInMemoryStore>) =>
  new Exchange({ principal: "host", type: "service", transports: [], store })

describe("0020-canvas-open", () => {
  test("planCanvasOpen: each old canvas the new field lacks, at its key", () => {
    expect(
      planCanvasOpen({ a: "1", b: "2", c: "3" }, { a: "1", b: "9" }),
    ).toEqual([
      ["b", "2"],
      ["c", "3"],
    ])
  })

  test("an open list keeps its canvases and their order; a second start plans nothing", async () => {
    const store = createInMemoryStore()
    const id = personDocId("open", writerId("ada@x.io"))
    const before = exchangeOn(store)
    const old = before.get(id, OpenDocBeforeCanvas)
    await before.whenHydrated(id)
    batch(old, d => {
      d.tasks.set("k-1", "a0")
      d.tasks.set("k-2", "a1")
    })
    await before.flush()

    const plan = planStoredOpen(await readStored(store))
    if (plan.kind !== "open") throw new Error(`refused: ${plan.kind}`)
    expect(plan.run.map(r => [r.migration.name, r.docIds])).toEqual([
      ["0020-canvas-open", [id]],
    ])
    const after = exchangeOn(store)
    await migrate({
      plan,
      records: [],
      storedIds: [id],
      exchange: after,
      backup: null,
      log: () => {},
    })
    const doc = after.get(id, OpenDoc)
    await after.whenHydrated(id)
    expect(doc.canvases()).toEqual({ "k-1": "a0", "k-2": "a1" })
    await after.flush()

    expect(planStoredOpen(await readStored(store))).toMatchObject({
      kind: "open",
      run: [],
    })
  })
})
