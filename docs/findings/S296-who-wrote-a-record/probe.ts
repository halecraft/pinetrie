// S296's probe: who wrote each record of a Yjs log, read from its item's
// `clientID`, at a hub and at a peer that relays. No pine·trie code.
// Run as apps/pinetrie/e2e/s296-probe.ts with `node`: its imports resolve
// from there, and two point into the pnpm store by absolute path.

import http from "node:http"
import type { AddressInfo } from "node:net"
import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import { Interpret, Schema, unwrap } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import {
  yjs,
  yjsClientId,
} from "/workspace/node_modules/.pnpm/@kyneta+yjs-schema@4.0.0_@kyneta+changefeed@4.0.0_@kyneta+schema@4.0.0_yjs@13.6.33/node_modules/@kyneta/yjs-schema/dist/index.js"
import { WebSocketServer } from "ws"
import type * as Y from "/workspace/node_modules/.pnpm/yjs@13.6.33/node_modules/yjs/dist/yjs.mjs"

const Intent = Schema.struct.json({
  id: Schema.string(),
  author: Schema.string(),
  text: Schema.string(),
})
const LogDoc = yjs.bind(Schema.struct({ log: Schema.list(Intent) }))
const DOC = "thread:t1"

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

/** A WebSocket server for an exchange, on a port of its own. */
async function serve(server: WebsocketServerTransport): Promise<string> {
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", ws =>
    server.handleConnection({ socket: wrapNodeWebsocket(ws) }).start(),
  )
  const h = http.createServer()
  h.on("upgrade", (req, socket, head) =>
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)),
  )
  await new Promise<void>(r => h.listen(0, "127.0.0.1", r))
  return `ws://127.0.0.1:${(h.address() as AddressInfo).port}/`
}

/**
 * Seats seen connected, kept after they leave, as the host's
 * `pinetrie.seat` records are: `clientID` to seat and principal.
 */
function seatTable(ex: Exchange) {
  const seats = new Map<number, { peer: string; principal: string }>()
  const note = () => {
    for (const p of ex.peers.current.values())
      seats.set(yjsClientId(p.peerId), { peer: p.peerId, principal: p.principal })
  }
  note()
  ex.peers.subscribe(note)
  // Its own seat too: a peer reads its own records.
  seats.set(yjsClientId(ex.peerId), { peer: ex.peerId, principal: "(self)" })
  return seats
}

/** Each record of the log, with the `clientID` of the Yjs item holding it. */
function writersOfLog(doc: { log: unknown }) {
  const arr = unwrap(doc.log as never) as unknown as Y.Array<unknown>
  const rows: { id: string; author: string; client: number }[] = []
  // Yjs keeps runs of one client's inserts as one item, so each value of
  // an item's content takes the item's id.client.
  let item = (arr as unknown as { _start: Y.Item | null })._start
  while (item !== null) {
    if (!item.deleted)
      for (const v of item.content.getContent() as { id: string; author: string }[])
        rows.push({ id: v.id, author: v.author, client: item.id.client })
    item = item.right
  }
  return rows
}

function attribute(
  doc: { log: unknown },
  seats: Map<number, { peer: string; principal: string }>,
) {
  return writersOfLog(doc).map(r => {
    const seat = seats.get(r.client)
    return {
      id: r.id,
      field: r.author,
      wrote: seat?.principal ?? "unknown",
      matches: seat?.principal === r.author,
    }
  })
}

// The hub, as pine·trie's host.
const hubServer = new WebsocketServerTransport()
const hub = new Exchange({
  principal: "hub",
  type: "service",
  transports: [hubServer],
  store: createInMemoryStore(),
  authority: "self",
  resolve: id => (id === DOC ? Interpret(LogDoc) : undefined),
})
const hubUrl = await serve(hubServer)
const hubSeats = seatTable(hub)
const hubDoc = hub.get(DOC, LogDoc)

const client = (url: string) =>
  new WebsocketClientTransport({ url, WebSocket, reconnect: { enabled: false } })

// Ada: connected to the hub, and serving Cal, who reaches only her.
const adaServer = new WebsocketServerTransport()
let adaToHub = client(hubUrl)
const ada = new Exchange({
  principal: "ada",
  transports: [adaToHub, adaServer],
  resolve: id => (id === DOC ? Interpret(LogDoc) : undefined),
})
const adaUrl = await serve(adaServer)
await adaToHub.waitForStatus("ready", { timeoutMs: 5_000 })
const adaSeats = seatTable(ada)
const adaDoc = ada.get(DOC, LogDoc)

let beaToHub = client(hubUrl)
const bea = new Exchange({ principal: "bea", transports: [beaToHub] })
await beaToHub.waitForStatus("ready", { timeoutMs: 5_000 })
const beaDoc = bea.get(DOC, LogDoc)

const calToAda = client(adaUrl)
const cal = new Exchange({ principal: "cal", transports: [calToAda] })
await calToAda.waitForStatus("ready", { timeoutMs: 5_000 })
const calDoc = cal.get(DOC, LogDoc)

