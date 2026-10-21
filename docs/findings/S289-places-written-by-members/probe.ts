// S289's probe: a hub and two members over WebSocket, no pine·trie code.
// Run as apps/pinetrie/e2e/s276-probe.ts with `node`: its imports resolve
// from there, and two point into the pnpm store by absolute path.

import http from "node:http"
import type { AddressInfo } from "node:net"
import {
  createInMemoryStore,
  createUndoStack,
  Exchange,
} from "@kyneta/exchange"
import { batch, Interpret, Schema, unwrap } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import { yjs } from "/workspace/node_modules/.pnpm/@kyneta+yjs-schema@4.0.0_@kyneta+changefeed@4.0.0_@kyneta+schema@4.0.0_yjs@13.6.33/node_modules/@kyneta/yjs-schema/dist/index.js"
import { WebSocketServer } from "ws"
import * as Y from "/workspace/node_modules/.pnpm/yjs@13.6.33/node_modules/yjs/dist/yjs.mjs"

const Place = Schema.struct.json({ column: Schema.string(), order: Schema.string() })
const Both = Schema.struct.json({
  column: Schema.string(),
  order: Schema.string(),
  command: Schema.string(),
})
const CanvasDoc = yjs.bind(
  Schema.struct({
    places: Schema.record(Place),
    commands: Schema.record(Schema.string()),
    together: Schema.record(Both),
    title: Schema.text(),
  }),
)
const DOC = "canvas:c1"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 5_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred()) return true
    await sleep(5)
  }
  return pred()
}

