// S293's Node probe: two of Ada's devices paired directly, no host; then
// Bea; then a host. Each peer registers the same policies.
// Run with `node node.ts` in a directory outside the repo holding
// versions.json's packages (none of them is in the repo's lockfile).

import http from "node:http"
import Database from "better-sqlite3"
import { Exchange, type Policy, whenHydrated } from "@kyneta/exchange"
import { batch, Interpret, json, Schema, unwrap } from "@kyneta/schema"
import { createSqliteStore, fromBetterSqlite3 } from "@kyneta/sqlite-store"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import { yjs } from "@kyneta/yjs-schema"
import { WebSocketServer } from "ws"

const Drafts = yjs.bind(Schema.struct({ slots: Schema.record(Schema.string()) }))
const Text = yjs.bind(Schema.struct({ text: Schema.text() }))
const Places = yjs.bind(Schema.struct({ cards: Schema.record(Schema.string()) }))
const Prefs = json.bind(Schema.struct({ theme: Schema.string() }))

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 5_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred()) return true
    await sleep(10)
  }
  return pred()
}

// Kyneta's diagnostics go to the console.
const diagnostics: string[] = []
for (const level of ["warn", "error"] as const) {
  const orig = console[level].bind(console)
  console[level] = (...a: unknown[]) => {
    diagnostics.push(a.map(String).join(" "))
    orig(...a)
  }
}

// pine·trie's rules, shaped as `writersPolicy` and the host's policy: the
// places are the host's alone; a person's documents are theirs, shared
// with their own peers and the host only.
const HOST = "host"
const owner = (id: string) =>
  id.startsWith("drafts:") || id.startsWith("prefs:") ? id.split(":")[1] : undefined
const policy: Policy = {
  name: "s293.rules",
  canWrite: (id, p) => {
    if (id === "places") return p.principal === HOST
    const o = owner(id)
    return o === undefined ? undefined : p.principal === o || p.principal === HOST
  },
  canShare: (id, p) => {
    const o = owner(id)
    return o === undefined ? undefined : p.principal === o || p.principal === HOST
  },
}
const resolve = (id: string) =>
  id.startsWith("drafts:")
    ? Interpret(Drafts)
    : id.startsWith("card:")
      ? Interpret(Text)
      : id.startsWith("prefs:")
        ? Interpret(Prefs)
        : id === "places"
          ? Interpret(Places)
          : undefined

function storeAt(file: string) {
  return createSqliteStore(fromBetterSqlite3(new Database(file)))
}
async function serve(ex: Exchange, server: WebsocketServerTransport) {
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", ws => server.handleConnection({ socket: wrapNodeWebsocket(ws) }).start())
  const h = http.createServer()
  h.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)))
  await new Promise<void>(r => h.listen(0, "127.0.0.1", r))
  const port = (h.address() as { port: number }).port
  return {
    url: `ws://127.0.0.1:${port}/`,
    close: async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise(r => h.close(r))
    },
  }
}
const client = (url: string) =>
  new WebsocketClientTransport({
    url,
    WebSocket,
    reconnect: { enabled: true, baseDelay: 100, maxDelay: 300, maxAttempts: 1000 },
  })

const dir = `/tmp/s293/db-${Date.now()}`
await import("node:fs").then(fs => fs.mkdirSync(dir, { recursive: true }))

// Ada's desktop: a server for her other device; her laptop: its client.
async function openDesk() {
  const server = new WebsocketServerTransport()
  const ex = new Exchange({
    principal: "ada",
    transports: [server],
    store: storeAt(`${dir}/desk.db`),
    resolve,
  })
  ex.register(policy)
  const s = await serve(ex, server)
  return { ex, ...s }
}
async function openLaptop(url: string) {
  const t = client(url)
  const ex = new Exchange({
    principal: "ada",
    transports: [t],
    store: storeAt(`${dir}/laptop.db`),
    resolve,
  })
  ex.register(policy)
  return { ex, t }
}

