// host — the shell. Owns sockets, the Exchange, the harness lifecycle.
//
// Imports NO pi. Everything pi-shaped arrives through pi/.
// FC/IS: this file gathers and executes; the deciding is done by core/.

import http from "node:http"
import { createRequire } from "node:module"
import { networkInterfaces } from "node:os"
import path from "node:path"
import { Exchange, whenHydrated } from "@kyneta/exchange"
import { stepInPlace } from "@kyneta/schema"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import {
  checkEnvironment,
  ERR,
  type Intent,
  type LaneName,
  planStop,
  type RunId,
  referenceId,
  runId,
  threadOf,
  type WriterId,
  writerId,
} from "@pineta/core"
import {
  type ChatDetails,
  type ChatMessage,
  type CitedEntry,
  displayName,
  encodeChat,
  entryText,
  planChat,
  planDrain,
  planReference,
  planStartup,
  settleRun,
} from "@pineta/marginalia"
import { type Agent, createAgent, type ModelChoice, newId } from "@pineta/pi"
import {
  decodeCommand,
  encodeOutcome,
  type Outcome,
  type WireCommand,
} from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import { HOST_PEER_ID, SESSION_DOC_ID } from "@pineta/protocol/messages"
import {
  readLanes,
  readOutbox,
  readParticipantNames,
  readParticipants,
  readTreeIndex,
} from "@pineta/reads"
import {
  applyStreamOps,
  beginStream,
  clearStreams,
  endStream,
  planStream,
  readActiveRun,
  readEntryMessage,
  readStreams,
  SessionDoc,
  type SessionDocHandle,
} from "@pineta/schema"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"
import {
  admits,
  DEFAULT_BIND,
  isLoopback,
  KEY_COOKIE,
  newKey,
  urlHost,
} from "./admission.ts"
import { openStore } from "./store.ts"

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
  /** The address to listen on. Default loopback: only this machine. */
  readonly bind?: string
  /**
   * The invite key, off loopback. Absent, a fresh one is made; on loopback
   * there is none, since only this machine can connect.
   */
  readonly key?: string
  /** No default: a suite that forgot one must not spend the person's models. */
  readonly model: ModelChoice
  /** Where the agent's tools run; absent or null, it has none. */
  readonly tools?: { readonly cwd: string } | null
  /** Vite's hot reload. Off for a host whose agent edits the client it serves. */
  readonly hmr?: boolean
  /** A SQLite file to keep the session in; absent or null, memory only. */
  readonly store?: string | null
  readonly log?: (message: string) => void
}

export interface RunningHost {
  readonly port: number
  readonly httpUrl: string
  readonly wsUrl: string
  readonly doc: SessionDocHandle
  readonly agent: Agent
  /** The invite key, or null on loopback. */
  readonly key: string | null
  /** Links a collaborator can open, key included; the local URL on loopback. */
  readonly invites: readonly string[]
  shutdown(): Promise<void>
}

