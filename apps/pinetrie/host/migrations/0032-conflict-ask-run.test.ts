import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { SESSION_TARGET } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { CONFLICT_ASK } from "@pinetrie/rules"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { conflictAskRunMigration } from "./0032-conflict-ask-run.ts"

test("every stored ask is deleted", async () => {
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: createInMemoryStore(),
  })
  const session = exchange.get(SESSION_DOC_ID, SessionDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)
  applyRecordWrites(session, [
    {
      kind: "set",
      target: SESSION_TARGET,
      namespace: CONFLICT_ASK.namespace,
      key: "t-0123456789abcdef",
      value: { at: 7 },
    },
  ])
  const run = () =>
    conflictAskRunMigration.run({
      exchange,
      docIds: [SESSION_DOC_ID],
      hydrated: id => exchange.whenHydrated(id),
    })
  await (await run())?.()
  expect(readNamespace(session, CONFLICT_ASK.namespace)).toEqual({})
  expect(await run()).toBeNull()
})
