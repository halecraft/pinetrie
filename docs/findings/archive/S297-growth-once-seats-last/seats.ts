// S297's seats driver: how many seats a person's tabs make, in headless
// Chromium, over one origin's IndexedDB store. Run with `node` in a directory
// holding versions.json's packages, outside the repo, after
// `esbuild seats-page.ts --bundle --format=esm --outfile=seats-bundle.js`.

import { readFileSync } from "node:fs"
import http from "node:http"
import { chromium, type BrowserContext, type Page } from "playwright-core"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const server = http.createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("content-type", "text/javascript")
    res.end(readFileSync("seats-bundle.js"))
    return
  }
  res.setHeader("content-type", "text/html")
  res.end(`<!doctype html><script src="/bundle.js"></script>`)
})
await new Promise<void>(r => server.listen(41791, "127.0.0.1", r))
const URL = "http://localhost:41791/"
const browser = await chromium.launch({ headless: true })

async function tab(ctx: BrowserContext, noLocks = false): Promise<{ page: Page; seat: string }> {
  const page = await ctx.newPage()
  await page.goto(URL)
  const seat: string = await page.evaluate(n => (window as any).probe.open(n), noLocks)
  return { page, seat }
}
const all = new Set<string>()
const note = (s: string) => {
  all.add(s)
  return s
}

const ctx = await browser.newContext()

// A. One tab reloaded 20 times.
{
  const { page, seat } = await tab(ctx)
  const seats = [note(seat)]
  for (let i = 0; i < 20; i++) {
    await page.reload()
    seats.push(note(await page.evaluate(() => (window as any).probe.open(false))))
  }
  out("A one tab, 21 loads: distinct seats", new Set(seats).size)
  await page.close()
}

// B. One tab closed and opened again 20 times.
{
  const seats: string[] = []
  for (let i = 0; i < 20; i++) {
    const t = await tab(ctx)
    seats.push(note(t.seat))
    await t.page.close()
  }
  out("B one tab, closed and opened 20 times: distinct seats", new Set(seats).size)
}

// C. Three tabs at once, ten times over.
{
  const rounds: string[][] = []
  for (let r = 0; r < 10; r++) {
    const tabs = [await tab(ctx), await tab(ctx), await tab(ctx)]
    rounds.push(tabs.map(t => note(t.seat)))
    for (const t of tabs) await t.page.close()
  }
  out("C three at once: distinct within each round", rounds.map(r => new Set(r).size))
  out("C three at once, ten rounds: distinct seats", new Set(rounds.flat()).size)
}

// D. Ten tabs at once, all closed, then one.
{
  const tabs = []
  for (let i = 0; i < 10; i++) tabs.push(await tab(ctx))
  const ten = tabs.map(t => note(t.seat))
  for (const t of tabs) await t.page.close()
  const one = await tab(ctx)
  note(one.seat)
  out("D ten at once: distinct seats", new Set(ten).size)
  out("D then one tab: one of the ten", ten.includes(one.seat))
  await one.page.close()
}

out("A-D all seats this origin's store issued", all.size)

// F. Another browser profile: another device.
{
  const other = await browser.newContext()
  const t = await tab(other)
  out("F another profile: a seat not seen before", !all.has(t.seat))
  await other.close()
}

// G. With no Web Locks: a fresh seat on every open.
{
  const ctx2 = await browser.newContext()
  const seats: string[] = []
  for (let i = 0; i < 10; i++) {
    const t = await tab(ctx2, true)
    seats.push(t.seat)
    await t.page.close()
  }
  out("G no Web Locks, ten opens: distinct seats", new Set(seats).size)
  await ctx2.close()
}

// H. A non-secure origin (127.0.0.1 is secure too; a LAN address is not).
{
  const { networkInterfaces } = await import("node:os")
  const lan = Object.values(networkInterfaces()).flat().find(a => a && a.family === "IPv4" && !a.internal)?.address
  if (lan === undefined) out("H no non-loopback address to test", null)
  else {
    const s2 = http.createServer((req, res) => server.emit("request", req, res))
    await new Promise<void>(r => s2.listen(41792, lan, r))
    const ctx3 = await browser.newContext()
    const seats: string[] = []
    const warnings: string[] = []
    for (let i = 0; i < 5; i++) {
      const page = await ctx3.newPage()
      page.on("console", m => { if (m.type() === "warning") warnings.push(m.text()) })
      await page.goto(`http://${lan}:41792/`)
      const secure = await page.evaluate(() => isSecureContext && "locks" in navigator)
      seats.push(await page.evaluate(() => (window as any).probe.open(false)))
      if (i === 0) out("H a LAN origin: secure context with Web Locks", secure)
      await page.close()
    }
    out("H a LAN origin, five opens: distinct seats", new Set(seats).size)
    out("H the store warned", warnings.slice(0, 1))
    await ctx3.close()
    s2.close()
  }
}

// E. A tab whose renderer crashes, in a browser of its own: is its seat released?
{
  const b2 = await chromium.launch({ headless: true })
  const c = await b2.newContext()
  const a = await tab(c)
  const holder = await tab(c)
  let how = "chrome://crash"
  await a.page.goto("chrome://crash").catch(() => {})
  await new Promise(r => setTimeout(r, 1000))
  try {
    const b = await tab(c)
    out("E after " + how + ", the next tab takes the crashed tab's seat", b.seat === a.seat)
    out("E seats: crashed, still open, next", [a.seat === holder.seat, b.seat === holder.seat])
  } catch (err) {
    out("E the browser did not survive " + how, String(err).slice(0, 80))
  }
  await b2.close().catch(() => {})
}

await browser.close()
server.close()
process.exit(0)
