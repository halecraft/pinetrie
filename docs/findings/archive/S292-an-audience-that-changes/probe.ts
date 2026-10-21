// S292's probe: a hub whose canShare reads a membership set that changes
// while peers are connected. No pine·trie code. Run as
// apps/pinetrie/e2e/s292-probe.ts with `node`: its imports resolve from
// there, and one points into the pnpm store by absolute path.

import http from "node:http"
import type { AddressInfo } from "node:net"
import {
  createInMemoryStore,
  Exchange,
  sync,
  whenSettled,
} from "@kyneta/exchange"
import { Interpret, Schema } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import { WebSocketServer } from "ws"
import { yjs } from "/workspace/node_modules/.pnpm/@kyneta+yjs-schema@4.0.0_@kyneta+changefeed@4.0.0_@kyneta+schema@4.0.0_yjs@13.6.33/node_modules/@kyneta/yjs-schema/dist/index.js"

const Canvas = yjs.bind(Schema.struct({ notes: Schema.record(Schema.string()) }))
const DOC = "canvas:c1"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 3_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred()) return true
    await sleep(5)
  }
  return pred()
}

// The hub's audience: canvas:* to its members, by principal.
const members = new Map<string, Set<string>>([[DOC, new Set(["ada"])]])
let shareCalls = 0
let shareMs = 0
const memberOf = (docId: string, principal: string | undefined) =>
  members.get(docId)?.has(principal ?? "") ?? false
const audience = {
  name: "audience",
  canShare: (docId: string, peer: { principal?: string }) => {
    shareCalls++
    const t = performance.now()
    const answer = docId.startsWith("canvas:") ? memberOf(docId, peer.principal) : undefined
    shareMs += performance.now() - t
    return answer
  },
  canWrite: (docId: string, peer: { principal?: string }) => {
    if (!docId.startsWith("canvas:")) return undefined
    return peer.principal === "hub" || memberOf(docId, peer.principal)
  },
}

