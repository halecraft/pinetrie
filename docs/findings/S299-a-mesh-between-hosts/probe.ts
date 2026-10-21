// S299's probe: Kyneta over a Tailscale mesh run by Headscale. One file,
// three roles, run inside the mesh's containers with `node probe.ts <role>`:
//
//   tether <bind> <mode>   a host that writes the agent's record; `mode` is
//                          "mesh" (each connection's principal must be its
//                          mesh identity) or "stated" (Kyneta as it is: the
//                          principal a peer states)
//   member <principal> <url> <out>
//                          a peer stating `principal`, writing its drafts and
//                          the thread's log, reading the agent's record
//
// The tether learns a connection's mesh identity from tailscaled's LocalAPI
// (`tailscale whois`), by the connection's source address, or from the
// identity headers `tailscale serve` adds when it proxies.

import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import http from "node:http"
import { hostname } from "node:os"
import { Exchange, sync } from "@kyneta/exchange"
import { batch, Interpret, Schema } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import { decodeBinaryFrame, decodeWireMessage, MessageType } from "@kyneta/wire"
import { yjs } from "@kyneta/yjs-schema"
import WebSocket, { WebSocketServer } from "ws"

const Drafts = yjs.bind(Schema.struct({ slots: Schema.record(Schema.string()) }))
const Log = yjs.bind(
  Schema.struct({
    intents: Schema.list(
      Schema.struct.json({ id: Schema.string(), author: Schema.string(), text: Schema.string() }),
    ),
  }),
)
const AgentRecord = yjs.bind(Schema.struct({ entries: Schema.list(Schema.string()) }))
const HOST = "host@s299.test"

/** Who may write a document: the host its record, a person their drafts. */
const writersPolicy = {
  name: "s299.writers",
  canWrite: (docId: string, peer: { principal: string }) => {
    if (docId.startsWith("record:")) return peer.principal === HOST
    if (docId.startsWith("drafts:"))
      return peer.principal === HOST || docId === `drafts:${peer.principal}`
    return undefined
  },
  canShare: (docId: string, peer: { principal: string }) =>
    docId.startsWith("drafts:")
      ? peer.principal === HOST || docId === `drafts:${peer.principal}`
      : undefined,
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 10_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (pred()) return true
    await sleep(50)
  }
  return pred()
}

/** The mesh identity of the node at `ip`, or null: tailscaled's whois. */
function meshIdentity(ip: string): { login: string; node: string; key: string } | null {
  // Nebula: a source address is bound to the certificate that carries it,
  // so the table of certificates the CA signed names it.
  if (ip.startsWith("192.168.100.")) {
    const names = JSON.parse(readFileSync("/probe/nebula/names.json", "utf8"))
    return names[ip] ?? null
  }
  try {
    const out = execFileSync("tailscale", ["whois", "--json", ip], { encoding: "utf8" })
    const d = JSON.parse(out)
    return { login: d.UserProfile.LoginName, node: d.Node.Name, key: d.Node.Key }
  } catch {
    return null
  }
}

/** A mesh login as pine·trie's principal: Headscale's user name, at the mesh's domain. */
const principalOfLogin = (login: string) =>
  login.includes("@") ? login : `${login}@s299.test`

