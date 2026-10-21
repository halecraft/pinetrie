// S264's probe, run as apps/pinetrie/e2e/s264-probe.ts with `node`, with a
// `drafts` kind added for it to PERSON_DOC_KINDS and to the host's SCHEMA_OF
// (InventoryDoc's shape: thread id to card id). Its imports are relative to
// that place.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { sync } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import { scriptedModel } from "@pinetrie/pi"
import { personDocId } from "@pinetrie/protocol/writers"
import { readPlaces } from "@pinetrie/reads"
import { cardDocId, InventoryDoc } from "@pinetrie/schema"
import { newCardId, newThreadId } from "@pinetrie/session"
import { openStore } from "../host/store.ts"
import { join, startSuiteHost, waitFor } from "./harness.ts"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)

const dbFile = path.join(mkdtempSync(path.join(tmpdir(), "s264-")), "p.db")
const start = () =>
  startSuiteHost({
    model: { kind: "scripted", script: scriptedModel() },
    store: openStore(dbFile),
    log: (m: string) => { if (m.includes("swept")) console.log("host log:", m) },
  })

let host = await start()
const ada1 = await join(host, "ada", "s264")
const ada2 = await join(host, "ada", "s264")
const bea = await join(host, "bea", "s264")
const drafts = (c: typeof ada1) =>
  c.exchange.get(personDocId("drafts", c.writer), InventoryDoc)

// 1. A text no record names.
const id = newCardId()
ada1.cardText(id).text.insert(0, "draft one")
out(
  "1 host holds the text",
  (await waitFor(() => host.cardText(id) === "draft one", 5_000)) >= 0,
)
out(
  "1 places name it",
  readPlaces(host.places).some(c => c.id === id),
)

// 2. Who holds it.
await sleep(1_500)
out("2 bea holds it unasked", bea.exchange.has(cardDocId(id)))
out("2 ada2 holds it unasked", ada2.exchange.has(cardDocId(id)))
const beaText = bea.cardText(id)
out(
  "2 bea, asking by id, reads it",
  (await waitFor(() => beaText.text() === "draft one", 5_000)) >= 0,
)

// The drafts document: ada1 names the draft; ada2 reads it and opens the text.
const thread = newThreadId()
const d1 = drafts(ada1)
const d2 = drafts(ada2)
await sleep(1_000)
out("2 drafts documents ready", [sync(d1).readyFor(() => true), sync(d2).readyFor(() => true)])
batch(d1, d => d.slots.set(thread, id))
const named = await waitFor(() => d2.slots()[thread] === id, 5_000)
out("2 ada2 finds the draft in the drafts document", named >= 0)
const ada2Text = ada2.cardText(id)
out(
  "2 ada2 reads its text by that id",
  (await waitFor(() => ada2Text.text() === "draft one", 5_000)) >= 0,
)
out("2 bea can open ada's drafts document", bea.exchange.has(personDocId("drafts", ada1.writer)))

// 3. The writer's own copy stays.
await sleep(1_500)
out("3 ada1's copy is still held", ada1.exchange.has(cardDocId(id)))
ada2Text.text.insert(ada2Text.text().length, " and two")
out(
  "3 ada1 sees ada2's typing",
  (await waitFor(
    () => ada1.cardText(id).text() === "draft one and two",
    5_000,
  )) >= 0,
)

// 4. Two tabs name one thread's draft at once.
const races = 20
let converged = 0
let winsOf1 = 0
let loserTells = 0
for (let i = 0; i < races; i++) {
  const t = newThreadId()
  const c1 = newCardId()
  const c2 = newCardId()
  batch(d1, d => d.slots.set(t, c1))
  batch(d2, d => d.slots.set(t, c2))
  const same = await waitFor(
    () => d1.slots()[t] !== undefined && d1.slots()[t] === d2.slots()[t],
    5_000,
  )
  // Settle a little, so a late flip would show.
  await sleep(100)
  if (same >= 0 && d1.slots()[t] === d2.slots()[t]) converged++
  const won = d1.slots()[t]
  if (won === c1) winsOf1++
  // The loser tells: its own card is not the one named.
  const loser = won === c1 ? d2 : d1
  const mine = won === c1 ? c2 : c1
  if (loser.slots()[t] !== mine) loserTells++
}
out("4 races converged", `${converged}/${races}`)
out("4 ada1 won", `${winsOf1}/${races}`)
out("4 the loser reads another card named", `${loserTells}/${races}`)

// 1. Across a restart.
await host.quiet()
await ada1.close()
await ada2.close()
await bea.close()
await host.shutdown()
host = await start()
out("1 after a restart, the host holds the text", host.cardText(id))
const ada3 = await join(host, "ada", "s264")
const d3 = drafts(ada3)
out(
  "1 after a restart, the drafts document names it",
  (await waitFor(() => d3.slots()[thread] === id, 5_000)) >= 0,
)
const t3 = ada3.cardText(id)
await waitFor(() => t3.text() !== "", 5_000)
out("1 after a restart, a new tab reads", t3.text())

// 5. With the host gone.
await host.shutdown()
await waitFor(() => !ada3.exchange.peers.current.size, 5_000)
let threw: string | null = null
try {
  t3.text.insert(t3.text().length, " offline")
  batch(d3, d => d.slots.set(newThreadId(), newCardId()))
} catch (e) {
  threw = String(e)
}
out("5 a write with the host gone threw", threw)
out("5 the tab's copy holds it", t3.text())
const fresh = newCardId()
try {
  ada3.cardText(fresh).text.insert(0, "new while offline")
  out("5 a new card's text, written offline", ada3.cardText(fresh).text())
} catch (e) {
  out("5 a new card's text threw", String(e))
}
await ada3.close().catch(() => {})
process.exit(0)
