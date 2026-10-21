// S343's probe, run with `node` in a directory holding @kyneta/exchange,
// schema, yjs-schema and websocket-transport 5.0.0, yjs 13.6.33 and ws,
// outside the repo.
// What Kyneta 5.0.0 changes for ADR-0202: policies that report their own
// changes, the re-register trap, and unrecorded logs under undo.

import http from "node:http"
import type { AddressInfo } from "node:net"
import { createUndoStack, Exchange, sync } from "@kyneta/exchange"
import { batch, Interpret, Schema } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import { WebsocketServerTransport, wrapNodeWebsocket } from "@kyneta/websocket-transport/server"
import { yjs } from "@kyneta/yjs-schema"
import { WebSocketServer } from "ws"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 3_000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (pred()) return true; await sleep(10) }
  return pred()
}

const Canvas = yjs.bind(Schema.struct({
  title: Schema.text(),
  intents: Schema.list.unrecorded(Schema.struct.json({ kind: Schema.string(), key: Schema.string() })),
}))
const DOC = "canvas:c1"

// Membership the policy reads, and how it says it changed.
const members = new Set<string>(["ada"])
const listeners = new Set<() => void>()
const changed = () => { for (const l of listeners) l() }
let calls = 0
const membership = {
  name: "membership",
  canShare: (id: string, peer: { principal: string }) => {
    calls++
    return id === DOC ? peer.principal === "hub" || members.has(peer.principal) : undefined
  },
  subscribe: (onChange: () => void) => { listeners.add(onChange); return () => listeners.delete(onChange) },
}

const server = new WebsocketServerTransport()
const hub = new Exchange({
  principal: "hub", type: "service", transports: [server], authority: "self",
  resolve: id => (id === DOC ? Interpret(Canvas) : undefined),
})
hub.register(membership)
const wss = new WebSocketServer({ noServer: true })
wss.on("connection", ws => server.handleConnection({ socket: wrapNodeWebsocket(ws) })?.start())
const httpServer = http.createServer()
httpServer.on("upgrade", (req, s, head) => wss.handleUpgrade(req, s, head, ws => wss.emit("connection", ws, req)))
await new Promise<void>(r => httpServer.listen(0, "127.0.0.1", r))
const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/`
const hubDoc = hub.get(DOC, Canvas)
hubDoc.title.insert(0, "Plan")

async function member(principal: string, at = url) {
  const t = new WebsocketClientTransport({ url: at, WebSocket })
  const ex = new Exchange({ principal, transports: [t], resolve: id => (id === DOC ? Interpret(Canvas) : undefined) })
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  return ex
}
const ada = await member("ada")
const bea = await member("bea")
const adaDoc = ada.get(DOC, Canvas)
out("ada, a member, receives it", await until(() => adaDoc.title() === "Plan"))
await sleep(300)
out("bea, not yet a member, holds it unasked", bea.has(DOC))

// 1. Bea added while connected, with no reconnect and no asking again.
const before = calls
members.add("bea"); changed()
const added = await until(() => bea.has(DOC) && bea.get(DOC, Canvas).title() === "Plan")
out("1 bea added: sent the document, unasked", added)
out("1 canShare calls the change made", calls - before)
const beaDoc = bea.get(DOC, Canvas)

// 2. Bea removed: told, and sent nothing more.
const states: string[] = []
sync(beaDoc).onPeerSyncChange(s => states.push(JSON.stringify(s.map(p => p.state))))
members.delete("bea"); changed()
await sleep(300)
hubDoc.title.insert(hubDoc.title().length, " v2")
await until(() => adaDoc.title() === "Plan v2")
await sleep(300)
out("2 bea removed: her copy now reads", beaDoc.title())
out("2 bea's peer states after removal", states.slice(-1))
out("2 bea still holds a copy", bea.has(DOC))

// 3. The re-register trap: the same policy object registered again by name.
// Membership refuses cal; registered twice, is cal still refused?
hub.register(membership)
const cal = await member("cal")
await sleep(500)
out("3 same policy object registered twice: cal (no member) was sent it", cal.has(DOC))

// 4. Unrecorded logs under undo.
const stack = await createUndoStack({
  exchange: ada, docId: "undo:ada", key: "k", scope: id => id === DOC,
  annotate: (reverting: any, draft: any) => draft.intents.push({ kind: reverting.direction, key: reverting.step.id }),
})
stack.gesture(() => batch(adaDoc, d => {
  d.title.insert(d.title().length, " edited")
  d.intents.push({ kind: "edit", key: "title" })
}))
await stack.undo()
out("4 after undo, the title", adaDoc.title())
out("4 after undo, the intents", adaDoc.intents().map((i: any) => i.kind))

await ada.shutdown(); await bea.shutdown(); await hub.shutdown(); httpServer.close()
process.exit(0)