export async function startHost({
  port = 0,
  bind = DEFAULT_BIND,
  key: givenKey,
  model,
  tools = null,
  hmr = true,
  store: storeFile = null,
  log = console.log,
}: StartHostOptions): Promise<RunningHost> {
  const key = isLoopback(bind) ? null : (givenKey ?? newKey())
  const env = assertEnvironment()
  log(
    `[host] env ok — loro-crdt ${env.loroVersion}, node ${env.node}, stepInPlace present`,
  )

  // --- transport + exchange ------------------------------------------------
  const serverTransport = new WebsocketServerTransport()
  // The Exchange id is the address a client's Line targets, so it is the
  // agreed constant. The host has no WRITER identity: writers are the
  // connected clients, identified by the transport, and they own no lanes;
  // lanes belong to threads (ADR-0020).
  const stored = storeFile === null ? null : openStore(storeFile)
  const exchange = new Exchange({
    id: HOST_PEER_ID,
    transports: [serverTransport],
    ...(stored === null ? {} : { stores: [stored.store] }),
  })

  // The session document is BOTH pi's storage and the thing we replicate.
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  // A stored session loads asynchronously; pi must see it before it starts.
  // Only storage is awaited: the host is the authority, with no peer upstream.
  if (stored !== null) await whenHydrated(doc)

  // --- pi stack ------------------------------------------------------------
  const agent = await createAgent({
    doc,
    replicaId: newId(),
    model,
    tools,
    // Gather the lane's streams from the document, plan, execute. The document
    // records what each lane is running and streaming; a second copy here
    // would be two sources of truth.
    onStream: event => {
      applyStreamOps(
        doc,
        planStream({
          event,
          open: readStreams(doc),
          running: readActiveRun(doc, event.lane) !== undefined,
          newId,
        }),
      )
    },
  })
  log(
    `[host] agent ready — model ${agent.modelLabel}; tools ${tools === null ? "off" : `on, in ${tools.cwd}`}`,
  )

  // --- command channel (ADR-0007) -----------------------------------------
  const listener = Control.listen(exchange)
  type ControlSender = Parameters<Parameters<typeof listener.onReceive>[0]>[0]

  /**
   * One serial executor for every command, and for each drain step. A step
   * gathers, plans and executes with nothing in between, so its plan is still
   * true when it is carried out: with one host, this is what makes "a late
   * message goes after" and "a busy lane holds" hold. Runs are started inside a
   * step but continue outside it, so one long run never blocks another
   * thread's commands.
   */
  let tail: Promise<void> = Promise.resolve()
  function serially(step: () => Promise<void>): Promise<void> {
    const run = tail.then(step, step)
    tail = run.catch(error => {
      log(
        `[host] step failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    return run
  }

  /**
   * Start one turn on a thread's lane, streaming into the document. Its end
   * enqueues one drain step for that lane: "a run ended" is the only state the
   * outbox's loop needs.
   */
  function startRun(lane: LaneName, message: ChatMessage): RunId {
    const id = runId(newId())
    beginStream(doc, lane, id)
    void (async () => {
      try {
        const ran = await agent.lane(lane).run(message)
        if (settleRun(ran) === "keep") {
          // The reply was already `started`, so the author cannot be told;
          // at least their message is not lost.
          log(`[host] run ${id.slice(-8)} REFUSED: kept as a message`)
          await agent.lane(lane).append(message)
        }
      } catch (error) {
        log(
          `[host] run failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        endStream(doc, lane, id)
        log(`[host] run ${id.slice(-8)} done`)
        void serially(() => drain(lane))
      }
    })()
    return id
  }

  /**
   * Take a now-idle lane's held messages, oldest first: a plain one is appended
   * and the step goes on; a compelled one is run, and its end brings the next
   * step. The lane is never written while it runs (S21).
   */
  async function drain(lane: LaneName): Promise<void> {
    for (;;) {
      const step = planDrain(readOutbox(doc), lane)
      if (step.kind === "idle") return
      const message = encodeChat(step.held.details, step.held.timestamp)
      if (step.kind === "append") {
        // Released only once written: a refused append stays held, and is
        // taken again when the lane's next run ends.
        const appended = await agent.lane(lane).append(message)
        if (appended.kind === "refused") {
          log(`[host] held message kept: append refused (${appended.code})`)
          return
        }
        await agent.release(step.held.id)
        continue
      }
      // The run owns the message from here: if pi refuses it, `settleRun`
      // keeps it in the tree.
      await agent.release(step.held.id)
      startRun(lane, message)
      return
    }
  }

  // No run or stream survives a process: clear them, then drain every lane
  // with messages held for it, since no run's end will.
  void serially(async () => {
    clearStreams(doc)
    for (const lane of planStartup({ held: readOutbox(doc) }).drain)
      await drain(lane)
  })

  /** A human message: gather, `threadOf` and `planChat`, execute. */
  async function handleChat(
    respond: (outcome: Outcome) => void,
    writer: WriterId,
    sendId: string,
    chat: Extract<Intent, { kind: "chat" }>,
  ): Promise<void> {
    // gather
    const index = readTreeIndex(doc)
    const names = readParticipantNames(doc)
    const nameOf = (w: WriterId) => displayName(w, names.get(w))

    // plan (pure)
    const thread = threadOf(index, readLanes(doc, index), {
      at: chat.at,
      mode: chat.mode,
      lane: chat.lane,
      me: writer,
    })
    // An entry or lane this document does not hold has nowhere to go: refused
    // before anything is written, as pi would refuse a lane there.
    if (thread.kind === "unknown") {
      return respond({
        kind: "refused",
        code: ERR.UNKNOWN_TARGET,
        message: "no such entry or lane to write at",
      })
    }
    // Two lanes end here for a moment (a new one, just branched): which thread
    // the sender meant cannot be told, so they are asked, as for a race.
    if (thread.kind === "ambiguous")
      return respond({ kind: "conflict", by: null })
    const planned = planChat({
      author: writer,
      authorName: nameOf(writer),
      text: chat.text,
      mode: chat.mode,
      at: chat.at,
      thread,
      mentions: chat.mentions,
      participants: readParticipants(doc, index),
      asksAgent: chat.asksAgent,
      sendId,
    })

    // execute
    const message = (details: ChatDetails) => encodeChat(details, Date.now())
    switch (planned.kind) {
      case "conflict":
        return respond({
          kind: "conflict",
          by: planned.by === null ? null : nameOf(planned.by),
        })
      case "hold":
        await agent.hold({
          id: newId(),
          lane: planned.lane,
          details: planned.details,
          timestamp: Date.now(),
        })
        return respond({ kind: "queued", position: planned.position })
      case "appendToTree":
      case "appendToLane": {
        const appended =
          planned.kind === "appendToTree"
            ? await agent.appendToTree(message(planned.details), planned.parent)
            : await agent.lane(planned.lane).append(message(planned.details))
        if (appended.kind === "refused") {
          return respond({
            kind: "refused",
            code: appended.code,
            message: "pi refused the message",
          })
        }
        return respond({ kind: "appended", id: appended.id })
      }
      case "run":
        return respond({
          kind: "started",
          runId: startRun(planned.lane, message(planned.details)),
        })
      case "createAndRun": {
        const created = await agent.createThreadLane(planned.at)
        if (created.kind === "refused") {
          return respond({
            kind: "refused",
            code: created.code,
            message: "pi refused to start the thread's lane",
          })
        }
        log(`[host] ${writer.slice(-8)} starts lane ${created.lane.slice(-8)}`)
        return respond({
          kind: "started",
          runId: startRun(created.lane, message(planned.details)),
        })
      }
    }
  }

  /** A citation: gather the cited entry, `planReference`, write one value. */
  async function handleReference(
    respond: (outcome: Outcome) => void,
    writer: WriterId,
    intent: Extract<Intent, { kind: "reference" }>,
  ): Promise<void> {
    // Absent and textless are different facts (CitedEntry).
    const found = readEntryMessage(doc, intent.to.id)
    const cited: CitedEntry = found.present
      ? {
          kind: "entry",
          text:
            found.message === undefined ? undefined : entryText(found.message),
        }
      : { kind: "absent" }
    const planned = planReference({
      author: writer,
      at: intent.at,
      target: intent.to,
      cited,
      newId: referenceId(newId()),
    })
    if (planned.kind === "refused") {
      return respond({
        kind: "refused",
        code: planned.code,
        message: "reference refused",
      })
    }
    await agent.addReference(planned.reference)
    return respond({ kind: "referenced", id: planned.reference.id })
  }

  /**
   * One command from one writer. The command is UNTRUSTED text off a socket,
   * so it is decoded first; the codec owns every shape rule.
   */
  async function handleCommand(
    sender: ControlSender,
    writer: WriterId,
    wire: WireCommand,
  ): Promise<void> {
    const id = typeof wire.id === "string" ? wire.id : ""
    const respond = (outcome: Outcome) =>
      sender.send(encodeOutcome(id, outcome))

    const intent = decodeCommand(wire)
    switch (intent.kind) {
      case "refused":
        return respond(intent)
      case "chat":
        // The command's id is the send's id: its column finds its message by it.
        return handleChat(respond, writer, id === "" ? newId() : id, intent)
      case "reference":
        return handleReference(respond, writer, intent)
      case "name":
        await agent.setParticipantName(writer, intent.name)
        return respond({ kind: "named" })
      case "stop": {
        const planned = planStop(
          readLanes(doc, readTreeIndex(doc)),
          intent.lane,
        )
        if (planned === "unknown")
          return respond({
            kind: "refused",
            code: ERR.UNKNOWN_TARGET,
            message: "no such lane to stop",
          })
        // The run's end then drains the lane's outbox, as any run's does.
        if (planned === "abort") await agent.lane(intent.lane).abort()
        return respond({ kind: "stopped" })
      }
    }
  }

  // Identity comes from the TRANSPORT, never the message: `sender.peer` is the
  // connected client's peer id, so no command field can claim to be someone
  // else. It is recorded in every message they write; people own no lanes.
  listener.onReceive((sender, receiver) => {
    const writer = writerId(sender.peer)
    void (async () => {
      for await (const cmd of receiver)
        await serially(() => handleCommand(sender, writer, cmd))
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
  // Locate the client through module RESOLUTION, not a relative path: it is a
  // package this app depends on, and where it sits on disk is its business.
  const clientDir = path.dirname(
    createRequire(import.meta.url).resolve("@pineta/client/package.json"),
  )
  const vite = await createViteServer({
    root: clientDir,
    configFile: path.join(clientDir, "vite.config.ts"),
    server: {
      middlewareMode: true,
      // Vite attaches its own upgrade listener, ahead of the one below, so its
      // socket would bypass admission: hot reload runs on loopback only.
      hmr: hmr && key === null ? { server: httpServer } : false,
    },
  })
  // Admission comes first: nothing reaches Vite or the Exchange without it.
  httpServer.on("request", (req, res) => {
    const admission = admits(
      { url: req.url ?? "/", cookie: req.headers.cookie },
      key,
    )
    if (admission.kind === "refuse") {
      res.writeHead(403).end()
      return
    }
    if (admission.kind === "admitAndForget") {
      res
        .writeHead(302, {
          location: admission.location,
          "set-cookie": `${KEY_COOKIE}=${encodeURIComponent(key ?? "")}; HttpOnly; SameSite=Strict; Path=/`,
        })
        .end()
      return
    }
    vite.middlewares(req, res)
  })

  // ROUTE the upgrade. `noServer` + an explicit /ws test is what lets our sync
  // socket and Vite's HMR socket share a port: anything that is not /ws falls
  // through to Vite's own upgrade listener (attached via hmr.server above).
  // Handling every upgrade here — which is what this did before Vite — would
  // swallow HMR silently.
  httpServer.on("upgrade", (req, socket, head) => {
    const admission = admits(
      { url: req.url ?? "/", cookie: req.headers.cookie },
      key,
    )
    if (admission.kind === "refuse") {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
      return
    }
    if (new URL(req.url ?? "/", "http://host").pathname === "/ws") {
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
    httpServer.listen(port, bind, resolve)
  })
  const address = httpServer.address()
  if (address === null || typeof address === "string") {
    throw new Error("http server did not bind to a TCP port")
  }
  const actualPort = address.port

  const local = urlHost(bind)
  // A collaborator opens one of these; on 0.0.0.0, one per network address.
  const addresses =
    bind === "0.0.0.0"
      ? Object.values(networkInterfaces())
          .flat()
          .flatMap(a =>
            a !== undefined && a.family === "IPv4" && !a.internal
              ? [a.address]
              : [],
          )
      : [local]
  const invites = addresses.map(
    a =>
      `http://${a}:${actualPort}/${key === null ? "" : `?key=${encodeURIComponent(key)}`}`,
  )
  if (key !== null && tools !== null)
    log(
      "[host] WARNING: anyone with the invite link can run commands on this machine as you.",
    )

  return {
    port: actualPort,
    httpUrl: `http://${local}:${actualPort}/`,
    wsUrl: `ws://${local}:${actualPort}/ws`,
    doc,
    agent,
    key,
    invites,
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
      try {
        stored?.close()
      } catch {}
    },
  }
}
