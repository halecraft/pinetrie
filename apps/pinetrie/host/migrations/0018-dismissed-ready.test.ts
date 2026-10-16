import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { batch, createDoc, exportEntirety } from "@kyneta/schema"
import { writerId } from "@pinetrie/core"
import { personDocId } from "@pinetrie/protocol/writers"
import { AttentionDoc, AttentionDocBeforeReady } from "@pinetrie/schema"
import { describe, expect, test } from "vitest"
import { dismissedReady, planDismissedReady } from "./0018-dismissed-ready.ts"
import { migrate, planStoredOpen, readStored } from "./index.ts"

const exchangeOn = (store: ReturnType<typeof createInMemoryStore>) =>
  new Exchange({ principal: "host", type: "service", transports: [], store })

describe("0018-dismissed-ready", () => {
  test("planDismissedReady: each old dismissal the new field lacks", () => {
    expect(
      planDismissedReady({ a: "c1", b: "c2", c: "c3" }, { a: "c1", b: "c9" }),
    ).toEqual([
      ["b", "c2"],
      ["c", "c3"],
    ])
  })

  test("each dismissal the old schema stored is written under dismissedReady", async () => {
    const old = createDoc(AttentionDocBeforeReady)
    batch(old, d => {
      d.dismissedOffers.set("lane-a", "c1")
      d.dismissedOffers.set("lane-b", "c2")
    })
    // Made from a snapshot, the new schema reads the old field as empty.
    const doc = createDoc(AttentionDoc, exportEntirety(old))
    expect(doc.dismissedReady()).toEqual({})
    const exchange = { get: () => doc } as unknown as Exchange
    const write = await dismissedReady.run?.({
      exchange,
      docIds: ["attention:ada@x.io"],
      hydrated: async () => {},
    })
    await write?.()
    expect(doc.dismissedReady()).toEqual({ "lane-a": "c1", "lane-b": "c2" })
  })

  test("a store written before the rename opens with each dismissal under dismissedReady; a second start plans nothing", async () => {
    const store = createInMemoryStore()
    const id = personDocId("attention", writerId("ada@x.io"))
    const before = exchangeOn(store)
    const old = before.get(id, AttentionDocBeforeReady)
    await before.whenHydrated(id)
    batch(old, d => {
      d.since.set("e-1")
      d.dismissedOffers.set("lane-a", "c1")
      d.dismissedOffers.set("lane-b", "c2")
    })
    await before.flush()

    const plan = planStoredOpen(await readStored(store))
    if (plan.kind !== "open") throw new Error(`refused: ${plan.kind}`)
    expect(plan.run.map(r => [r.migration.name, r.docIds])).toEqual([
      ["0018-dismissed-ready", [id]],
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
    const doc = after.get(id, AttentionDoc)
    await after.whenHydrated(id)
    expect(doc.dismissedReady()).toEqual({ "lane-a": "c1", "lane-b": "c2" })
    expect(doc.since()).toBe("e-1")
    await after.flush()

    const again = planStoredOpen(await readStored(store))
    expect(again).toMatchObject({ kind: "open", run: [] })
  })
})
