// S293's WebRTC driver: two browser contexts (two devices, two stores), the
// driver relaying their offer, answer and ICE candidates.
// Run with `node rtc.ts` beside `bundle.js`, built from page.ts, in a
// directory outside the repo holding versions.json's packages.

import { readFileSync } from "node:fs"
import http from "node:http"
import { chromium, type Page } from "playwright-core"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await pred()) return true
    await sleep(50)
  }
  return pred()
}

const server = http.createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("content-type", "text/javascript")
    res.end(readFileSync("bundle.js"))
    return
  }
  res.setHeader("content-type", "text/html")
  res.end(`<!doctype html><script src="/bundle.js"></script>`)
})
await new Promise<void>(r => server.listen(41793, "127.0.0.1", r))

const browser = await chromium.launch({
  headless: true,
  // Loopback candidates, unobscured, so two pages on one machine meet.
  args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--allow-loopback-in-peer-connection"],
})
const desk = await (await browser.newContext()).newPage()
const laptop = await (await browser.newContext()).newPage()
for (const p of [desk, laptop]) p.on("pageerror", e => console.log("page error:", e.message))
const call = <T>(p: Page, fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (window as any).probe[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const read = (p: Page) => call<{ seat: string; slots: Record<string, string>; text: string; channelOpen: boolean; peers: number }>(p, "read")

async function open(p: Page) {
  await p.goto("http://localhost:41793/")
  return call<string>(p, "open")
}
async function pair(a: Page, aSeat: string, b: Page, bSeat: string) {
  const offer = await call(a, "offer", bSeat)
  const answer = await call(b, "answer", aSeat, offer)
  await call(a, "accept", answer)
  for (let i = 0; i < 40; i++) {
    await call(b, "addCandidates", await call(a, "takeCandidates"))
    await call(a, "addCandidates", await call(b, "takeCandidates"))
    if ((await read(a)).peers > 0 && (await read(b)).peers > 0) return true
    await sleep(100)
  }
  return false
}

const deskSeat = await open(desk)
let lapSeat = await open(laptop)
out("1 paired over a data channel", await pair(desk, deskSeat, laptop, lapSeat))

await call(laptop, "write", "t1", "k1", "from laptop")
out("1 laptop to desk", await until(async () => {
  const r = await read(desk)
  return r.slots.t1 === "k1" && r.text === "from laptop"
}))
await call(desk, "write", "t2", "k2", ", and desk")
out("1 desk to laptop", await until(async () => {
  const r = await read(laptop)
  return r.slots.t2 === "k2" && r.text === "from laptop, and desk"
}))

// The laptop restarts (a reload); the desk writes while it is gone.
await laptop.reload()
await call(desk, "write", "t3", "k3", " (while the laptop reloaded)")
const seatAgain = await open(laptop)
out("1 laptop's seat after its reload is the same", seatAgain === lapSeat)
lapSeat = seatAgain
out("1 laptop, reloaded, has from its store", await read(laptop))
out("1 paired again", await pair(desk, deskSeat, laptop, lapSeat))
out("1 laptop, reloaded, catches up the desk's write", await until(async () => {
  const r = await read(laptop)
  return r.slots.t3 === "k3" && r.text === "from laptop, and desk (while the laptop reloaded)"
}))
await call(laptop, "write", "t4", "k4", " +laptop")
out("1 desk gets the laptop's write after the reload", await until(async () => (await read(desk)).text.endsWith(" +laptop")))
out("1 both read", { desk: await read(desk), laptop: await read(laptop) })

await browser.close()
server.close()
process.exit(0)
