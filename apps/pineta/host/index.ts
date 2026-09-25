// host — the shell. Owns sockets, the Exchange, the harness lifecycle.
//
// Imports NO pi. Everything pi-shaped arrives through pi/.
// FC/IS: this file gathers and executes; the deciding is done by core/.

import http from "node:http"
import { createRequire } from "node:module"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { stepInPlace } from "@kyneta/schema"
import {
  WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import {
  type Attach,
  atEntry,
  type ChatAt,
  checkEnvironment,
  ERR,
  entryId,
  indexTree,
  type LaneName,
  laneNameForAgent,
  laneNameForWriter,
  type Mention,
  planAttach,
  planCommand,
  ROOT,
  type RunId,
  referenceId,
  resolveTarget,
  runId,
  type Target,
  THE_AGENT,
  type TurnState,
  turnFinished,
  type WriterLaneState,
} from "@pineta/core"
import {
  type ChatMessage,
  type CitedEntry,
  displayName,
  effectiveDefault,
  encodeChat,
  entryText,
  PARTICIPANT_NAMESPACE,
  participantNames,
  planChat,
  planReference,
  THREAD_NAMESPACE,
  threadDefaults,
} from "@pineta/marginalia"
import { type Agent, createAgent, type LaneOutcome, newId } from "@pineta/pi"
import {
  decodeCommand,
  encodeOutcome,
  type Outcome,
  type WireCommand,
} from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import { HOST_PEER_ID, SESSION_DOC_ID } from "@pineta/protocol/messages"
import {
  appendStream,
  beginStream,
  endStream,
  hasLaneRecord,
  readActiveRun,
  readEntries,
  readEntryMessage,
  readLaneTip,
  readValues,
  SessionDoc,
  type SessionDocHandle,
} from "@pineta/schema"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"

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

  // --- transport + exchange ------------------------------------------------
  const serverTransport = new WebsocketServerTransport()
  // The Exchange id is the address a client's Line targets, so it is the
  // agreed constant. The host has no WRITER identity: writers are the
  // connected clients, and each names its own lane (ADR-0011).
  const exchange = new Exchange({
    id: HOST_PEER_ID,
    transports: [serverTransport],
  })

  // The session document is BOTH pi's storage and the thing we replicate.
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)

  // --- pi stack ------------------------------------------------------------
  const agent = await createAgent({
    doc,
    replicaId: newId(),
    provider,
    model,
    // Route each delta by the lane pi says it streamed on, looking the run up
    // in the document. The document already records which run each lane is
    // streaming; a second copy here would be two sources of truth.
    onDelta: ({ lane, delta }) => {
      const run = readActiveRun(doc, lane)
      if (run !== undefined) appendStream(doc, run, delta)
    },
  })
  log(`[host] agent ready — model ${agent.modelLabel}`)

  // --- command channel (ADR-0007) -----------------------------------------
  // One turn state per WRITER, so one writer's running turn never makes
  // another busy. A record per writer that ever connected stays for the life
  // of the process; that is small and acceptable for v1.
  const turns = new Map<LaneName, TurnState>()
  const turnOf = (lane: LaneName): TurnState =>
    turns.get(lane) ?? { ready: true, busy: false }

  const listener = Control.listen(exchange)
  type ControlSender = Parameters<Parameters<typeof listener.onReceive>[0]>[0]

  /**
   * Where this writer's lane is, read from the document.
   *
   * "No lane" and "a lane at the root" both have a null tip, and mistaking one
   * for the other is silent: pi ignores `createAt` for a lane that exists, so
   * a branch would attach at the root. They differ in whether the lane is
   * RECORDED, which pi does on creation even before the first entry. Reading
   * the document, not the agent's cache, keeps this right across a restart.
   */
  function gatherLane(lane: LaneName): WriterLaneState {
    if (!hasLaneRecord(doc, lane)) return { kind: "none" }
    const tip = readLaneTip(doc, lane)
    return { kind: "lane", at: tip === null ? ROOT : atEntry(entryId(tip)) }
  }

  /** Carry out an `Attach` decision. The shell's half of `planAttach`. */
  function attach(lane: LaneName, plan: Attach): Promise<LaneOutcome> {
    switch (plan.kind) {
      case "stay":
        return Promise.resolve({ kind: "ok" })
      case "create":
        return agent.lane(lane).create(plan.at)
      case "navigate":
        return agent.lane(lane).navigate(plan.to)
    }
  }

  /**
   * One command from one writer: gather, plan, execute.
   *
   * The command is UNTRUSTED text off a socket, so it is decoded first. The
   * codec owns every shape rule; `planCommand` and `planAttach` are pure and
   * own policy. Attachment is awaited BEFORE replying, so anything pi refuses
   * there comes back as a structured refusal. Only the run itself happens
   * after the reply.
   */
  async function handleCommand(
    sender: ControlSender,
    lane: LaneName,
    wire: WireCommand,
  ): Promise<void> {
    const id = typeof wire.id === "string" ? wire.id : ""
    const respond = (outcome: Outcome) =>
      sender.send(encodeOutcome(id, outcome))

    const intent = decodeCommand(wire)
    if (intent.kind === "refused") return respond(intent)

    // gather
    const turn = turnOf(lane)
    const at = gatherLane(lane)

    // plan (pure)
    const decision = planCommand(turn, intent, runId(newId()))
    if (decision.kind === "reject") {
      return respond({
        kind: "refused",
        code: decision.code,
        message: decision.message,
      })
    }
    if (decision.kind === "reference") {
      // gather: the author's lane (already gathered as `at`) and the cited
      // entry. Absent and textless are different facts (CitedEntry).
      const found = readEntryMessage(doc, decision.to.id)
      const cited: CitedEntry = found.present
        ? {
            kind: "entry",
            text:
              found.message === undefined
                ? undefined
                : entryText(found.message),
          }
        : { kind: "absent" }
      // plan (pure)
      const planned = planReference({
        author: lane,
        lane: at,
        at: decision.at,
        target: decision.to,
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
      // execute
      const wrote = await agent.addReference(planned.reference)
      if (wrote.kind === "refused") {
        return respond({
          kind: "refused",
          code: wrote.code,
          message: "pi refused the reference",
        })
      }
      log(`[host] ${lane.slice(-8)} cited ${decision.to.id.slice(-8)}`)
      return respond({ kind: "referenced", id: planned.reference.id })
    }

    if (decision.kind === "name") {
      await agent.setParticipantName(lane, decision.name)
      log(`[host] ${lane.slice(-8)} is named ${JSON.stringify(decision.name)}`)
      return respond({ kind: "named" })
    }
    if (decision.kind === "chat") {
      return handleChat(respond, lane, at, decision)
    }
    if (decision.kind === "thread") {
      if (doc.entries.get(decision.at) === undefined) {
        return respond({
          kind: "refused",
          code: ERR.UNKNOWN_TARGET,
          message: "no such entry to root a thread at",
        })
      }
      await agent.setThreadDefault(decision.at, decision.compels)
      log(
        `[host] ${lane.slice(-8)} thread ${decision.at.slice(-8)} compels ${decision.compels.kind}`,
      )
      return respond({ kind: "threaded" })
    }

    const target: Target =
      decision.kind === "navigate" ? decision.to : decision.from
    const plan = planAttach(at, target)

    // execute: attach first, so a refusal can still be reported
    const attached = await attach(lane, plan)
    if (attached.kind === "refused") {
      log(
        `[host] ${lane.slice(-8)} attach ${plan.kind} REFUSED: ${attached.code}`,
      )
      return respond({
        kind: "refused",
        code: attached.code,
        message: `pi refused to ${plan.kind === "create" ? "create the lane" : "navigate"}`,
      })
    }
    if (decision.kind === "navigate") return respond({ kind: "navigated" })

    turns.set(lane, decision.next)
    respond({ kind: "started", runId: decision.runId })
    log(
      `[host] ${lane.slice(-8)} run ${decision.runId.slice(-8)} ${plan.kind} <- ${JSON.stringify(decision.text.slice(0, 60))}`,
    )
    await execRun(lane, decision.runId, decision.text)
  }

  /**
   * Run one turn on `lane`, streaming into the document. The caller has marked
   * the lane busy and replied: that reply was the ACCEPTANCE, so a run pi then
   * refuses cannot travel back as a rejection. It is logged instead, rather
   * than swallowed by the "done" line.
   */
  async function execRun(
    lane: LaneName,
    id: RunId,
    prompt: string | ChatMessage,
  ): Promise<void> {
    beginStream(doc, lane, id)
    try {
      const ran = await agent.lane(lane).run(prompt)
      if (ran.kind === "refused") {
        log(`[host] run ${id.slice(-8)} REFUSED: ${ran.code}`)
      }
    } catch (error) {
      log(
        `[host] run failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      endStream(doc, lane, id)
      turns.set(lane, turnFinished(turnOf(lane)))
      log(`[host] run ${id.slice(-8)} done`)
    }
  }

  /**
   * A human message: gather, `planChat`, execute. A message that compels the
   * agent is its prompt, run on the agent's lane; any other is appended on
   * the author's lane with no run. Both attach where the author is viewing.
   */
  async function handleChat(
    respond: (outcome: Outcome) => void,
    lane: LaneName,
    authorLane: WriterLaneState,
    chat: { text: string; at: ChatAt; mentions: readonly Mention[] },
  ): Promise<void> {
    // gather
    const agentLane = laneNameForAgent(THE_AGENT)
    const names = participantNames(readValues(doc, PARTICIPANT_NAMESPACE))
    const threadDefault = effectiveDefault(
      resolveTarget(authorLane, chat.at),
      indexTree(readEntries(doc)),
      threadDefaults(readValues(doc, THREAD_NAMESPACE)),
    )

    // plan (pure)
    const planned = planChat({
      author: lane,
      authorName: displayName(lane, names.get(lane)),
      text: chat.text,
      at: chat.at,
      mentions: chat.mentions,
      threadDefault,
      authorLane,
      agentLane: gatherLane(agentLane),
      agentTurn: turnOf(agentLane),
    })
    if (planned.kind === "refused") {
      return respond({
        kind: "refused",
        code: planned.code,
        message: "the agent is already replying",
      })
    }

    // execute. The agent's lane is SHARED by every writer, and each writer's
    // commands run concurrently, so claim its turn before the first await:
    // otherwise two writers compelling it at once would both see it idle.
    const target = planned.kind === "append" ? lane : agentLane
    if (planned.kind === "run") {
      turns.set(agentLane, { ...turnOf(agentLane), busy: true })
    }
    const attached = await attach(target, planned.attach)
    if (attached.kind === "refused") {
      if (planned.kind === "run") {
        turns.set(agentLane, turnFinished(turnOf(agentLane)))
      }
      return respond({
        kind: "refused",
        code: attached.code,
        message: `pi refused to ${planned.attach.kind === "create" ? "create the lane" : "navigate"}`,
      })
    }
    const message = encodeChat(planned.details, Date.now())

    if (planned.kind === "append") {
      const appended = await agent.lane(lane).append(message)
      if (appended.kind === "refused") {
        return respond({
          kind: "refused",
          code: appended.code,
          message: "pi refused the message",
        })
      }
      log(`[host] ${lane.slice(-8)} chat ${appended.id.slice(-8)}`)
      return respond({ kind: "appended", id: appended.id })
    }

    const id = runId(newId())
    respond({ kind: "started", runId: id })
    log(
      `[host] ${lane.slice(-8)} compels ${planned.agent} run ${id.slice(-8)} ${planned.attach.kind}`,
    )
    await execRun(agentLane, id, message)
  }

  // Identity comes from the TRANSPORT, never the message: `sender.peer` is
  // the connected client's peer id. A client therefore can only ever drive
  // its own lane, and no command field can name someone else's.
  listener.onReceive((sender, receiver) => {
    const lane = laneNameForWriter(sender.peer)
    void (async () => {
      for await (const cmd of receiver) await handleCommand(sender, lane, cmd)
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