let desk = await openDesk()
let lap = await openLaptop(desk.url)
await lap.t.waitForStatus("ready", { timeoutMs: 5_000 })
const deskSeat = desk.ex.peerId
const lapSeat = lap.ex.peerId
const docs = (ex: Exchange) => ({
  drafts: ex.get("drafts:ada", Drafts),
  text: ex.get("card:k1", Text),
  prefs: ex.get("prefs:ada", Prefs),
  places: ex.get("places", Places),
})

// 1. Both ways, with no host.
{
  const d = docs(desk.ex)
  const l = docs(lap.ex)
  batch(l.drafts, x => x.slots.set("t1", "k1"))
  l.text.text.insert(0, "from laptop")
  const toDesk = await until(() => d.drafts.slots().t1 === "k1" && d.text.text() === "from laptop")
  batch(d.drafts, x => x.slots.set("t2", "k2"))
  d.text.text.insert(d.text.text().length, ", and desk")
  const toLap = await until(() => l.drafts.slots().t2 === "k2" && l.text.text() === "from laptop, and desk")
  out("1 laptop to desk", toDesk)
  out("1 desk to laptop", toLap)
}

// 1. Each restarts from its store; then a write each way.
{
  await lap.ex.shutdown()
  const l0 = docs(desk.ex)
  l0.text.text.insert(l0.text.text().length, " (while the laptop was off)")
  lap = await openLaptop(desk.url)
  await lap.t.waitForStatus("ready", { timeoutMs: 5_000 })
  out("1 laptop's seat after its restart is the same", lap.ex.peerId === lapSeat)
  const l = docs(lap.ex)
  await whenHydrated(l.drafts)
  out("1 laptop, restarted, has its drafts from its store", l.drafts.slots())
  out(
    "1 laptop, restarted, catches up the desk's write",
    await until(() => l.text.text() === "from laptop, and desk (while the laptop was off)"),
  )
  await desk.close()
  await desk.ex.shutdown()
  // The laptop writes while the desk is off; its transport reconnects.
  batch(l.drafts, x => x.slots.set("t3", "k3"))
  const url = desk.url
  desk = await openDesk()
  out("1 desk's seat after its restart is the same", desk.ex.peerId === deskSeat)
  // The desk came back on another port; point the laptop at it.
  await lap.ex.removeTransport(lap.t.transportId)
  lap.t = client(desk.url)
  await lap.ex.addTransport(lap.t)
  void url
  const d = docs(desk.ex)
  await whenHydrated(d.text)
  out("1 desk, restarted, has its text from its store", d.text.text())
  out("1 desk, restarted, gets the laptop's offline draft", await until(() => d.drafts.slots().t3 === "k3"))
}

// 2. A document only the host may write.
{
  for (const [name, ex] of [["desk", desk.ex], ["laptop", lap.ex]] as const) {
    let thrown = "none"
    try {
      batch(docs(ex).places, x => x.cards.set("k1", "a"))
    } catch (e) {
      thrown = (e as Error).name
    }
    out(`2 ${name}'s own write to the places throws`, thrown)
  }
  // A rogue peer of Ada's that runs no policy writes the places, and her
  // text, and offers them to the desk.
  const t = client(desk.url)
  const rogue = new Exchange({ principal: "ada", transports: [t], resolve })
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  const before = diagnostics.length
  batch(rogue.get("places", Places), x => x.cards.set("k1", "rogue"))
  rogue.get("card:k1", Text).text.insert(0, "[rogue] ")
  await sleep(1_000)
  out("2 desk's places after the rogue's offer", docs(desk.ex).places.cards())
  out("2 laptop's places after the rogue's offer", docs(lap.ex).places.cards())
  out("2 a card's text, which anyone may write, from the rogue reached the laptop", docs(lap.ex).text.text().includes("[rogue]"))
  out("2 diagnostics", diagnostics.slice(before))
  await rogue.shutdown()
}

