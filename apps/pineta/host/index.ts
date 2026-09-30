// host — the composition root. It builds the store, the Exchange, the
// documents, lane work and the agent, and wires the shell's modules; each
// module takes what it needs as a parameter, and only this file wires them
// (TECHNICAL.md).
//
// Imports NO pi. Everything pi-shaped arrives through pi/.

import { readFile } from "node:fs/promises"
import {
  createInMemoryStore,
  Exchange,
  type Store,
  whenHydrated,
} from "@kyneta/exchange"
import { WebsocketServerTransport } from "@kyneta/websocket-transport/server"
import type { BlobStore, LaneName, NoteId } from "@pineta/core"
import { userConfigFile } from "@pineta/lanes"
import { decodeCommandRenames } from "@pineta/marginalia"
import { type Agent, createAgent, type ModelChoice, newId } from "@pineta/pi"
import { Control } from "@pineta/protocol/line"
import {
  CONTROL_TOPIC,
  HOST_PRINCIPAL,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { readNotes } from "@pineta/reads"
import {
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  SessionDoc,
  type SessionDocHandle,
} from "@pineta/schema"
import { DEFAULT_BIND, isLoopback, newKey } from "./admission.ts"
import { type Basics, failed } from "./basics.ts"
import { memoryBlobs } from "./blobs.ts"
import { createCommands } from "./commands/index.ts"
import { startControl } from "./control.ts"
import { hotReload as pauseHotReload } from "./hot-reload.ts"
import { compactSession, sweepBlobs } from "./housekeeping.ts"
import { startHttp } from "./http.ts"
import { lineDocPrefix } from "./lines.ts"
import { startNoteTexts } from "./notes.ts"
import { drain as drainOutbox } from "./outbox.ts"
import { writePolicy } from "./policy.ts"
import { createSerial } from "./queue.ts"
import { createRuns, streamInto } from "./runs.ts"
import { createSettle } from "./settle.ts"
import { recover } from "./startup.ts"
import { openStore } from "./store.ts"
import { startLaneWork } from "./work.ts"

/** How long an unreferenced image is kept (ADR-0042). */
const BLOB_GRACE_MS = 24 * 60 * 60 * 1000

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
  /**
   * The agent's tools, and the project they work in: each lane in its own
   * container, on its own disk (ADR-0034). Absent or null, the agent has none.
   */
  readonly tools?: { readonly project: string } | null
  /**
   * Whether a new root lane gets its own copy by default. False makes every
   * new root lane work directly in the project (`PINETA_LANES=0`).
   */
  readonly lanes?: boolean
  /**
   * Whether lanes may have containers at all. False makes the project work
   * directly without asking `container`: a suite that must run anywhere.
   */
  readonly containers?: boolean
  /**
   * The user's lane config (ADR-0035), by default
   * `$XDG_CONFIG_HOME/pineta/config.json`. A suite passes its own file rather
   * than move `XDG_CONFIG_HOME`, which git and jj read too.
   */
  readonly userConfig?: string
  /**
   * pi's agent directory, by default pi's own. With a scripted or named
   * model, skills and prompts load only from one given here: a suite's
   * fixture (ADR-0036).
   */
  readonly agentDir?: string
  /**
   * Where the session is kept: a SQLite file; a Kyneta store a caller made, as
   * a suite does to read it while the host runs; or, absent or null, a store
   * in memory. Shutting the host down closes the store, whoever made it.
   * Every host has a store: Kyneta compacts only a document with one, and
   * compaction is also what trims the session's in-memory op log (ADR-0023).
   */
  readonly store?: string | Store | null
  /**
   * The images (ADR-0042), for a caller that gives a `Store` it made: pass
   * the `blobs` `openStore` gave with it, so a restart keeps them. A store
   * given as a file keeps its own; otherwise they are held in memory.
   */
  readonly blobs?: BlobStore
  /**
   * How long an image nothing shows is kept, from its upload or last touch:
   * a day by default, for one pasted and not yet sent. A suite shortens it.
   */
  readonly blobGraceMs?: number
  /** How long presence lasts without a refresh; a suite shortens it. */
  readonly presenceDecay?: PresenceDecay
  readonly log?: (message: string) => void
}

export interface RunningHost {
  readonly port: number
  readonly httpUrl: string
  readonly wsUrl: string
  readonly doc: SessionDocHandle
  readonly presence: PresenceDocHandle
  /** A note's text as the host holds it; undefined for a note it does not hold. */
  noteText(id: NoteId): string | undefined
  readonly agent: Agent
  /** The invite key, or null on loopback. */
  readonly key: string | null
  /** Links a collaborator can open, key included; the local URL on loopback. */
  readonly invites: readonly string[]
  /**
   * Resolves when no queued step remains (a compaction after a run among them)
   * and every write has reached the store. Checks await this rather than guess.
   */
  quiet(): Promise<void>
  shutdown(): Promise<void>
}

