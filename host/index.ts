// host — the shell. Owns sockets, the Exchange, the harness lifecycle.
//
// Imports NO pi. Everything pi-shaped arrives through pi/.
// FC/IS: this file gathers and executes; the deciding is done by core/.

import http from "node:http"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Exchange } from "@kyneta/exchange"
import { stepInPlace } from "@kyneta/schema"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import {
  checkEnvironment,
  type InboundCommand,
  type LaneName,
  laneNameForWriter,
  planCommand,
  type TurnState,
  turnFinished,
} from "@pineta/core"
import { type Agent, createAgent, newId } from "@pineta/pi"
import {
  appendStream,
  beginStream,
  endStream,
  SessionDoc,
  type SessionDocHandle,
} from "@pineta/schema"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"
import { Control } from "../protocol/line.ts"
import { HOST_PEER_ID, reply, SESSION_DOC_ID } from "../protocol/messages.ts"

const require = createRequire(import.meta.url)

export interface EnvironmentInfo {
  readonly loroVersion: string
  readonly node: string
}

/** Deterministic build guard. Refuse to start on a stale Kyneta / old loro. */
export function assertEnvironment(): EnvironmentInfo {
  const loroVersion: string = require("loro-crdt/package.json").version
  const result = checkEnvironment({
    hasStepInPlace: typeof stepInPlace === "function",
    loroVersion,
  })
  if (!result.ok) {
    throw new Error(
      `environment gate failed:\n  - ${result.problems.join("\n  - ")}`,
    )
  }
  return { loroVersion, node: process.version }
}

export interface StartHostOptions {
  readonly port?: number
  readonly provider?: string
  readonly model?: string
  readonly log?: (message: string) => void
}

export interface RunningHost {
  readonly port: number
  readonly httpUrl: string
  readonly wsUrl: string
  /** Branded: minted by `laneNameForWriter`, so it can never be "main". */
  readonly laneName: LaneName
  readonly peerId: string
  readonly doc: SessionDocHandle
  readonly agent: Agent
  shutdown(): Promise<void>
}

export async function startHost({
  port = 0,
  provider = "cerebras",
  model = "qwen-3.8-27b",
  log = console.log,
}: StartHostOptions = {}): Promise<RunningHost> {
  const env = assertEnvironment()
  log(
    `[host] env ok — loro-crdt ${env.loroVersion}, node ${env.node}, stepInPlace present`,
  )

  const peerId = newId()
  const laneName = laneNameForWriter(peerId) // ADR-0011: never "main"

  // --- transport + exchange ------------------------------------------------
  const serverTransport = new WebsocketServerTransport()
  // The Exchange id is the address a client's Line targets, so it is the
  // agreed constant. `peerId` is a different thing: WRITER identity, which
  // names the lane (ADR-0011).
  const exchange = new Exchange({
    id: HOST_PEER_ID,
    transports: [serverTransport],
  })

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
  let state: TurnState = { ready: true, busy: false }

  const listener = Control.listen(exchange)
  type ControlSender = Parameters<Parameters<typeof listener.onReceive>[0]>[0]

  // The command arrives off a socket, so it is UNTRUSTED: the Line schema types
  // `kind` as `string`, not our `"prompt"` literal. `InboundCommand` is core's
  // permissive shape and `planCommand` does the narrowing, rejecting anything
  // that is not a well-formed prompt. Typing this parameter as our own
  // `Command` would have been a lie that only compiled because the old code was
  // untyped.
  async function handleCommand(
    sender: ControlSender,
    cmd: InboundCommand,
  ): Promise<void> {
    const decision = planCommand(state, cmd, newId()) // plan (pure)
    state = decision.next

    if (decision.kind === "reject") {
      sender.send(
        reply({
          id: cmd.id ?? "",
          accepted: false,
          errorCode: decision.code,
          errorMessage: decision.message,
        }),
      )
      return
    }

    // execute
    sender.send(
      reply({ id: cmd.id ?? "", accepted: true, runId: decision.runId }),
    )
    activeRunId = decision.runId
    beginStream(doc, decision.runId)
    log(
      `[host] run ${decision.runId.slice(-8)}${
        decision.parentId === null
          ? ""
          : ` branch<-${decision.parentId.slice(-8)}`
      } <- ${JSON.stringify(decision.text.slice(0, 60))}`,
    )
    try {
      // The reply above was the ACCEPTANCE; the run happens after it. A run pi
      // refuses (a navigation to an unknown target, say) therefore cannot
      // travel back as a rejection, so it must at least be visible here rather
      // than being swallowed by the "done" line below.
      const outcome = await agent.run(decision.text, decision.parentId)
      if (!outcome.ok) {
        log(`[host] run ${decision.runId.slice(-8)} REFUSED: ${outcome.status}`)
      }
    } catch (error) {
      log(
        `[host] run failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      endStream(doc, decision.runId)
      activeRunId = ""
      state = turnFinished(state)
      log(`[host] run ${decision.runId.slice(-8)} done`)
    }
  }

  listener.onReceive((sender, receiver) => {
    void (async () => {
      for await (const cmd of receiver) await handleCommand(sender, cmd)
    })()
  })

  // --- http + ws -----------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", ws => {
    const { start } = serverTransport.handleConnection({
      socket: wrapNodeWebsocket(ws),
    })
    start()
  })

  const httpServer = http.createServer()

  // Vite serves the client: index.html, module transforms, wasm, HMR. One
  // node:http server is shared, so there is a single port and a single origin.
  const vite = await createViteServer({
    root: fileURLToPath(new URL("../client/", import.meta.url)),
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    server: { middlewareMode: true, hmr: { server: httpServer } },
  })
  httpServer.on("request", (req, res) => {
    vite.middlewares(req, res)
  })

  // ROUTE the upgrade. `noServer` + an explicit /ws test is what lets our sync
  // socket and Vite's HMR socket share a port: anything that is not /ws falls
  // through to Vite's own upgrade listener (attached via hmr.server above).
  // Handling every upgrade here — which is what this did before Vite — would
  // swallow HMR silently.
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      wss.handleUpgrade(req, socket, head, ws =>
        wss.emit("connection", ws, req),
      )
    }
  })

  // A stale host holding the port is the most likely startup failure, and the
  // raw EADDRINUSE stack says nothing about how to recover. Fail with an
  // instruction instead; `PINETA_PORT=0` asks the OS for any free port.
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
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
  const address = httpServer.address()
  if (address === null || typeof address === "string") {
    throw new Error("http server did not bind to a TCP port")
  }
  const actualPort = address.port

  return {
    port: actualPort,
    httpUrl: `http://localhost:${actualPort}/`,
    wsUrl: `ws://localhost:${actualPort}/ws`,
    laneName,
    peerId,
    doc,
    agent,
    async shutdown() {
      try {
        await agent.close()
      } catch {}
      try {
        await exchange.shutdown()
      } catch {}
      try {
        wss.close()
      } catch {}
      await new Promise<void>(resolve => {
        httpServer.close(() => resolve())
      })
    },
  }
}
