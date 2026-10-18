import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { rootDocId, rootIdFor, threadIdFor } from "@pinetrie/core"
import { decodeLand } from "@pinetrie/rules"
import { RootDoc, readEntries } from "@pinetrie/schema"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { landMerged } from "./0007-land-merged.ts"

const ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const LANE = threadIdFor("01a0ffd2-0000-7000-8000-00000000000d")

/** A stored row holding `message`, as pi's storage writes one. */
const row = (id: string, message: object) => ({
  id,
  parentId: null,
  type: "message",
  timestamp: 1,
  fromId: null,
  thread: LANE,
  payload: { type: "message", id, message },
})

/** A land message as stored before the rename. */
const oldLand = {
  role: "custom",
  customType: "pinetrie.land",
  content: "Accepted work was merged…",
  display: true,
  details: { lane: LANE, yours: ["p-1"], files: [], skill: null, by: "ada" },
  timestamp: 1,
}

async function rootWith(rows: readonly ReturnType<typeof row>[]) {
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: createInMemoryStore(),
  })
  const id = rootDocId(ROOT)
  const doc = exchange.get(id, RootDoc)
  await exchange.whenHydrated(id)
  for (const r of rows) writeEntry(doc, r)
  const run = () =>
    landMerged.run({
      exchange,
      docIds: [id, "pinetrie:session"],
      hydrated: d => exchange.whenHydrated(d),
    })
  const message = (entry: string) =>
    (readEntries(doc)[entry]?.payload as { message?: unknown } | undefined)
      ?.message
  return { run, message }
}

test("an old land message decodes again once its merged state is renamed", async () => {
  const root = await rootWith([row("e-1", oldLand)])
  expect(decodeLand(root.message("e-1"))).toBeUndefined()
  await (await root.run())?.()
  expect(decodeLand(root.message("e-1"))).toMatchObject({ merged: ["p-1"] })
  expect(root.message("e-1")).toMatchObject({
    content: "Accepted work was merged…",
  })
})

test("another kind of message, or a land already renamed, needs nothing", async () => {
  const { yours, ...details } = oldLand.details
  const root = await rootWith([
    row("e-1", { ...oldLand, details: { ...details, merged: yours } }),
    row("e-2", { ...oldLand, customType: "pinetrie.update" }),
    row("e-3", { role: "user", content: "yours" }),
  ])
  expect(await root.run()).toBeNull()
})