const server = new WebsocketServerTransport()
const hub = new Exchange({
  principal: "hub",
  type: "service",
  transports: [server],
  store: createInMemoryStore(),
  authority: "self",
  resolve: id => (id.startsWith("canvas:") ? Interpret(Canvas) : undefined),
})
hub.register(audience)
const wss = new WebSocketServer({ noServer: true })
wss.on("connection", ws =>
  server.handleConnection({ socket: wrapNodeWebsocket(ws) }).start(),
)
const httpServer = http.createServer()
httpServer.on("upgrade", (req, socket, head) =>
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req)),
)
await new Promise<void>(r => httpServer.listen(0, "127.0.0.1", r))
const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/`
const hubDoc = hub.get(DOC, Canvas)
const hubLog: { dir: string; type: string; peer?: string; layer: string; change?: string }[] = []
hub.observe(e => {
  const m = e as unknown as { layer: string; kind?: string; dir?: string; msgType?: string; peer?: string; change?: string }
  if (m.layer === "protocol" || m.layer === "directory")
    hubLog.push({ layer: m.layer, dir: m.dir ?? "", type: m.msgType ?? m.kind ?? "", peer: m.peer, change: m.change, raw: JSON.stringify(e).slice(0, 160) } as never)
})
hubDoc.notes.set("n0", "hello")

// Every protocol message a peer receives, by type and document.
type Seen = { type: string; doc: string | undefined; docs: readonly string[] | undefined }
async function peer(principal: string) {
  const t = new WebsocketClientTransport({ url, WebSocket, reconnect: { enabled: false } })
  const ex = new Exchange({
    principal,
    transports: [t],
    resolve: id => (id.startsWith("canvas:") ? Interpret(Canvas) : undefined),
  })
  const seen: Seen[] = []
  ex.observe(e => {
    const m = e as unknown as { layer: string; kind?: string; dir?: string; msgType?: string; docId?: string; docs?: readonly string[] }
    if (m.layer === "protocol" && m.kind === "message" && m.dir === "in" && m.msgType !== undefined)
      seen.push({ type: m.msgType, doc: m.docId, docs: m.docs })
  })
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  await sleep(200)
  return { ex, seen, transport: t }
}
const about = (p: { seen: Seen[] }, doc: string) =>
  p.seen
    .filter(s => s.doc === doc || s.docs?.includes(doc))
    .map(s => s.type)
const noteOf = (ex: Exchange, key: string) =>
  ex.has(DOC) ? ex.get(DOC, Canvas).notes.get(key) : undefined

const ada = await peer("ada")
const adaDoc = ada.ex.get(DOC, Canvas)
out("setup: ada, a member, reads the canvas", await until(() => adaDoc.notes.get("n0") === "hello"))

// 1. A connected peer added to the audience.
{
  const bea = await peer("bea")
  out("1 bea, refused, was announced the canvas", about(bea, DOC).includes("present"))
  out("1 bea holds it unasked", bea.ex.has(DOC))
  members.get(DOC)?.add("bea")
  hubDoc.notes.set("n1", "after bea was added")
  await sleep(500)
  out("1 added, then a hub write: bea holds it", bea.ex.has(DOC))
  out("1 added: messages about it bea received", about(bea, DOC))
  // A new object: the same object registered again by name removes it
  // (s292-reregister.ts).
  hub.register({ ...audience })
  await sleep(500)
  out("1 the policy registered again by name: bea holds it", bea.ex.has(DOC))
  hub.suspend(DOC)
  hub.resume(DOC)
  const got = await until(() => noteOf(bea.ex, "n1") === "after bea was added")
  out("1 hub suspend and resume: bea reads it", got)
  out("1 hub suspend and resume: ada received", about(ada, DOC).filter(t => t !== "offer"))
  out("1 hub suspend and resume: ada still reads, and is synced", [
    adaDoc.notes.get("n1"),
    sync(adaDoc).peerStates.map(s => s.state),
  ])
}

// 1. A peer that asked while refused, then asks again once added.
{
  const dan = await peer("dan")
  const danDoc = dan.ex.get(DOC, Canvas)
  await whenSettled(danDoc, { offlineAfter: 2_000 })
  out("1 dan asked while refused: his state, his copy", [
    sync(danDoc).peerStates.map(s => s.state),
    danDoc.notes(),
  ])
  out("1 dan asked while refused: messages received", about(dan, DOC))
  members.get(DOC)?.add("dan")
  hubDoc.notes.set("n2", "after dan was added")
  await sleep(500)
  out("1 dan added, a hub write: dan reads", danDoc.notes.get("n2") ?? null)
  dan.ex.suspend(DOC)
  dan.ex.resume(DOC)
  out("1 dan suspends and resumes his copy: dan reads", await until(() => danDoc.notes.get("n2") === "after dan was added"))
}

// 1. A peer added while refused, then reconnecting.
{
  const eve = await peer("eve")
  members.get(DOC)?.add("eve")
  await sleep(300)
  out("1 eve added: holds it before reconnecting", eve.ex.has(DOC))
  const mark = hubLog.length
  await eve.ex.removeTransport(eve.transport.transportId)
  const left = await until(() => hubLog.slice(mark).some(h => h.layer === "directory" && h.type === "peer"))
  out("1 the hub heard eve's channel close before she came back", left)
  const t = new WebsocketClientTransport({ url, WebSocket, reconnect: { enabled: false } })
  await eve.ex.addTransport(t)
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  out("1 eve reconnected: announced the canvas", await until(() => about(eve, DOC).includes("present")))
  out("1 eve reconnected: holds it unasked", eve.ex.has(DOC))
  out("1 eve: every present received", eve.seen.filter(s => s.type === "present").map(s => s.docs))
  out("1 the hub, as eve reconnected", hubLog.slice(mark).filter(h => h.layer === "directory" ? h.type === "peer" : h.dir === "out").map(h => (h.layer === "directory" ? h.change : `${h.dir} ${h.type}`)))
  const eveDoc = eve.ex.get(DOC, Canvas)
  out("1 eve reconnected, then asks: reads", await until(() => eveDoc.notes.get("n0") === "hello"))
}

// 2. A member removed while connected and synced.
{
  const beaGone = members.get(DOC)
  beaGone?.delete("ada")
  const before = ada.seen.length
  hubDoc.notes.set("n3", "after ada was removed")
  await sleep(500)
  out("2 ada removed, a hub write: ada reads it", adaDoc.notes.get("n3") ?? null)
  out("2 ada removed: messages received since", ada.seen.slice(before).map(s => s.type))
  out("2 ada removed: she keeps her copy", adaDoc.notes.get("n2") ?? null)
  out("2 ada removed: her sync state", sync(adaDoc).peerStates.map(s => s.state))
  adaDoc.notes.set("n4", "ada writes after removal")
  await sleep(500)
  out("2 ada writes after removal: the hub holds it", hubDoc.notes.get("n4") ?? null)
  out("2 ada writes after removal: she was told (refuse)", ada.seen.slice(before).some(s => s.type === "refuse"))
}

// 3. A request by id from a refused peer, beside an id that does not exist.
{
  const cy = await peer("cy")
  const real = cy.ex.get(DOC, Canvas)
  const none = cy.ex.get("canvas:none", Canvas)
  await whenSettled(real, { offlineAfter: 2_000 })
  await whenSettled(none, { offlineAfter: 2_000 })
  await sleep(200)
  out("3 cy, refused, asks for the canvas: received", about(cy, DOC))
  out("3 cy asks for an id that does not exist: received", about(cy, "canvas:none"))
  out("3 cy's states, canvas then none", [
    sync(real).peerStates.map(s => s.state),
    sync(none).peerStates.map(s => s.state),
  ])
}

// 4. What canShare costs: 1,000 documents, 50 peers, each peer a member of
// half of them and holding 10.
{
  const N = 1000
  const P = 50
  for (let i = 0; i < N; i++) {
    const id = `canvas:d${i}`
    const m = new Set<string>()
    for (let j = 0; j < P; j++) if ((i + j) % 2 === 0) m.add(`p${j}`)
    members.set(id, m)
    hub.get(id, Canvas).notes.set("n", `${i}`)
  }
  await sleep(300)
  let calls = shareCalls
  const spent = shareMs
  const peers = []
  for (let j = 0; j < P; j++) peers.push(await peer(`p${j}`))
  out("4 a peer connecting: presents it received, docs in them", peers[7]?.seen.filter(s => s.type === "present").map(s => s.docs?.length))
  out("4 50 peers connect: canShare calls", shareCalls - calls)
  out("4 50 peers connect: ms inside canShare", Math.round((shareMs - spent) * 10) / 10)
  for (const [j, p] of peers.entries())
    for (let k = 0; k < 10; k++) p.ex.get(`canvas:d${(j + k * 2) % N}`, Canvas)
  await sleep(1_500)
  const held = peers.filter((p, j) => p.ex.get(`canvas:d${j % N}`, Canvas).notes.get("n") === `${j % N}`).length
  out("4 peers reading a document they are members of", `${held}/${P}`)
  calls = shareCalls
  members.get("canvas:d0")?.add("p1")
  await sleep(300)
  out("4 a membership changes: canShare calls", shareCalls - calls)
  calls = shareCalls
  hub.get("canvas:d0", Canvas).notes.set("n", "written")
  await sleep(300)
  out("4 one hub write: canShare calls", shareCalls - calls)
  calls = shareCalls
  hub.suspend("canvas:d0")
  hub.resume("canvas:d0")
  await sleep(300)
  out("4 one document suspended and resumed: canShare calls", shareCalls - calls)
  const t0 = performance.now()
  for (let i = 0; i < 200_000; i++) audience.canShare(`canvas:d${i % N}`, { principal: `p${i % P}` })
  out("4 the policy alone: microseconds a call", ((performance.now() - t0) * 1000) / 200_000)
}

await hub.shutdown()
httpServer.close()
process.exit(0)