const hubHas = (id: string) => hubDoc.log().some(r => r.id === id)
const hubRow = (id: string) => attribute(hubDoc, hubSeats).find(r => r.id === id)
const adaRow = (id: string) => attribute(adaDoc, adaSeats).find(r => r.id === id)

out("seats", {
  ada: ada.peerId,
  bea: bea.peerId,
  cal: cal.peerId,
  "cal is among the hub's peers": [...hub.peers.current.keys()].includes(cal.peerId),
})

// 1. Connected: Ada appends.
adaDoc.log.push({ id: "i1", author: "ada", text: "connected" })
await until(() => hubHas("i1"))
out("1 connected: at the hub", hubRow("i1"))
out("1 the item's clientID is yjsClientId(ada's seat)", writersOfLog(hubDoc).find(r => r.id === "i1")?.client === yjsClientId(ada.peerId))

// 2. Partitioned: Bea writes away from the hub, rejoins, then leaves.
await bea.removeTransport(beaToHub.transportId)
beaDoc.log.push({ id: "i2", author: "bea", text: "while partitioned" })
await sleep(200)
out("2 partitioned: the hub holds it yet", hubHas("i2"))
beaToHub = client(hubUrl)
await bea.addTransport(beaToHub)
await beaToHub.waitForStatus("ready", { timeoutMs: 5_000 })
await until(() => hubHas("i2"))
await bea.shutdown()
await until(() => ![...hub.peers.current.keys()].includes(bea.peerId))
out("2 after rejoining, and Bea gone: at the hub", hubRow("i2"))

// 3. Relayed: Cal writes; it reaches the hub only through Ada.
calDoc.log.push({ id: "i3", author: "cal", text: "through ada" })
const relayed = await until(() => hubHas("i3"))
out("3 relayed: reached the hub", relayed)
out("3 relayed: at the hub", hubRow("i3"))
out("3 relayed: at Ada, who saw Cal connect", adaRow("i3"))

// 4. A forged author field: Cal writes, naming Ada.
calDoc.log.push({ id: "i4", author: "ada", text: "says ada wrote it" })
await until(() => hubHas("i4"))
out("4 forged field: at Ada", adaRow("i4"))
out("4 forged field: at the hub", hubRow("i4"))

// 5. A forged clientID: Cal writes under Ada's clientID, through the native
// document, while Ada appends too before either sees the other.
const calY = unwrap(calDoc) as unknown as Y.Doc
const calOwn = calY.clientID
calY.clientID = yjsClientId(ada.peerId)
calDoc.log.push({ id: "i5", author: "ada", text: "under ada's clientID" })
adaDoc.log.push({ id: "i6", author: "ada", text: "ada, at the same time" })
calY.clientID = calOwn
await sleep(1_000)
out("5 forged clientID: i5 at Ada", adaRow("i5") ?? "absent")
out("5 forged clientID: i5 at the hub", hubRow("i5") ?? "absent")
const ids = (d: { log(): { id: string }[] }) => d.log().map(r => r.id)
out("5 then the logs: hub", ids(hubDoc))
out("5 then the logs: ada", ids(adaDoc))
out("5 then the logs: cal", ids(calDoc))

// 5b. A forged clientID with no write of Ada's at the same time: Dan, synced
// with the hub, writes under Ada's clientID; then Ada writes again.
const danToHub = client(hubUrl)
const dan = new Exchange({ principal: "dan", transports: [danToHub] })
await danToHub.waitForStatus("ready", { timeoutMs: 5_000 })
const danDoc = dan.get(DOC, LogDoc)
await until(() => ids(danDoc).join() === ids(hubDoc).join())
const danY = unwrap(danDoc) as unknown as Y.Doc
const danOwn = danY.clientID
danY.clientID = yjsClientId(ada.peerId)
danDoc.log.push({ id: "i7", author: "ada", text: "dan, as ada" })
danY.clientID = danOwn
await until(() => hubHas("i7"))
out("5b forged clientID, alone: i7 at the hub", hubRow("i7") ?? "absent")
await until(() => ids(adaDoc).includes("i7"))
out("5b forged clientID, alone: i7 at Ada", adaRow("i7") ?? "absent")
adaDoc.log.push({ id: "i8", author: "ada", text: "ada, after" })
await sleep(1_000)
out("5b Ada's next write reached the hub", hubHas("i8"))
out("5b Ada's next write: at the hub", hubRow("i8"))
out("5b Ada's clientID now is yjsClientId(her seat)", (unwrap(adaDoc) as unknown as Y.Doc).clientID === yjsClientId(ada.peerId))
out("5b then the logs: hub", ids(hubDoc))
out("5b then the logs: ada", ids(adaDoc))
out("5b then the logs: dan", ids(danDoc))
await dan.shutdown()

await cal.shutdown()
await ada.shutdown()
await hub.shutdown()
process.exit(0)
