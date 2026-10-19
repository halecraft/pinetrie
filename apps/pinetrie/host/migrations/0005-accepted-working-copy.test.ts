import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { SESSION_TARGET } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readAccepted } from "@pinetrie/reads"
import { ACCEPTED, ACCEPTED_KEY } from "@pinetrie/rules"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { acceptedWorkingCopy } from "./0005-accepted-working-copy.ts"

// Accepted work's record as stored before the rename, the old field and all.
const OLD = {
  kind: "jj",
  acceptedBookmark: "pinetrie-accepted",
  wipPrefix: "wip/",
  publish: "main",
  publishCatchesUp: true,
  commit: null,
  heads: { current: null, proposed: "trunk()" },
  log: { current: null, proposed: "logged" },
  unfinishedWork: [],
  published: { commit: null, behind: 0, ahead: 0 },
  yours: {
    behind: 1,
    ahead: 2,
    getLatest: null,
    conflicts: { commits: 0, files: [] },
  },
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
      namespace: ACCEPTED.namespace,
      key: ACCEPTED_KEY,
      value: record,
    },
  ])
  const run = () =>
    acceptedWorkingCopy.run({
      exchange,
      docIds: [SESSION_DOC_ID],
      hydrated: id => exchange.whenHydrated(id),
    })
  return { doc, run }
}

test("an old accepted record decodes again once its working copy is renamed", async () => {
  const { doc, run } = await sessionWith(OLD)
  expect(readAccepted(doc)).toBeNull()
  await (await run())?.()
  expect(readAccepted(doc)).toMatchObject({
    workingCopy: { behind: 1, ahead: 2 },
  })
  expect(
    readNamespace(doc, ACCEPTED.namespace)[ACCEPTED_KEY],
  ).not.toHaveProperty("yours")
})

test("a record already renamed needs nothing", async () => {
  const { yours, ...rest } = OLD
  const { run } = await sessionWith({ ...rest, workingCopy: yours })
  expect(await run()).toBeNull()
})
