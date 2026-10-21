// S297's host-store probe: what a hub with a SQLite store keeps for each seat
// that opens a Line to it and leaves, when it keeps every Line (Kyneta's
// default `departureTimeout`), over `node:sqlite` as pine·trie's host opens it.
// Run with `node` in a directory holding versions.json's packages.

import { mkdtempSync, statSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Exchange, Line, whenPeer } from "@kyneta/exchange"
import { Schema } from "@kyneta/schema"
import { createSqliteStore } from "@kyneta/sqlite-store"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import { WebsocketServerTransport, wrapNodeWebsocket } from "@kyneta/websocket-transport/server"
import { WebSocketServer } from "ws"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// A request about the size of a pine·trie send: its text, its target, its how.
const Cmd = Line.protocol({
  topic: "cmd",
  schema: Schema.struct({ kind: Schema.string(), body: Schema.string() }),
})
const BODY = "x".repeat(300)

const file = path.join(mkdtempSync(path.join(tmpdir(), "s297-")), "hub.db")
const db = new DatabaseSync(file)
const store = createSqliteStore({
  exec: (sql, ...p) => void db.prepare(sql).run(...(p as never[])),
  iterate: <T>(sql: string, ...p: unknown[]) => db.prepare(sql).iterate(...(p as never[])) as Iterable<T>,
  transaction<R>(fn: () => R): R {
    db.exec("BEGIN")
    try {
      const r = fn()
      db.exec("COMMIT")
      return r
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  },
  close: () => {},
})

const server = new WebsocketServerTransport()
const hub = new Exchange({ principal: "hub", type: "service", transports: [server], store, authority: "self" })
Cmd.listen(hub).onReceive((reply, receiver) => {
  void (async () => {
    for await (const m of receiver) reply.send({ kind: "answer", body: m.kind })
  })()
})
const wss = new WebSocketServer({ noServer: true })
wss.on("connection", ws => server.handleConnection({ socket: wrapNodeWebsocket(ws) }).start())
const httpServer = http.createServer()
httpServer.on("upgrade", (req, s, h) => wss.handleUpgrade(req, s, h, ws => wss.emit("connection", ws, req)))
await new Promise<void>(r => httpServer.listen(0, "127.0.0.1", r))
const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/`

type Row = { prefix: string; docs: number; records: number; bytes: number }
const stored = (): Row[] =>
  db
    .prepare(
      `SELECT CASE WHEN doc_id LIKE 'line:%' THEN 'line' ELSE doc_id END AS prefix,
              COUNT(DISTINCT doc_id) AS docs, COUNT(*) AS records,
              SUM(COALESCE(LENGTH(payload),0) + COALESCE(LENGTH(blob),0)) AS bytes
         FROM kyneta_records GROUP BY prefix`,
    )
    .all() as Row[]
const metaBytes = () =>
  (db.prepare("SELECT COUNT(*) AS n, SUM(LENGTH(doc_id)+LENGTH(data)) AS b FROM kyneta_doc_meta").get() as { n: number; b: number })

async function seat(messages: number) {
  const t = new WebsocketClientTransport({ url, WebSocket, reconnect: { enabled: false } })
  const ex = new Exchange({ principal: "ada@s297.test", transports: [t] })
  await t.waitForStatus("ready", { timeoutMs: 5_000 })
  const peer = await whenPeer(ex, p => p.principal === "hub")
  const sender = Cmd.sender(ex, peer.peerId)
  const receiver = Cmd.claimReceiver(ex, peer.peerId)
  const it = receiver[Symbol.asyncIterator]()
  for (let i = 0; i < messages; i++) {
    sender.send({ kind: `k${i}`, body: BODY })
    await it.next()
  }
  await sleep(100)
  await ex.shutdown()
}

const round = async (label: string, seats: number, messages: number) => {
  const before = stored().find(r => r.prefix === "line") ?? { docs: 0, records: 0, bytes: 0 }
  const metaBefore = metaBytes()
  for (let i = 0; i < seats; i++) await seat(messages)
  await sleep(500)
  const after = stored().find(r => r.prefix === "line") ?? { docs: 0, records: 0, bytes: 0 }
  const metaAfter = metaBytes()
  const docs = after.docs - before.docs
  const bytes = after.bytes - before.bytes + (metaAfter.b - metaBefore.b)
  out(`${label}: Line documents kept per seat`, docs / seats)
  out(`${label}: records kept per seat`, (after.records - before.records) / seats)
  out(`${label}: bytes kept per seat (records and their meta)`, Math.round(bytes / seats))
}

await round("1 message each, 50 seats", 50, 1)
await round("20 messages each, 20 seats", 20, 20)
await round("200 messages each, 5 seats", 5, 200)

out("hub peers still known after every seat left", hub.peers().size)
{
  const before = stored().find(r => r.prefix === "line")
  const ids = (db.prepare("SELECT DISTINCT doc_id FROM kyneta_records WHERE doc_id LIKE 'line:%'").all() as { doc_id: string }[]).map(r => r.doc_id)
  const outcome = { compacted: 0, refused: 0, firstError: "" }
  for (const id of ids) {
    try {
      await hub.compact(id)
      outcome.compacted++
    } catch (e) {
      outcome.refused++
      outcome.firstError ||= String(e).slice(0, 160)
    }
  }
  const after = stored().find(r => r.prefix === "line")
  out("compacting every Line on the hub", outcome)
  out("Line bytes before and after compacting", [before?.bytes, after?.bytes])
  const hubOut = (db.prepare("SELECT doc_id, COUNT(*) AS n, SUM(COALESCE(LENGTH(payload),0)+COALESCE(LENGTH(blob),0)) AS b FROM kyneta_records WHERE doc_id LIKE 'line:%' GROUP BY doc_id ORDER BY b DESC LIMIT 4").all())
  out("the largest Line documents after compacting", hubOut)
}
await hub.shutdown()
db.exec("VACUUM")
out("the file after VACUUM, bytes", statSync(file).size)
out("stored by kind", stored())
httpServer.close()
process.exit(0)