// 3. Bea joins the desk.
let bea: Exchange
{
  const t = client(desk.url)
  bea = new Exchange({ principal: "bea", transports: [t], resolve })
  bea.register(policy)
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  await sleep(500)
  out("3 bea holds ada's drafts unasked", bea.has("drafts:ada"))
  out("3 bea holds the card's text unasked", bea.has("card:k1"))
  const asked = bea.get("drafts:ada", Drafts)
  const prefs = bea.get("prefs:ada", Prefs)
  await sleep(1_000)
  out("3 bea, asking for ada's drafts by id, reads", asked.slots())
  out("3 bea, asking for ada's prefs by id, reads", prefs())
  let thrown = "none"
  try {
    batch(asked, x => x.slots.set("t9", "k9"))
  } catch (e) {
    thrown = (e as Error).name
  }
  out("3 bea's write to ada's drafts throws", thrown)
  const text = bea.get("card:k1", Text)
  await until(() => text.text().length > 0)
  text.text.insert(text.text().length, " +bea")
  out("3 bea's write to the card reaches the laptop through the desk", await until(() => docs(lap.ex).text.text().endsWith(" +bea")))
}

// The json prefs, written by Ada's desk alone before any host.
batch(docs(desk.ex).prefs, x => x.theme.set("dark"))
await until(() => docs(lap.ex).prefs().theme === "dark")

// 4. A host joins the laptop.
{
  const server = new WebsocketServerTransport()
  const host = new Exchange({
    principal: HOST,
    type: "service",
    transports: [server],
    store: storeAt(`${dir}/host.db`),
    resolve,
    authority: "self",
  })
  host.register(policy)
  const s = await serve(host, server)
  const before = diagnostics.length
  const t = client(s.url)
  await lap.ex.addTransport(t)
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  const h = docs(host)
  const ok = await until(
    () =>
      h.drafts.slots().t3 === "k3" &&
      h.text.text().endsWith(" +bea") &&
      h.prefs().theme === "dark",
  )
  out("4 the host has ada's drafts, the card and her prefs", ok)
  batch(h.places, x => x.cards.set("k1", "column-a"))
  const placed = await until(
    () =>
      docs(desk.ex).places.cards().k1 === "column-a" &&
      bea.get("places", Places).cards().k1 === "column-a",
  )
  out("4 the host's places reach the desk and bea through the laptop", placed)
  out("4 the laptop, connected to the host, has its places", docs(lap.ex).places.cards())
  out("4 the desk, through the laptop, has its places", docs(desk.ex).places.cards())
  // The desk connects to the host directly too.
  const td = client(s.url)
  await desk.ex.addTransport(td)
  await td.waitForStatus("ready", { timeoutMs: 5_000 })
  out("4 the desk, connected to the host as well, gets its places", await until(() => docs(desk.ex).places.cards().k1 === "column-a"))
  out("4 bea, connected to the desk only, gets them then", await until(() => bea.get("places", Places).cards().k1 === "column-a", 3_000))
  await sleep(1_000)
  const all = [
    ["host", host],
    ["desk", desk.ex],
    ["laptop", lap.ex],
  ] as const
  out(
    "4 everyone's text",
    Object.fromEntries([...all, ["bea", bea] as const].map(([n, e]) => [n, docs(e as Exchange).text.text()])),
  )
  out("4 everyone's drafts", Object.fromEntries(all.map(([n, e]) => [n, docs(e).drafts.slots()])))
  out("4 everyone's prefs", Object.fromEntries(all.map(([n, e]) => [n, docs(e).prefs()])))
  out("4 bea holds ada's drafts, now through two peers", bea.get("drafts:ada", Drafts).slots())
  out("4 diagnostics", diagnostics.slice(before))
  // No document written twice: each Yjs text is one run of each writer's
  // inserts, so its length is the sum of what was written.
  out("4 the text's Yjs state, by client", [...(unwrap(h.text) as any).store.clients.keys()].length)
  await host.shutdown()
  await s.close()
}
out("seats", { desk: desk.ex.peerId, laptop: lap.ex.peerId, bea: bea.peerId })
out("all diagnostics", diagnostics.filter(d => /lineage|refus/i.test(d)))
await bea.shutdown()
await lap.ex.shutdown()
await desk.ex.shutdown()
await desk.close()
process.exit(0)
