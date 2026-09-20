// host — the shell. Owns sockets, the Exchange, the harness lifecycle.
//
// Imports NO pi. Everything pi-shaped arrives through storage/.
// FC/IS: this file gathers and executes; the deciding is done by core/.

import http from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Exchange } from "@kyneta/exchange"
import { stepInPlace } from "@kyneta/schema"
import { WebsocketServerTransport, wrapNodeWebsocket } from "@kyneta/websocket-transport/server"
import { WebSocketServer } from "ws"
import { createRequire } from "node:module"

import { checkEnvironment, laneNameForWriter, planCommand, turnFinished } from "../core/index.mjs"
import { HOST_PEER_ID, SESSION_DOC_ID, reply } from "../protocol/messages.mjs"
import { Control } from "../protocol/line.mjs"
import { SessionDoc, appendStream, beginStream, endStream } from "../schema/index.mjs"
import { createAgent, newId } from "../storage/index.mjs"

const require = createRequire(import.meta.url)

/** Deterministic build guard. Refuse to start on a stale Kyneta / old loro. */
export function assertEnvironment() {
  const loroVersion = require("loro-crdt/package.json").version
  const result = checkEnvironment({
    hasStepInPlace: typeof stepInPlace === "function",
    loroVersion,
  })
  if (!result.ok) {
    throw new Error(`environment gate failed:\n  - ${result.problems.join("\n  - ")}`)
  }
  return { loroVersion, node: process.version }
}

const CLIENT_DIR = new URL("../client/", import.meta.url)

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.bundle.js", "text/javascript; charset=utf-8"],
  // loro-crdt fetches its wasm relative to the bundle URL.
  "/loro_wasm_bg.wasm": ["loro_wasm_bg.wasm", "application/wasm"],
}

export async function startHost({ port = 0, provider = "cerebras", model = "qwen-3.8-27b", log = console.log } = {}) {
  const env = assertEnvironment()
  log(`[host] env ok — loro-crdt ${env.loroVersion}, node ${env.node}, stepInPlace present`)

  const peerId = newId()
  const laneName = laneNameForWriter(peerId) // ADR-0011: never "main"

  // --- transport + exchange ------------------------------------------------
  const serverTransport = new WebsocketServerTransport()
  // The Exchange id is the address a client's Line targets, so it is the
  // agreed constant. `peerId` is a different thing: WRITER identity, which
  // names the lane (ADR-0011).
  const exchange = new Exchange({ id: HOST_PEER_ID, transports: [serverTransport] })

  // The session document is BOTH pi's storage and the thing we replicate.
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)

  // --- pi stack ------------------------------------------------------------
  let activeRunId = ""
  const agent = await createAgent({
    doc,
    peerId,
    laneName,
    provider,
    model,
    onDelta: ({ delta }) => {
      if (activeRunId !== "") appendStream(doc, activeRunId, delta)
    },
    onTurnEnd: () => {},
  })
  log(`[host] agent ready — model ${agent.modelLabel}, lane ${laneName}`)

  // --- command channel (ADR-0007) -----------------------------------------
  let state = { ready: true, busy: false }

  async function handleCommand(sender, cmd) {
    const decision = planCommand(state, cmd, newId()) // plan (pure)
    state = decision.next

    if (decision.kind === "reject") {
      sender.send(reply({ id: cmd.id, accepted: false, errorCode: decision.code, errorMessage: decision.message }))
      return
    }

    // execute
    sender.send(reply({ id: cmd.id, accepted: true, runId: decision.runId }))
    activeRunId = decision.runId
    beginStream(doc, decision.runId)
    log(`[host] run ${decision.runId.slice(-8)} <- ${JSON.stringify(decision.text.slice(0, 60))}`)
    try {
      await agent.prompt(decision.text)
    } catch (error) {
      log(`[host] run failed: ${error?.message ?? error}`)
    } finally {
      endStream(doc, decision.runId)
      activeRunId = ""
      state = turnFinished(state)
      log(`[host] run ${decision.runId.slice(-8)} done`)
    }
  }

  const listener = Control.listen(exchange)
  listener.onReceive((sender, receiver) => {
    void (async () => {
      for await (const cmd of receiver) await handleCommand(sender, cmd)
    })()
  })

  // --- http + ws -----------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", (ws) => {
    const { start } = serverTransport.handleConnection({ socket: wrapNodeWebsocket(ws) })
    start()
  })

  const httpServer = http.createServer((req, res) => {
    const entry = STATIC[(req.url ?? "/").split("?")[0]]
    if (entry === undefined) {
      res.writeHead(404).end("not found")
      return
    }
    readFile(fileURLToPath(new URL(entry[0], CLIENT_DIR))).then(
      (body) => res.writeHead(200, { "content-type": entry[1] }).end(body),
      () => res.writeHead(404).end(`missing ${entry[0]} — run \`npm run build:client\``),
    )
  })
  httpServer.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
  })

  // A stale host holding the port is the most likely startup failure, and the
  // raw EADDRINUSE stack says nothing about how to recover. Fail with an
  // instruction instead; `PINETA_PORT=0` asks the OS for any free port.
  await new Promise((resolve, reject) => {
    httpServer.once("error", (err) => {
      if (err?.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use — most likely a host left running.\n` +
              `  find it : lsof -ti :${port}\n` +
              `  stop it : lsof -ti :${port} | xargs kill\n` +
              `  or pick another port: PINETA_PORT=7392 npm run host  (PINETA_PORT=0 = any free port)`,
          ),
        )
        return
      }
      reject(err)
    })
    httpServer.listen(port, resolve)
  })
  const actualPort = httpServer.address().port

  return {
    port: actualPort,
    httpUrl: `http://localhost:${actualPort}/`,
    wsUrl: `ws://localhost:${actualPort}/ws`,
    laneName,
    peerId,
    doc,
    agent,
    async shutdown() {
      try { await agent.close() } catch {}
      try { await exchange.shutdown() } catch {}
      try { wss.close() } catch {}
      await new Promise((resolve) => httpServer.close(resolve))
    },
  }
}
