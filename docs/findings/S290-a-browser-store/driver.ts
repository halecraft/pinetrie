// S290's driver: a hub that stores and restarts, a page server, and
// headless Chromium driving Ada's tab.

import { readFileSync } from "node:fs"
import http from "node:http"
import {
  createInMemoryStore,
  createInMemoryStoreData,
  Exchange,
  Line,
} from "@kyneta/exchange"
import { Interpret, Schema } from "@kyneta/schema"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import { yjs } from "@kyneta/yjs-schema"
import { chromium } from "playwright-core"
import { WebSocketServer } from "ws"

const Drafts = yjs.bind(Schema.struct({ slots: Schema.record(Schema.string()) }))
const Text = yjs.bind(Schema.struct({ text: Schema.text() }))
const Cmd = Line.protocol({
  topic: "cmd",
  schema: Schema.struct({ text: Schema.string() }),
})

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await pred()) return true
    await sleep(50)
  }
  return pred()
}

// The page, served always, from another port than the hub.
const page = http.createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("content-type", "text/javascript")
    res.end(readFileSync("bundle.js"))
    return
  }
  res.setHeader("content-type", "text/html")
  res.end(`<!doctype html><script src="/bundle.js"></script>`)
})
await new Promise<void>(r => page.listen(41771, "127.0.0.1", r))

// The hub: a store that outlives it, the same port each time.
const sharedData = createInMemoryStoreData()
const received: string[] = []
let hub: { ex: Exchange; close(): Promise<void> } | null = null
async function startHub() {
  const server = new WebsocketServerTransport()
  const ex = new Exchange({
    principal: "hub",
    type: "service",
    transports: [server],
    store: createInMemoryStore({ sharedData }),
    authority: "self",
    resolve: id =>
      id.startsWith("drafts:")
        ? Interpret(Drafts)
        : id.startsWith("card:")
          ? Interpret(Text)
          : undefined,
  })
  Cmd.listen(ex).onReceive((reply, receiver) => {
    void (async () => {
      for await (const m of receiver) {
        received.push(m.text)
        reply.send({ text: `echo ${m.text}` })
      }
    })()
  })
  const wss = new WebSocketServer({ port: 41772, host: "127.0.0.1" })
  wss.on("connection", ws =>
    server.handleConnection({ socket: wrapNodeWebsocket(ws) }).start(),
  )
  await new Promise(r => wss.once("listening", r))
  hub = {
    ex,
    async close() {
      for (const c of wss.clients) c.terminate()
      await new Promise(r => wss.close(r))
      await ex.shutdown()
    },
  }
  return ex.peerId
}
const hubSlots = () => (hub?.ex.has("drafts:ada") ? hub.ex.get("drafts:ada", Drafts).slots() : null)
const hubTextNow = () =>
  hub?.ex.has("card:k1") ? hub.ex.get("card:k1", Text).text() : null

const seat1 = await startHub()
out("hub seat at first start", seat1)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const tab = await context.newPage()
tab.on("pageerror", e => console.log("page error:", e.message))
const ws = "ws://127.0.0.1:41772/"
// localhost, not 127.0.0.1: a secure context, which Web Locks need.
await tab.goto("http://localhost:41771/")
const read = (t = tab) => t.evaluate(() => (window as any).probe.read())
const seatA = await tab.evaluate(u => (window as any).probe.open(u), ws)
out("tab seat", seatA)

// Online: a draft, its text, a request answered.
await tab.evaluate(() => (window as any).probe.write("t1", "k1", "hello"))
out("online: hub holds the draft and text", await until(() => hubTextNow() === "hello" && hubSlots()?.t1 === "k1"))
await until(async () => (await read()).line)
await tab.evaluate(() => (window as any).probe.send("m1"))
out("online: m1 answered", await until(async () => (await read()).replies.includes("echo m1")))

// The hub goes down.
await hub?.close()
hub = null
await until(async () => (await read()).status !== "ready", 5_000)
out("hub down: tab's transport", (await read()).status)
out("hub down: connectivity", (await read()).connectivity)
let threw: string | null = null
try {
  await tab.evaluate(() => (window as any).probe.write("t2", "k2", " offline"))
  await tab.evaluate(() => (window as any).probe.send("m2"))
} catch (e) {
  threw = String(e)
}
out("hub down: writes and a request threw", threw)
out("hub down: the tab reads", await read())

// A reload, the hub still down.
await tab.reload()
const seatB = await tab.evaluate(u => (window as any).probe.open(u), ws)
await sleep(500)
const afterReload = await read()
out("reload, hub down: same seat", seatB === seatA)
out("reload, hub down: the tab reads", afterReload)
await tab.evaluate(() => (window as any).probe.send("m3"))

// A second tab, at once.
const tab2 = await context.newPage()
await tab2.goto("http://localhost:41771/")
const seat2 = await tab2.evaluate(u => (window as any).probe.open(u), ws)
await sleep(500)
out("second tab: another seat", seat2 !== seatB)
out("second tab, hub down: reads", await read(tab2))

// The hub comes back with its store.
const seatHub2 = await startHub()
out("hub restarted: same seat", seatHub2 === seat1)
out(
  "hub back: holds the offline draft and text",
  await until(() => hubTextNow() === "hello offline" && hubSlots()?.t2 === "k2", 20_000),
)
out("hub back: its text and slots", [hubTextNow(), hubSlots()])
out(
  "hub back: m2 and m3 answered",
  await until(async () => {
    const r = await read()
    return r.replies.includes("echo m2") && r.replies.includes("echo m3")
  }, 20_000),
)
await sleep(1_000)
out("hub received, in order", received)
out("tab's replies", (await read()).replies)
out("second tab reads, after", await read(tab2))

await browser.close()
await hub?.close()
page.close()
process.exit(0)
