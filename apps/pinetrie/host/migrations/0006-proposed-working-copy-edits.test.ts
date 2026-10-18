import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { SESSION_TARGET, threadIdFor } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readProposedByLane } from "@pinetrie/reads"
import { PROPOSED_CHANGES } from "@pinetrie/rules"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { proposedWorkingCopyEdits } from "./0006-proposed-working-copy-edits.ts"

const LANE = threadIdFor("01a0ffd2-0000-7000-8000-00000000000b")

// A jj lane's proposed changes as stored before the rename.
const OLD = {
  kind: "jj",
  size: 1,
  stale: false,
  files: ["a.ts"],
  conflicts: [],
  startConflicts: [],
  yourEdits: ["a.ts"],
  described: true,
  edited: false,
  bookmark: "pinetrie-proposed/amber-fox",
  acceptedAs: null,
  commits: ["c1"],
  ledger: null,
  at: 1,
}

async function sessionWith(record: object) {
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: createInMemoryStore(),
  })
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  await exchange.whenHydrated(SESSION_DOC_ID)
  applyRecordWrites(doc, [
    {
      kind: "set",
      target: SESSION_TARGET,
      namespace: PROPOSED_CHANGES.namespace,
      key: LANE,
      value: record,
    },
  ])
  const run = () =>
    proposedWorkingCopyEdits.run({
      exchange,
      docIds: [SESSION_DOC_ID],
      hydrated: id => exchange.whenHydrated(id),
    })
  return { doc, run }
}

test("an old proposed changes record decodes again once its working copy's edits are renamed", async () => {
  const { doc, run } = await sessionWith(OLD)
  expect(readProposedByLane(doc).has(LANE)).toBe(false)
  await (await run())?.()
  expect(readProposedByLane(doc).get(LANE)).toMatchObject({
    workingCopyEdits: ["a.ts"],
  })
  expect(
    readNamespace(doc, PROPOSED_CHANGES.namespace)[LANE],
  ).not.toHaveProperty("yourEdits")
})

test("a record already renamed needs nothing", async () => {
  const { yourEdits, ...rest } = OLD
  const { run } = await sessionWith({ ...rest, workingCopyEdits: yourEdits })
  expect(await run()).toBeNull()
})
