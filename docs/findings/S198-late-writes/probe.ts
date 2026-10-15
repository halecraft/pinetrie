// What a late write does to a root the host let go of. Run from
// apps/pinetrie/host/ as a `.test.ts`: its imports are that directory's.

import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { entryId, rootDocId, runId, threadIdFor } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { readDigests, readTreeIndex, readVerdicts } from "@pinetrie/reads"
import { DIGEST, pendingVerdict, setRecord, VERDICT } from "@pinetrie/rules"
import { applyRecordWrites, newPresenceDoc } from "@pinetrie/schema"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { test } from "vitest"
import { createDigests } from "./digests.ts"
import { hostDocuments } from "./docs.ts"
import { basics, ROOT_ID, row } from "./fakes.ts"
import { createRecords } from "./records.ts"
import { endRun } from "./runs.ts"

const lane = threadIdFor("0123456789abcdef")
const DIGEST_E1 = (headline: string) =>
  setRecord(
    DIGEST,
    { prompt: entryId("e-1"), headline, points: [], at: 1, final: true },
    ROOT_ID,
  )

function world() {
  const fake = basics()
  const store = createInMemoryStore()
  const exchange = new Exchange({ principal: "pinetrie-host", store })
  const docs = hostDocuments({
    exchange,
    session: fake.session,
    live: fake.live,
    places: fake.places,
  })
  const opened: string[] = []
  docs.onOpened(root => opened.push(root))
  const records = createRecords(docs)
  const b = { ...fake, docs }
  return { b, exchange, store, docs, records, opened }
}

async function withThread(w: ReturnType<typeof world>) {
  const doc = await w.docs.root(ROOT_ID)
  writeEntry(doc, row(entryId("e-1"), null))
  for (const [id, parent, content] of [
    ["e-2", "e-1", "looking"],
    ["e-3", "e-2", "editing"],
    ["e-4", "e-3", "checking"],
  ] as const)
    writeEntry(doc, row(entryId(id), parent, { role: "assistant", content }))
  writeLaneTip(doc, lane, entryId("e-4"))
  await w.exchange.flush()
  return doc
}

const stored = async (w: ReturnType<typeof world>) => {
  for await (const id of w.store.listDocIds())
    if (id === rootDocId(ROOT_ID)) return true
  return false
}

test("Q1: a held handle after unload: reads, and writes", async () => {
  const w = world()
  const doc = await withThread(w)
  await w.docs.unload(ROOT_ID)
  await w.exchange.flush()
  let read: unknown
  try {
    read = { ok: readTreeIndex(doc).roots, digests: [...readDigests(doc)] }
  } catch (e) {
    read = { threw: String(e) }
  }
  let wrote: unknown
  try {
    applyRecordWrites(doc, [DIGEST_E1("late")])
    wrote = "ok"
  } catch (e) {
    wrote = { threw: String(e) }
  }
  console.log("Q1", JSON.stringify({ read, wrote }))
})

test("Q2: a root record written after unload", async () => {
  const w = world()
  await withThread(w)
  await w.docs.unload(ROOT_ID)
  await w.exchange.flush()
  const before = { loaded: w.docs.loaded(), opened: [...w.opened] }
  await w.records.writeValues([DIGEST_E1("late")])
  await w.exchange.flush()
  const doc = await w.docs.root(ROOT_ID)
  console.log(
    "Q2",
    JSON.stringify({
      before,
      after: { loaded: w.docs.loaded(), opened: w.opened },
      entries: readTreeIndex(doc).roots,
      digest: readDigests(doc).get(entryId("e-1"))?.headline,
    }),
  )
})

test("Q3: a root record written after destroy", async () => {
  const w = world()
  await withThread(w)
  await w.docs.destroy(ROOT_ID)
  await w.exchange.flush()
  const before = { loaded: w.docs.loaded(), stored: await stored(w) }
  let result: unknown = "ok"
  try {
    await w.records.writeValues([DIGEST_E1("late")])
  } catch (e) {
    result = { threw: String(e) }
  }
  await w.exchange.flush()
  const after = { loaded: w.docs.loaded(), stored: await stored(w) }
  const doc = w.docs.view(ROOT_ID)?.doc
  console.log(
    "Q3",
    JSON.stringify({
      before,
      result,
      after,
      entries: doc === undefined ? null : readTreeIndex(doc).roots,
      digest:
        doc === undefined
          ? null
          : readDigests(doc).get(entryId("e-1"))?.headline,
    }),
  )
})

test("Q4: a run's end digest whose request is out when the root is unloaded", async () => {
  const w = world()
  await withThread(w)
  beginRun(w.b.live, lane, runId("r-1"))
  applyRecordWrites(w.b.session, [
    setRecord(VERDICT, pendingVerdict(lane, entryId("e-1"), entryId("e-4"))),
  ])
  endRun(w.b.live, lane, runId("r-1"))
  const asked = Promise.withResolvers<void>()
  const reply = Promise.withResolvers<string>()
  const keeper = createKeeper()
  const failures: string[] = []
  const digests = createDigests({
    basics: w.b,
    keeper,
    presence: newPresenceDoc(),
    records: w.records,
    piSetup: {
      skill: async () => ({ path: "SKILL.md", content: "S", hash: "h" }),
      complete: async () => {
        asked.resolve()
        return { text: await reply.promise, tokens: 0 }
      },
    },
    enabled: true,
  })
  await digests.ended(ROOT_ID, lane, entryId("e-1"), e =>
    failures.push(String(e)),
  )
  await Promise.race([asked.promise, new Promise(r => setTimeout(r, 1000))])
  const atAsk = {
    verdict: readVerdicts(w.b.session).get(lane)?.verdict,
    failures: [...failures],
    lines: [...w.b.lines],
  }
  // The archive's unload, while the model writes.
  await w.docs.unload(ROOT_ID)
  await w.exchange.flush()
  const loadedAtUnload = w.docs.loaded()
  reply.resolve("done\nFixed the rail.\n- `rail.tsx` draws it")
  await keeper.idle()
  await w.exchange.flush()
  const doc = w.docs.view(ROOT_ID)?.doc
  console.log(
    "Q4",
    JSON.stringify({
      atAsk,
      loadedAtUnload,
      loadedAfter: w.docs.loaded(),
      opened: w.opened,
      failures,
      verdict: readVerdicts(w.b.session).get(lane)?.verdict,
      digest:
        doc === undefined
          ? "root not held"
          : (readDigests(doc).get(entryId("e-1")) ?? null),
      lines: w.b.lines,
    }),
  )
})
