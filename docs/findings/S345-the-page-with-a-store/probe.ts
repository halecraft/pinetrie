// S345's probe, run as apps/pinetrie/e2e/s345-probe.ts in S344's scratch copy on
// Kyneta 5.0.0, with connect.diff and main.diff applied and the page built
// (`pnpm --filter @pinetrie/web run build`). Imports resolve from there.
// The page is given a browser store and a reconnecting transport, against
// its own host on a SQLite store, through an outage.

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { scriptedModel } from "@pinetrie/pi"
import { startSuiteHost } from "./harness.ts"
import { readBuiltPage } from "../host/page.ts"
const builtPage = await readBuiltPage()
import { asPerson, col, connected, launchBrowser, typeAfter } from "./browser/page.ts"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const store = path.join(mkdtempSync(path.join(tmpdir(), "s345-")), "pinetrie.db")
const start = (port = 0) =>
  startSuiteHost({
    model: { kind: "scripted", script: scriptedModel() },
    store,
    port,
    page: builtPage,
    log: () => {},
  })

let host = await start()
const port = host.port
const hostSeat1 = null
const browser = await launchBrowser()
const context = await browser.newContext()
const page = await context.newPage()
page.on("pageerror", e => console.log("page error:", e.message))
page.on("console", m => { if (m.type() === "warning" || m.type() === "error") console.log("page console:", m.type(), m.text().slice(0, 400)) })
await asPerson(page, "ada@s345.test", "Ada")
if (process.env.NO_STORE === "1") await page.addInitScript(() => localStorage.setItem("probe-no-store", "1"))
await page.goto(host.httpUrl, { waitUntil: "domcontentloaded" })
await connected(page, 60_000)

const seat = () => page.evaluate(() => (globalThis as any).__session.exchange.peerId as string)
const events = () => page.evaluate(() => (globalThis as any).__probeEvents as string[])
const myCards = () =>
  page.evaluate(() => {
    const s = (globalThis as any).__session
    return (s.cards.current() as any[])
      .filter(c => c.owner === s.writer && c.place.kind === "composing")
      .map(c => ({ id: c.id, text: s.cardText(c.id).text() }))
  })
const boxText = (n: number) => page.inputValue(`${col(n)} .composer .input`).catch(() => null)

// A thread with a message, then a draft in its composer, while the host is up.
await page.click("#sidebar .add-canvas")
await typeAfter(page, `${col(0)} .composer .input`, "hello")
await page.click(`${col(0)} .composer .send`)
await page.waitForSelector(`${col(0)} .msg`, { timeout: 30_000 })
await sleep(3_000)
await typeAfter(page, `${col(0)} .composer .input`, "draft one")
await sleep(1_500)
const drafts = await myCards()
out("up: my drafts", drafts)
const draft = drafts[0]?.id
out("up: the host holds the draft's text", draft === undefined ? null : host.cardText(draft))
const seatA = await seat()

await page.evaluate(() => {
  const s = (globalThis as any).__session
  ;(globalThis as any).__diag = []
  const orig = console.warn
  console.warn = (...a: unknown[]) => { (globalThis as any).__diag.push(a.map(String).join(" ").slice(0, 300)); orig(...a) }
})
// 1. A reload with the host up.
await page.reload({ waitUntil: "domcontentloaded" })
await connected(page, 60_000)
out("1 reload: same seat", (await seat()) === seatA)
for (let i = 0; i < 10; i++) {
  await sleep(1_000)
  const n = await page.evaluate(() => (globalThis as any).__session.cards.current().length)
  console.log(`1 reload: cards after ${i + 1}s: ${n}`)
}
out("1 reload: places", await page.evaluate(() => {
  const g = globalThis as any
  const p = g.__probePlaces
  const st = g.__probeSync(p)
  return { cards: Object.keys(p.cards()).length, rev: p.rev(), peers: st.peerStates.map((x: any) => [x.peer?.principal, x.state]), ready: st.ready }
}))
out("1 reload: columns shown", await page.$$eval(".column", els => els.map(e => e.getAttribute("data-position"))))
out("1 reload: what the page holds", await page.evaluate(() => {
  const s = (globalThis as any).__session
  const ex = s.exchange
  const docs: string[] = []
  for (const [id, info] of ex.documents()) docs.push(id + ":" + (info?.mode ?? "?"))
  return {
    canvases: s.openThreads.canvases.current(),
    cards: s.cards.current().length,
    docs: docs.filter(d => !d.startsWith("line:")).slice(0, 20),
    layout: Object.keys(sessionStorage),
  }
}))
out("1 reload: console", await page.evaluate(() => (globalThis as any).__diag ?? null))
out("1 reload: a request is answered", await page.evaluate(async () => {
  const s = (globalThis as any).__session
  return await s.request({ kind: "name", name: "Ada" }).catch((e: unknown) => ({ thrown: String(e) }))
}))
out("1 reload: composers shown", await page.$$eval(".composer .input", els => els.map(e => (e as HTMLTextAreaElement).value)))
await page.screenshot({ path: "/tmp/s345-after-reload.png" })

// 2. The host goes down; the page stays open.
await host.shutdown()
await sleep(2_000)
out("2 down: the page's events", (await events()).slice(-3))
await typeAfter(page, `${col(0)} .composer .input`, " and more")
await sleep(500)
out("2 down: the composer shows", await boxText(0))
out("2 down: the draft's text in the page", (await myCards()).find(c => c.id === draft)?.text ?? null)
// An empty composer: a new canvas, typed in.
const canvasButton = await page.$("#sidebar .add-canvas")
if (canvasButton !== null) {
  await canvasButton.click().catch(() => {})
  await sleep(500)
  await typeAfter(page, `${col(0)} .composer .input`, "new while down").catch(e => console.log("type failed", String(e)))
  await sleep(1_000)
  out("2 down: an empty composer, typed in, shows", await boxText(0))
}

// 3. The host back on the same store and port; the page not reloaded.
host = await start(port)
out("5 host restarted: same seat", hostSeat1 === null ? "not readable" : (host as any).exchange?.peerId === hostSeat1)
await sleep(8_000)
out("3 back: the page's events", (await events()).slice(-3))
out("3 back: the host holds the draft's text", draft === undefined ? null : host.cardText(draft))
const sent = await page.evaluate(async () => {
  const s = (globalThis as any).__session
  const r = await s.request({ kind: "name", name: "Ada" }).catch((e: unknown) => ({ thrown: String(e) }))
  return r
})
out("3 back: a request from the page is answered", sent)

// 3b. A reload with the host back.
await page.reload({ waitUntil: "domcontentloaded" })
await connected(page, 60_000)
await sleep(3_000)
out("3b reload, host back: a request is answered", await page.evaluate(async () => {
  const s = (globalThis as any).__session
  return await s.request({ kind: "name", name: "Ada" }).catch((e: unknown) => ({ thrown: String(e) }))
}))
out("3b reload, host back: the composer shows", await boxText(0))

// 4. A reload while the host is down.
await host.shutdown()
await sleep(1_000)
const loaded = await page
  .reload({ waitUntil: "domcontentloaded", timeout: 15_000 })
  .then(r => ({ status: r?.status() ?? null }))
  .catch(e => ({ error: String(e).split("\n")[0] }))
out("4 reload, host down", loaded)

await browser.close()
process.exit(0)