// The hub: stores and relays, decides nothing.
const server = new WebsocketServerTransport()
const hub = new Exchange({
  principal: "hub",
  type: "service",
  transports: [server],
  store: createInMemoryStore(),
  authority: "self",
  resolve: id => (id === DOC ? Interpret(CanvasDoc) : undefined),
})
const wss = new WebSocketServer({ noServer: true })
wss.on("connection", ws => server.handleConnection({ socket: wrapNodeWebsocket(ws) }).start())
const httpServer = http.createServer()
httpServer.on("upgrade", (req, socket, head) =>
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)),
)
await new Promise<void>(r => httpServer.listen(0, "127.0.0.1", r))
const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/`
const hubDoc = hub.get(DOC, CanvasDoc)

const transportFor = () =>
  new WebsocketClientTransport({ url, WebSocket, reconnect: { enabled: false } })
async function member(principal: string) {
  const t = transportFor()
  const ex = new Exchange({
    principal,
    transports: [t],
    // The undo stack is the member's own.
    canShare: id => (id.startsWith("undo:") ? false : undefined),
  })
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  const doc = ex.get(DOC, CanvasDoc)
  return { ex, doc, transport: t }
}
const ada = await member("ada")
const bea = await member("bea")
let adaT = ada.transport
let beaT = bea.transport
const partition = async (who: "ada" | "bea") => {
  if (who === "ada") await ada.ex.removeTransport(adaT.transportId)
  else await bea.ex.removeTransport(beaT.transportId)
}
const rejoin = async (who: "ada" | "bea") => {
  const t = transportFor()
  if (who === "ada") {
    adaT = t
    await ada.ex.addTransport(t)
  } else {
    beaT = t
    await bea.ex.addTransport(t)
  }
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
}
const at = (d: typeof ada.doc, card: string) => d.places.get(card)?.column
const agreed = (card: string) =>
  at(ada.doc, card) !== undefined &&
  at(ada.doc, card) === at(bea.doc, card) &&
  at(bea.doc, card) === at(hubDoc, card)

// Every card starts in column "a".
const N = 40
batch(ada.doc, d => {
  for (let i = 0; i < N; i++) d.places.set(`k${i}`, { column: "a", order: `${i}` })
})
out("setup reached everyone", await until(() => agreed(`k${N - 1}`)))

// 1. Concurrent moves of one card, connected: both written in one tick.
{
  let converged = 0
  let adaWins = 0
  let loserTells = 0
  for (let i = 0; i < 20; i++) {
    const card = `k${i}`
    ada.doc.places.set(card, { column: "ada", order: "0" })
    bea.doc.places.set(card, { column: "bea", order: "0" })
    if (await until(() => agreed(card))) converged++
    await sleep(50)
    const won = at(ada.doc, card)
    if (won === "ada") adaWins++
    const loser = won === "ada" ? bea.doc : ada.doc
    const meant = won === "ada" ? "bea" : "ada"
    if (at(loser, card) !== meant) loserTells++
  }
  out("1 connected races converged", `${converged}/20`)
  out("1 connected races ada won", `${adaWins}/20`)
  out("1 the loser reads the other place", `${loserTells}/20`)
}

// 1. While partitioned: each moves the same card, and other cards.
{
  await partition("bea")
  ada.doc.places.set("k20", { column: "ada", order: "0" })
  ada.doc.places.set("k21", { column: "ada", order: "0" })
  bea.doc.places.set("k20", { column: "bea", order: "0" })
  bea.doc.places.set("k22", { column: "bea", order: "0" })
  await sleep(200)
  out("1 partitioned: ada sees k20 in", at(ada.doc, "k20"))
  out("1 partitioned: bea sees k20 in", at(bea.doc, "k20"))
  await rejoin("bea")
  const ok = await until(() => agreed("k20") && agreed("k21") && agreed("k22"))
  out("1 after rejoin, all converged", ok)
  out("1 after rejoin, k20 / k21 / k22", [at(hubDoc, "k20"), at(hubDoc, "k21"), at(hubDoc, "k22")])
  const inTwo = [...Array(N).keys()].filter(i => {
    const c = `k${i}`
    return !agreed(c)
  })
  out("1 cards whose place differs between peers", inTwo.length)
}

// 2. A move after seeing the other's wins everywhere, both ways round.
{
  ada.doc.places.set("k23", { column: "ada", order: "0" })
  await until(() => agreed("k23"))
  bea.doc.places.set("k23", { column: "bea-after", order: "0" })
  const a = await until(() => at(ada.doc, "k23") === "bea-after" && agreed("k23"))
  bea.doc.places.set("k24", { column: "bea", order: "0" })
  await until(() => agreed("k24"))
  ada.doc.places.set("k24", { column: "ada-after", order: "0" })
  const b = await until(() => at(bea.doc, "k24") === "ada-after" && agreed("k24"))
  out("2 the later move wins (bea after ada, ada after bea)", [a, b])
}

// 3. Place and command at once: separate keys, then one shared value.
{
  let separate = 0
  let together = 0
  let torn = 0
  for (let i = 0; i < 20; i++) {
    const card = `c${i}`
    ada.doc.places.set(card, { column: "ada", order: "0" })
    bea.doc.commands.set(card, "/review")
    ada.doc.together.set(card, { column: "ada", order: "0", command: "" })
    bea.doc.together.set(card, { column: "a", order: "0", command: "/review" })
    await until(
      () =>
        hubDoc.places.get(card) !== undefined &&
        hubDoc.commands.get(card) !== undefined &&
        ada.doc.together.get(card)?.column ===
          bea.doc.together.get(card)?.column,
    )
    await sleep(30)
    if (ada.doc.places.get(card)?.column === "ada" && bea.doc.commands.get(card) === "/review" && ada.doc.commands.get(card) === "/review")
      separate++
    const t = ada.doc.together.get(card)
    if (t?.column === "ada" && t.command === "/review") together++
    const whole =
      (t?.column === "ada" && t.command === "") ||
      (t?.column === "a" && t.command === "/review")
    if (!whole) torn++
  }
  out("3 separate keys: both the move and the command stood", `${separate}/20`)
  out("3 one value: both stood", `${together}/20`)
  out("3 one value: torn (neither writer's whole value)", `${torn}/20`)
}

// 4. Undo of your own move.
{
  const stack = await createUndoStack({
    exchange: ada.ex,
    docId: "undo:ada",
    key: "places",
    scope: id => id === DOC,
  })
  ada.doc.places.set("k30", { column: "a", order: "30" })
  await until(() => agreed("k30"))
  stack.gesture(() => ada.doc.places.set("k30", { column: "x", order: "1" }))
  await until(() => agreed("k30"))
  const r1 = await stack.undo()
  await until(() => agreed("k30"))
  out("4 undo of a move: result", r1.kind)
  out("4 undo of a move: back in, everywhere", [at(ada.doc, "k30"), at(bea.doc, "k30"), ada.doc.places.get("k30")?.order])

  stack.gesture(() => ada.doc.places.set("k31", { column: "x", order: "1" }))
  await until(() => agreed("k31"))
  bea.doc.places.set("k31", { column: "bea", order: "2" })
  await until(() => at(ada.doc, "k31") === "bea")
  const r2 = await stack.undo()
  await sleep(200)
  out("4 undo after another moved it: result", { kind: r2.kind, stale: "stale" in r2 ? r2.stale.length : null })
  out("4 undo after another moved it: k31 is", [at(ada.doc, "k31"), at(bea.doc, "k31"), ada.doc.places.get("k31")])

  stack.gesture(() => ada.doc.places.set("k32", { column: "x", order: "1" }))
  await until(() => agreed("k32"))
  bea.doc.places.set("k32", { column: "bea", order: "2" })
  await until(() => at(ada.doc, "k32") === "bea")
  const r3 = await stack.undo({ whole: true })
  await sleep(200)
  out("4 whole undo after another moved it: result", r3.kind)
  out("4 whole undo after another moved it: k32 is", ada.doc.places.get("k32"))
  stack.dispose()
}

// 5. Bytes a move costs.
{
  const size = () => Y.encodeStateAsUpdate(unwrap(hubDoc) as Y.Doc).byteLength
  await sleep(200)
  const before = size()
  for (let i = 0; i < 1000; i++)
    ada.doc.places.set(`k${i % N}`, { column: `col${i % 7}`, order: `${i}` })
  await until(() => hubDoc.places.get(`k${999 % N}`)?.order === "999")
  await sleep(200)
  const after = size()
  out("5 bytes for 1000 moves of 40 cards", after - before)
  out("5 bytes per move", Math.round((after - before) / 1000))
  out("5 the whole document, bytes", after)
  for (let i = 0; i < 1000; i++)
    ada.doc.places.set(`n${i}`, { column: "a", order: `${i}` })
  await until(() => hubDoc.places.get("n999") !== undefined)
  await sleep(200)
  out("5 bytes for 1000 new cards placed", size() - after)
}

// 6. Typing while partitioned, then reconnecting under the same seat.
{
  ada.doc.title.insert(0, "Canvas")
  await until(() => bea.doc.title() === "Canvas" && hubDoc.title() === "Canvas")
  await partition("ada")
  ada.doc.title.insert(ada.doc.title().length, " by Ada")
  bea.doc.title.insert(0, "Our ")
  await sleep(200)
  await rejoin("ada")
  const ok = await until(
    () => ada.doc.title() === bea.doc.title() && bea.doc.title() === hubDoc.title() && ada.doc.title().includes("Ada"),
  )
  out("6 after rejoin, the titles", [ada.doc.title(), bea.doc.title(), hubDoc.title()])
  out("6 converged", ok)
  out("6 ada's seat is unchanged", ada.ex.peerId)
}

await ada.ex.shutdown()
await bea.ex.shutdown()
await hub.shutdown()
httpServer.close()
process.exit(0)