async function tether(bind: string, mode: string) {
  const log = (line: string) => {
    console.log(line)
    appendFileSync(`/probe/out/tether-${mode}.log`, `${line}\n`)
  }
  const server = new WebsocketServerTransport()
  const ex = new Exchange({
    principal: HOST,
    type: "service",
    transports: [server],
    authority: "self",
    resolve: id =>
      id.startsWith("drafts:")
        ? Interpret(Drafts)
        : id.startsWith("log:")
          ? Interpret(Log)
          : undefined,
  })
  ex.register(writersPolicy)
  ex.register({
    name: "s299.connect",
    canConnect: peer => {
      log(`canConnect: stated ${peer.principal}`)
      return undefined
    },
  })
  const record = ex.get("record:t1", AgentRecord)
  const thread = ex.get("log:t1", Log)
  record.entries.push("agent: hello from the tether")

  const wss = new WebSocketServer({ noServer: true })
  const httpServer = http.createServer((_req, res) => res.end("s299"))
  httpServer.on("upgrade", (req, socket, head) => {
    const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "")
    const headerLogin = req.headers["tailscale-user-login"]
    const who =
      typeof headerLogin === "string"
        ? { login: headerLogin, node: "(serve header)", key: "" }
        : meshIdentity(ip)
    log(`upgrade from ${ip}: mesh says ${who === null ? "nobody" : `${who.login} (${who.node})`}`)
    if (mode !== "stated" && who === null) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
      log(`  refused at upgrade: not a node of the mesh`)
      return
    }
    const proven = who === null ? null : principalOfLogin(who.login)
    wss.handleUpgrade(req, socket, head, ws => {
      const wrapped = wrapNodeWebsocket(ws)
      const inner = wrapped.onMessage.bind(wrapped)
      // The binding Kyneta lacks: the principal stated in this connection's
      // `establish` must be the one the mesh proved for it.
      let checked = mode === "stated"
      wrapped.onMessage = handler =>
        inner(data => {
          if (!checked && typeof data !== "string") {
            const frame = decodeBinaryFrame(data)
            if (frame.content.kind === "complete") {
              const msg = decodeWireMessage(frame.content.payload)
              if (msg.t === MessageType.Establish) {
                checked = true
                if (msg.pr !== proven) {
                  log(`  refused at establish: stated ${msg.pr}, mesh proved ${proven}`)
                  ws.close(4003, "principal is not the mesh's")
                  return
                }
                log(`  accepted: stated ${msg.pr} = mesh ${proven}`)
              }
            }
          }
          handler(data)
        })
      server.handleConnection({ socket: wrapped }).start()
    })
  })
  await new Promise<void>(r => httpServer.listen(7000, bind, r))
  log(`tether (${mode}) listening on ${bind}:7000, seat ${ex.peerId}`)
  // Report what reached it, every second, for the driver to read.
  setInterval(() => {
    const drafts = [...ex.documents()]
      .map(([id]) => id)
      .filter(id => id.startsWith("drafts:"))
      .map(id => [id, ex.get(id, Drafts).slots()])
    writeFileSync(
      `/probe/out/tether-${mode}.state.json`,
      JSON.stringify({ drafts, log: thread.intents(), record: record.entries() }),
    )
  }, 1000)
}

async function member(principal: string, url: string, out: string) {
  const t = new WebsocketClientTransport({ url, WebSocket: WebSocket as never, reconnect: { enabled: false } })
  const ex = new Exchange({ principal, transports: [t] })
  ex.register(writersPolicy)
  let status = "connecting"
  try {
    await t.waitForStatus("ready", { timeoutMs: 8_000 })
    status = "ready"
  } catch (e) {
    status = `not ready: ${String(e).slice(0, 80)}`
  }
  const record = ex.get("record:t1", AgentRecord)
  const thread = ex.get("log:t1", Log)
  const mine = ex.get(`drafts:${principal}`, Drafts)
  const results: Record<string, unknown> = { principal, url, status }
  try {
    batch(mine, d => d.slots.set("t1", `card written on ${hostname()}`))
    results.draftWrite = "ok"
  } catch (e) {
    results.draftWrite = String(e).slice(0, 80)
  }
  // An attempt at someone else's drafts: refused here by policy.
  try {
    ex.get("drafts:ada@s299.test", Drafts).slots.set(`from ${hostname()}`, principal)
    results.adaDraftWrite = "ok"
  } catch (e) {
    results.adaDraftWrite = (e as Error).name
  }
  thread.intents.push({ id: `${principal}-1`, author: principal, text: `hi from ${principal}, on ${hostname()}` })
  results.gotRecord = await until(() => record.entries().length > 0, 6_000)
  results.record = record.entries()
  results.peers = [...ex.peers().values()].map(p => p.principal)
  results.syncedWithTether = sync(thread).peerStates.map(s => s.state)
  writeFileSync(out, JSON.stringify(results, null, 1))
  console.log(JSON.stringify(results))
  await sleep(1500)
  await ex.shutdown()
  process.exit(0)
}

const [role, ...args] = process.argv.slice(2)
if (role === "tether") await tether(args[0] ?? "0.0.0.0", args[1] ?? "mesh")
else if (role === "member") await member(args[0], args[1], args[2])
else throw new Error(`no role ${role}`)