export async function startHost({
  port = 0,
  bind = DEFAULT_BIND,
  key: givenKey,
  model,
  tools = null,
  lanes = true,
  containers = true,
  userConfig = userConfigFile(),
  agentDir,
  store: storeFile = null,
  blobs: givenBlobs,
  blobGraceMs = BLOB_GRACE_MS,
  presenceDecay = PRESENCE_DECAY,
  log = console.log,
}: StartHostOptions): Promise<RunningHost> {
  const key = isLoopback(bind) ? null : (givenKey ?? newKey())

  // --- transport + exchange ------------------------------------------------
  const serverTransport = new WebsocketServerTransport()
  const opened =
    typeof storeFile === "string"
      ? openStore(storeFile)
      : {
          store: storeFile ?? createInMemoryStore(),
          blobs: givenBlobs ?? memoryBlobs(),
        }
  const { store, blobs } = opened
  // Every stored command Line belongs to a client seat that cannot return: a
  // client keeps no store and does not reconnect (host/lines.ts).
  for await (const id of store.listDocIds(lineDocPrefix(CONTROL_TOPIC)))
    await store.delete(id)
  // Clients find the host by its principal and address their Lines to the
  // seat Kyneta issues it (ADR-0037). The host has no WRITER identity:
  // writers are the connected clients, named by their principals, and they
  // own no lanes; lanes belong to threads (ADR-0020).
  const exchange = new Exchange({
    principal: HOST_PRINCIPAL,
    type: "service",
    transports: [serverTransport],
    store,
    // A client does not reconnect: a closed channel is a seat that has left,
    // so there is nothing to wait for before its Line goes.
    departureTimeout: 0,
  })

  // The session document is BOTH pi's storage and the thing we replicate.
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  // Clients may write presence and open notes, never the session
  // (host/policy.ts). A note's state is its record's, read when asked.
  exchange.register(
    writePolicy(id => readNotes(doc).find(n => n.id === id)?.state),
  )
  // Held here so the host relays it between clients (ADR-0024).
  const presence = exchange.get(PRESENCE_DOC_ID, presenceDoc(presenceDecay))
  // A stored session loads asynchronously; pi must see it before it starts.
  // Only storage is awaited: the host is the authority, with no peer upstream.
  await whenHydrated(doc)
  const basics: Basics = { doc, log, newId, now: Date.now }

  // --- where lanes work (ADR-0032, ADR-0034) --------------------------------
  // Lane work is made before the agent, which is made with lane work's
  // `access` and `hooks`, so lane work reads the agent lazily. This is the
  // one lazy read: every module made after the agent is given the agent.
  let created: Agent | undefined
  const theAgent = (): Agent => {
    if (created === undefined) throw new Error("the agent is not created yet")
    return created
  }
  // The user config, read once: its shared directories (ADR-0035) and its
  // renames for command packages (ADR-0036). Missing or malformed is empty.
  const userJson = await readFile(userConfig, "utf8")
    .then(t => JSON.parse(t) as unknown)
    .catch(() => null)
  const work = await startLaneWork({
    doc,
    dir: tools?.project ?? null,
    defaultDirect: !lanes,
    containers,
    userConfig: { file: userConfig, json: userJson },
    agent: theAgent,
    log,
  })

  // --- pi stack ------------------------------------------------------------
  const commandRenames = decodeCommandRenames(userJson)
  const agent = await createAgent({
    doc,
    replicaId: newId(),
    model,
    commandRenames,
    blobs,
    ...(agentDir === undefined ? {} : { agentDir }),
    tools:
      tools === null
        ? null
        : {
            project: work.project?.root ?? tools.project,
            access: work.access,
            hooks: work.hooks,
          },
    onStream: streamInto(basics),
  })
  created = agent

  log(
    `[host] agent ready — model ${agent.modelLabel}; tools ${tools === null ? "off" : `on, in ${work.project?.root ?? tools.project}`}`,
  )

  // --- the shell -----------------------------------------------------------
  const hotReload = pauseHotReload({ doc, project: () => work.project })
  // Commands are received only from `startControl`, after `recover`.
  const listener = Control.listen(exchange)
  const serial = createSerial(failed(basics, "step"))
  const notes = startNoteTexts({
    exchange,
    doc,
    serial,
    setNote: note => agent.setNote(note),
  })
  const runs = createRuns({ basics, agent, work })
  const commands = createCommands({
    basics,
    agent,
    work,
    blobs,
    notes,
    start: runs.start,
  })
  const drain = (lane: LaneName) =>
    drainOutbox(
      { basics, agent, start: runs.start, update: commands.update },
      lane,
    )
  const settle = createSettle({
    basics,
    serial,
    drain,
    compact: () => compactSession(exchange),
    sweep: () => sweepBlobs({ basics, blobs, grace: blobGraceMs, notes }),
  })
  // A run's end: hot reload may reload the page, then the lane drains and
  // the session compacts.
  runs.onEnded(lane => {
    hotReload.runEnded()
    void settle([lane])
  })

  /**
   * Resolves when no queued step remains (a compaction after a run among
   * them), no lane's queue has work, and every write has reached the store.
   */
  async function quiet(): Promise<void> {
    await serial.idle()
    // Lanes' own queues: snapshots, fetches, stops and trims after a run.
    await work.quiet()
    await exchange.flush()
  }

  await recover({
    basics,
    agent,
    work,
    serial,
    start: runs.start,
    settle,
    notes,
  })
  const control = startControl({
    exchange,
    listener,
    serial,
    handle: commands.handle,
  })

  const server = await startHttp({
    port,
    bind,
    key,
    tools: tools !== null,
    serverTransport,
    hotReload,
    blobs,
    offers: work.offers,
    log,
  })

  return {
    port: server.port,
    httpUrl: server.httpUrl,
    wsUrl: server.wsUrl,
    doc,
    presence,
    noteText: (id: NoteId) => notes.text(id),
    agent,
    key,
    invites: server.invites,
    quiet,
    async shutdown() {
      // Let queued steps, a compaction among them, finish their writes.
      try {
        await quiet()
      } catch {}
      notes.release()
      control.stop()
      try {
        await agent.close()
      } catch {}
      // A container runs only while its lane runs (ADR-0034).
      try {
        await work.close()
      } catch {}
      try {
        await exchange.shutdown()
      } catch {}
      await server.close()
    },
  }
}
