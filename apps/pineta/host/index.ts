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
import { Interpret, Reject, subscribe } from "@kyneta/schema"
import { WebsocketServerTransport } from "@kyneta/websocket-transport/server"
import type { BlobStore, CardId, LaneName } from "@pineta/core"
import { userConfigFile } from "@pineta/lanes"
import {
  decodeBannerConfig,
  decodeCommandRenames,
  decodeDigestConfig,
  queuedOn,
} from "@pineta/marginalia"
import { type Agent, createAgent, type ModelChoice, newId } from "@pineta/pi"
import { Control } from "@pineta/protocol/line"
import {
  CARDS_DOC_ID,
  CONTROL_TOPIC,
  HOST_PRINCIPAL,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { readCards, readRunning } from "@pineta/reads"
import {
  CardsDoc,
  type CardsDocHandle,
  cardDocId,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  SessionDoc,
  type SessionDocHandle,
  TextDoc,
} from "@pineta/schema"
import { DEFAULT_BIND, isLoopback, newKey } from "./admission.ts"
import { createBanners } from "./banners.ts"
import { type Basics, failed } from "./basics.ts"
import { memoryBlobs } from "./blobs.ts"
import { startCards } from "./cards.ts"
import { createCommands } from "./commands/index.ts"
import { startControl } from "./control.ts"
import { createDigests } from "./digests.ts"
import { hotReload as pauseHotReload } from "./hot-reload.ts"
import { compactSession, sweepBlobs } from "./housekeeping.ts"
import { startHttp } from "./http.ts"
import { lineDocPrefix } from "./lines.ts"
import { createNames } from "./names.ts"
import { resolveDoc, writePolicy } from "./policy.ts"
import { createSerial } from "./queue.ts"
import { createRuns, streamInto } from "./runs.ts"
import { startSeats } from "./seats.ts"
import { createSettle } from "./settle.ts"
import { recover } from "./startup.ts"
import { openStore } from "./store.ts"
import { drain as drainQueue, takenChat } from "./take.ts"
import { startLaneWork } from "./work/index.ts"

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
  /** Every card's record, as the host holds them (ADR-0048). */
  readonly cards: CardsDocHandle
  /** A card's text as the host holds it: for the suites. */
  cardText(id: CardId): string
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
    // Cards are created by clients (ADR-0048): without this, a card the host
    // never opened itself would be neither stored nor relayed (S58).
    resolve: docId => {
      switch (resolveDoc(docId)) {
        case "cards":
          return Interpret(CardsDoc)
        case "text":
          return Interpret(TextDoc)
        case "reject":
          return Reject()
        case undefined:
          return undefined
      }
    },
  })

  // The session document is BOTH pi's storage and the thing we replicate.
  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  // Clients may write presence and cards, never the session (host/policy.ts).
  exchange.register(writePolicy)
  // Held here so the host relays it between clients (ADR-0024).
  const presence = exchange.get(PRESENCE_DOC_ID, presenceDoc(presenceDecay))
  // Every card's record, which clients write (ADR-0048).
  const cards: CardsDocHandle = exchange.get(CARDS_DOC_ID, CardsDoc)
  // A stored session loads asynchronously; pi must see it before it starts.
  // Only storage is awaited: the host is the authority, with no peer upstream.
  await whenHydrated(doc)
  await whenHydrated(cards)
  const basics: Basics = { doc, cards, log, newId, now: Date.now }

  // --- where lanes work (ADR-0032, ADR-0034) --------------------------------
  // Lane work is made before the agent, which is made with lane work's
  // `access` and `hooks`, so lane work reads the agent lazily. This is the
  // one lazy read: every module made after the agent is given the agent.
  let created: Agent | undefined
  const theAgent = (): Agent => {
    if (created === undefined) throw new Error("the agent is not created yet")
    return created
  }
  // The user config, read once: its shared directories (ADR-0035), its
  // renames for command packages (ADR-0036) and whether threads get banners.
  // Missing or malformed is empty.
  const userJson = await readFile(userConfig, "utf8")
    .then(t => JSON.parse(t) as unknown)
    .catch(() => null)
  const serial = createSerial(failed(basics, "step"))
  // Each thread's column banner, when the user config turns banners on. Made
  // before the agent, whose `set_banner` asks it, so it reads the agent
  // lazily, as lane work does.
  const bannerConfig = decodeBannerConfig(userJson)
  const banners =
    bannerConfig === null
      ? null
      : createBanners({ basics, serial, blobs, agent: theAgent })
  // Each ask's digest, when the user config turns digests on (ADR-0056).
  // Made before the agent, which it reads lazily, as banners do.
  const digests = decodeDigestConfig(userJson)
    ? createDigests({ basics, serial, presence, agent: theAgent })
    : null
  const digestFailed = (lane: LaneName) =>
    failed(basics, "summarizing its ask", lane)
  // Every thread's name (ADR-0039, ADR-0057), one plan at a time. A thread's
  // banner is drawn from its name, so it starts as the name is written.
  const names = createNames({
    basics,
    agent: { setWorkRecord: record => theAgent().setWorkRecord(record) },
    onNamed: lane => {
      banners?.due(lane).catch(failed(basics, "banner"))
    },
  })
  const work = await startLaneWork({
    basics,
    ensureNames: names.ensure,
    dir: tools?.project ?? null,
    defaultDirect: !lanes,
    containers,
    userConfig: { file: userConfig, json: userJson },
    agent: theAgent,
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
            hooks: {
              ...work.hooks,
              // A turn recorded, then a live digest of the ask `tip` is in,
              // when due.
              turnDone: async (lane, tip) => {
                await work.hooks.turnDone(lane, tip)
                void digests?.step(tip, digestFailed(lane))
              },
            },
          },
    onStream: streamInto(basics),
    ...(bannerConfig === null || banners === null
      ? {}
      : { banners: { config: bannerConfig, request: banners.request } }),
  })
  created = agent
  if (bannerConfig !== null && !(await agent.canDrawBanners()))
    log(
      `[host] banners are on, but ${bannerConfig.provider}/${bannerConfig.model} cannot be drawn: no key, or no such model`,
    )

  log(
    `[host] agent ready — model ${agent.modelLabel}; tools ${tools === null ? "off" : `on, in ${work.project?.root ?? tools.project}`}`,
  )

  // --- the shell -----------------------------------------------------------
  const hotReload = pauseHotReload({ doc, project: () => work.project })
  // Commands are received only from `startControl`, after `recover`.
  const listener = Control.listen(exchange)
  const cardPort = startCards({ exchange, store, doc, cards })
  const runs = createRuns({ basics, agent, work })
  const commands = createCommands({
    basics,
    agent,
    work,
    blobs,
    cards: cardPort,
    start: runs.start,
    names,
  })
  const drain = (lane: LaneName) =>
    drainQueue(
      {
        basics,
        texts: cardPort,
        work,
        start: runs.start,
        send: taken =>
          commands.sendTaken(taken.card.place.by, newId(), takenChat(taken)),
      },
      lane,
    )
  const settle = createSettle({
    basics,
    serial,
    drain,
    compact: () => compactSession(exchange),
    sweep: () =>
      sweepBlobs({ basics, blobs, grace: blobGraceMs, texts: cardPort.texts }),
  })
  // A run's end: hot reload may reload the page, then the lane drains and
  // the session compacts. A thread whose banner failed tries again. The
  // final digest is for the run's prompt: the drain queued before it may
  // append to the lane or start its next run.
  runs.onEnded((lane, prompt) => {
    hotReload.runEnded()
    void settle([lane])
    banners?.due(lane).catch(failed(basics, "banner"))
    if (prompt !== null) void digests?.ended(prompt, digestFailed(lane))
  })
  // A card queued on a lane that is not running is taken at once (ADR-0048).
  // Only the records are watched, never the texts, so typing in a card costs
  // nothing here. A lane's drain is queued once until its step starts: a
  // change while it runs queues one more, which finds what that one missed.
  const draining = new Set<LaneName>()
  const watchQueues = () => {
    const records = readCards(cards)
    const lanes = new Set<LaneName>()
    for (const c of records)
      if (c.place.kind === "queued") lanes.add(c.place.lane)
    for (const lane of lanes) {
      if (draining.has(lane) || readRunning(doc, lane)) continue
      if (queuedOn(records, lane).length === 0) continue
      draining.add(lane)
      void serial.run(async () => {
        draining.delete(lane)
        await drain(lane)
      })
    }
  }

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
    cards: cardPort,
    ensureNames: names.ensure,
  })
  const unwatchQueues = subscribe(cards, watchQueues)
  const seats = startSeats({ exchange, basics, serial, agent })
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
    cards,
    cardText: (id: CardId) => exchange.get(cardDocId(id), TextDoc).text(),
    agent,
    key,
    invites: server.invites,
    quiet,
    async shutdown() {
      // Let queued steps, a compaction among them, finish their writes.
      try {
        await quiet()
      } catch {}
      unwatchQueues()
      seats.stop()
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
