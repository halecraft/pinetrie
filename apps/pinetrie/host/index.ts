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
import { Interpret, Reject } from "@kyneta/schema"
import { WebsocketServerTransport } from "@kyneta/websocket-transport/server"
import {
  type BlobStore,
  type CardId,
  type LaneName,
  writerId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import { userConfigFile } from "@pinetrie/lanes"
import { type Agent, createAgent, type ModelChoice, newId } from "@pinetrie/pi"
import { Control } from "@pinetrie/protocol/line"
import {
  CONTROL_TOPIC,
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import { writersPolicy } from "@pinetrie/protocol/writers"
import {
  readArchived,
  readRecords,
  readRoots,
  readRunning,
  readThreadName,
  readWorkflow,
} from "@pinetrie/reads"
import {
  ARCHIVE,
  archivedOf,
  decodeBannerConfig,
  decodeCommandRenames,
  decodeDigestConfig,
  decodeTitleConfig,
  planCarryOver,
  type QueuedCard,
} from "@pinetrie/rules"
import {
  AttentionDoc,
  asSessionDoc,
  cardDocId,
  InventoryDoc,
  LiveDoc,
  type LiveDocHandle,
  OpenDoc,
  PlacesDoc,
  type PlacesDocHandle,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  type SessionDocHandle,
  StorageDoc,
  TextDoc,
} from "@pinetrie/schema"
import { DEFAULT_BIND, isLoopback, newKey } from "./admission.ts"
import { createBanners } from "./banners.ts"
import { createBaseNews } from "./base-news.ts"
import {
  type Basics,
  failed,
  type HostKeeper,
  type HostKey,
  slow,
} from "./basics.ts"
import { memoryBlobs } from "./blobs.ts"
import { startCards } from "./cards.ts"
import { createCommands } from "./commands/index.ts"
import { startControl } from "./control.ts"
import { createDigests } from "./digests.ts"
import { startDirectory } from "./directory.ts"
import {
  type HostDocuments,
  hostDocuments,
  openedWords,
  planLoads,
} from "./docs.ts"
import { hotReload as holdHotReload } from "./hot-reload.ts"
import {
  compactAfter,
  sweepBlobs,
  sweepHistories,
  sweepHolds,
} from "./housekeeping.ts"
import { startHttp } from "./http.ts"
import { lineDocPrefix } from "./lines.ts"
import { createMoveHistories } from "./move-history.ts"
import { createNames } from "./names.ts"
import { createPinned } from "./pinned.ts"
import { hostPolicy, resolveDoc } from "./policy.ts"
import { createProvenance } from "./provenance.ts"
import {
  chatOfPoppedQueuedCard,
  createWaits,
  drain as drainQueue,
  untilNotTyped,
} from "./queued-card-pop.ts"
import { createRuns, streamInto } from "./runs.ts"
import { startSeats } from "./seats.ts"
import { createSettle } from "./settle.ts"
import { planShutdown, type ShutdownStep } from "./shutdown.ts"
import { createSplitCall } from "./split-call.ts"
import { recover } from "./startup.ts"
import { openStore } from "./store.ts"
import { createTitles } from "./titles.ts"
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
   * The project (ADR-0086): where pi's settings and `AGENTS.md` load from,
   * and, with `tools`, where the agent reads, writes and runs commands, each
   * lane in its own container, on its own disk (ADR-0034). Absent or null:
   * no project, and no tools.
   */
  readonly project?: { readonly dir: string; readonly tools: boolean } | null
  /**
   * Whether a new root lane gets its own copy by default. False makes every
   * new root lane work directly in the project (`PINETRIE_LANES=0`).
   */
  readonly lanes?: boolean
  /**
   * Whether lanes may have containers at all. False makes the project work
   * directly without asking `container`: a suite that must run anywhere.
   */
  readonly containers?: boolean
  /**
   * The user's lane config (ADR-0035), by default
   * `$XDG_CONFIG_HOME/pinetrie/config.json`. A suite passes its own file rather
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
  /** The session's records, as the host holds them: for the suites to read. */
  readonly session: SessionDocHandle
  /** Every document, each root's among them (`docs.ts`): for the suites. */
  readonly docs: HostDocuments
  /** What is streaming now, as the host holds it: for the suites to read. */
  readonly live: LiveDocHandle
  readonly presence: PresenceDocHandle
  /**
   * Where every card is, as the host holds it (ADR-0059): for the suites to
   * read. Only `applyPlaceSteps` writes it.
   */
  readonly places: PlacesDocHandle
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
  /** Stops the host in `planShutdown`'s order, once: a later call gets the first call's promise. */
  shutdown(): Promise<void>
}

export async function startHost({
  port = 0,
  bind = DEFAULT_BIND,
  key: givenKey,
  model,
  project = null,
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
  const toolsIn = project?.tools === true ? project.dir : null

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
    // Cards' texts and a person's documents are created by clients
    // (ADR-0048, ADR-0059, ADR-0077): without this, a document the host never
    // opened itself would be neither stored nor relayed (S58). The host never
    // writes a person's document.
    resolve: docId => {
      switch (resolveDoc(docId, root => readRoots(session).has(root))) {
        case "text":
          return Interpret(TextDoc)
        case "inventory":
          return Interpret(InventoryDoc)
        case "attention":
          return Interpret(AttentionDoc)
        case "open":
          return Interpret(OpenDoc)
        case "root":
          return Interpret(StorageDoc)
        case "reject":
          return Reject()
        case undefined:
          return undefined
      }
    },
  })

  // The session's records, the directory of roots among them (ADR-0063).
  // Each root's document is opened through `docs`, below.
  const session = asSessionDoc(exchange.get(SESSION_DOC_ID, StorageDoc))
  // The host is every document's authority: no peer is upstream of it. So
  // Kyneta loads a root it let go again when a client asks for it (S86).
  exchange.register({ name: "pinetrie.authority", authority: "self" })
  // Clients may write presence and cards' texts (host/policy.ts); only the
  // host the session and the places, and only its person an inventory
  // (`writersPolicy`, registered on every client too).
  exchange.register(hostPolicy)
  exchange.register(writersPolicy)
  // Held here so the host relays it between clients (ADR-0024).
  const presence = exchange.get(PRESENCE_DOC_ID, presenceDoc(presenceDecay))
  // Where every card is, which only the host writes (ADR-0059).
  const places: PlacesDocHandle = exchange.get(PLACES_DOC_ID, PlacesDoc)
  // What is streaming now (ADR-0063), which only the host writes.
  const live: LiveDocHandle = exchange.get(LIVE_DOC_ID, LiveDoc)
  // A stored session loads asynchronously; pi must see it before it starts.
  // Only storage is awaited: the host is the authority, with no peer upstream.
  await whenHydrated(session)
  await whenHydrated(places)
  await whenHydrated(live)
  // Each person's history of moves, per root (ADR-0066).
  const histories = createMoveHistories(exchange)
  // The agent, made below, holds a harness over each root it has used.
  let created: Agent | undefined
  const docs = hostDocuments({
    exchange,
    session,
    live,
    places,
    releasing: async root => {
      await created?.release(root)
      await histories.unloadRoot(root)
    },
  })
  const basics: Basics = {
    session,
    live,
    docs,
    places,
    log,
    newId,
    now: Date.now,
  }

  // --- where lanes work (ADR-0032, ADR-0034) --------------------------------
  // Lane work is made before the agent, which is made with lane work's
  // `access` and `hooks`, so lane work reads the agent lazily, as do
  // banners, digests, titles and names, made before it too. Every module
  // made after the agent is given the agent. One made before it must not
  // write as it is made: `theAgent()` throws until then.
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
  const keeper: HostKeeper = createKeeper<HostKey>({
    onError: failed(basics, "step"),
    onSlow: slow(basics),
  })
  // A store from before the board is carried over (ADR-0085): planned here,
  // since it says which roots are archived, and written in `recover`, once
  // the agent is made.
  const directoryNow = readRoots(session)
  const carryOver = planCarryOver({
    workflow: readWorkflow(session),
    roots: directoryNow,
    archive: readRecords(session, ARCHIVE),
    host: writerId(HOST_PRINCIPAL),
    now: basics.now(),
    newId: basics.newId,
  })
  // The roots that are not archived, opened before anything reads one: every
  // lane that could be running is in one of them (`planLoads`).
  const roots = planLoads(
    directoryNow,
    carryOver === null
      ? readArchived(session)
      : archivedOf(
          carryOver.workflow,
          new Map(carryOver.places.map(p => [p.root, p])),
        ),
  )
  for (const root of roots) await docs.root(root)
  log(`[host] ${openedWords(roots.length, directoryNow.size)}`)
  // Each thread's column banner, when the user config turns banners on. Made
  // before the agent, whose `set_banner` asks it, so it reads the agent
  // lazily, as lane work does.
  const bannerConfig = decodeBannerConfig(userJson)
  const banners =
    bannerConfig === null
      ? null
      : createBanners({ basics, keeper, blobs, agent: theAgent })
  // Each run's verdict (ADR-0077), and each ask's digest unless the user
  // config turns digests off (ADR-0071). Made before the agent, which it
  // reads lazily, as banners do.
  const digests = createDigests({
    basics,
    keeper,
    presence,
    agent: theAgent,
    enabled: decodeDigestConfig(userJson),
  })
  const digestFailed = (lane: LaneName) =>
    failed(basics, "summarizing its ask", lane)
  // Each root's title, unasked as its first lane starts unless the user
  // config turns that off, or when a person asks (ADR-0074).
  const titleConfig = decodeTitleConfig(userJson)
  const titles = createTitles({
    basics,
    keeper,
    enabled: titleConfig.enabled,
    agent: theAgent,
  })
  // Every thread's name (ADR-0039, ADR-0057), one plan at a time. A thread's
  // banner is drawn from its name, so it starts as the name is written.
  const names = createNames({
    basics,
    agent: { writeValues: writes => theAgent().writeValues(writes) },
    onNamed: lane => {
      banners?.due(lane).catch(failed(basics, "banner"))
    },
  })
  // What each thread is told of its base's new work (ADR-0080). Made before
  // lane work, whose refreshes tell it, so it reads the agent lazily.
  const baseNews = createBaseNews({ basics, agent: theAgent, keeper })
  const work = await startLaneWork({
    basics,
    baseNews,
    ensureNames: names.ensure,
    dir: toolsIn,
    defaultDirect: !lanes,
    containers,
    userConfig: { file: userConfig, json: userJson },
    agent: theAgent,
    lineCommands: key === null,
  })

  // Lane work's root when it has one; the folder as given without tools.
  const projectRoot = work.project?.root ?? project?.dir ?? null

  // --- pi stack ------------------------------------------------------------
  const commandRenames = decodeCommandRenames(userJson)
  const agent = await createAgent({
    documents: docs,
    replicaId: newId(),
    model,
    commandRenames,
    blobs,
    ...(agentDir === undefined ? {} : { agentDir }),
    ...(projectRoot === null ? {} : { project: projectRoot }),
    tools:
      toolsIn === null
        ? null
        : {
            access: work.access,
            hooks: {
              ...work.hooks,
              // A split the agent asks for is a card queued on its lane: the
              // documents' keeper writes it (ADR-0080).
              askSplit: lane => askSplit(lane),
              // A turn recorded, then a live digest of the ask `tip` is in,
              // when due.
              turnDone: async (lane, tip) => {
                await work.hooks.turnDone(lane, tip)
                const root = docs.rootOfLane(lane)
                if (root !== null)
                  void digests.step(root, tip, digestFailed(lane))
              },
            },
          },
    onStream: streamInto(basics),
    onPrefixChange: lane =>
      log(
        `[host] ${readThreadName(session, lane)}: the model's prompt or tools changed`,
      ),
    ...(bannerConfig === null || banners === null
      ? {}
      : { banners: { config: bannerConfig, request: banners.request } }),
    titleModel: titleConfig.model,
  })
  created = agent
  // The directory writes through the agent, so it starts here; it follows
  // the roots opened above as well as those opened later (`onOpened`).
  startDirectory({ basics, keeper, agent })
  if (titleConfig.model !== null && !agent.titleModelFound)
    log(
      `[host] titles name ${titleConfig.model.provider}/${titleConfig.model.model}, which pi does not have: titles use the run's model`,
    )
  if (bannerConfig !== null && !(await agent.canDrawBanners()))
    log(
      `[host] banners are on, but ${bannerConfig.provider}/${bannerConfig.model} cannot be drawn: no key, or no such model`,
    )

  log(
    `[host] agent ready — model ${agent.modelLabel}; tools ${toolsIn === null ? "off" : `on, in ${projectRoot}`}`,
  )

  // --- the shell -----------------------------------------------------------
  const hotReload = holdHotReload({ session, live })
  // Commands are received only from `startControl`, after `recover`.
  const listener = Control.listen(exchange)
  const cardPort = startCards({ exchange, store, session })
  const provenance = createProvenance({ basics, presence, agent: () => agent })
  const { readPinned } = createPinned({ basics, cards: cardPort })
  const runs = createRuns({
    basics,
    agent,
    work,
    readPinned,
    readBehind: baseNews.atStart,
    pending: digests.pending,
  })
  const commands = createCommands({
    basics,
    agent,
    work,
    blobs,
    cards: cardPort,
    start: runs.start,
    cancel: runs.cancel,
    names,
    titles,
    drain: lane => queueDrain(lane),
    histories,
    provenance,
    keeper,
  })
  // The drain's waits for its top card: its text (S96), or someone's
  // typing in it to stop (ADR-0048 step 7).
  const wait = createWaits({ places, drain: lane => queueDrain(lane) })
  const behind = (card: QueuedCard) =>
    wait(card, signal => cardPort.whenHolds(card.id, card.place.seen, signal))
  const typing = (card: QueuedCard) =>
    wait(card, signal => untilNotTyped(presence, card.id, signal))
  const drain = (lane: LaneName) =>
    drainQueue(
      {
        basics,
        texts: cardPort,
        agent,
        work,
        start: runs.start,
        send: popped =>
          commands.sendPoppedQueuedCard(
            popped.card.place.by,
            newId(),
            chatOfPoppedQueuedCard(popped),
          ),
        presence,
        behind,
        typing,
        provenance,
      },
      lane,
    )
  const settle = createSettle({
    basics,
    keeper,
    drain,
    rootOf: docs.rootOfLane,
    compact: roots => compactAfter(exchange, roots),
    sweep: async () => {
      await sweepBlobs({
        basics,
        blobs,
        grace: blobGraceMs,
        texts: cardPort.texts,
      })
      await sweepHistories({ basics, store, histories, startup: false })
      await sweepHolds({ basics, agent })
      await provenance.sweep()
    },
  })
  // A run's end: hot reload may reload the page, then the lane drains and
  // the session compacts. A thread whose banner failed tries again. The
  // final digest is for the run's prompt: the drain queued before it may
  // append to the lane or start its next run.
  runs.onEnded((lane, prompt) => {
    hotReload.runEnded()
    void settle([lane])
    banners?.due(lane).catch(failed(basics, "banner"))
    const root = docs.rootOfLane(lane)
    if (prompt !== null && root !== null)
      void digests.ended(root, lane, prompt, digestFailed(lane))
  })
  // A card queued on a lane that is not running is popped at once (ADR-0059):
  // the move that queued it asks for a drain. A lane's drain is the keeper's
  // `once`: queued once until its step starts, and a move while it runs
  // queues one more, which finds what that one missed. It keeps its place
  // among the commands, so a late message still goes after the queued cards.
  const queueDrain = (lane: LaneName) => {
    if (readRunning(live, lane)) return
    void keeper.once(`drain:${lane}`, () => drain(lane))
  }
  // `split_offer`: a split card queued on the agent's lane (ADR-0080).
  const askSplit = createSplitCall({
    basics,
    keeper,
    drain: queueDrain,
    provenance,
  })

  /**
   * Resolves when no queued step remains (a compaction after a run among
   * them), no lane's queue has work, and every write has reached the store.
   */
  async function quiet(): Promise<void> {
    await keeper.idle()
    // Lanes' own queues: snapshots, fetches, stops and trims after a run.
    await work.quiet()
    await exchange.flush()
  }

  await recover({
    basics,
    roots,
    agent,
    work,
    keeper,
    start: runs.start,
    settle,
    cards: cardPort,
    provenance,
    ensureNames: names.ensure,
    carryOver,
  })
  await sweepHistories({ basics, store, histories, startup: true })
  await sweepHolds({ basics, agent })
  const seats = startSeats({ exchange, basics, keeper, agent, histories })
  const control = startControl({
    exchange,
    listener,
    handle: commands.handle,
  })

  const server = await startHttp({
    port,
    bind,
    key,
    tools: toolsIn !== null,
    serverTransport,
    hotReload,
    blobs,
    offers: work.offers,
    log,
  })

  const stop = async (): Promise<void> => {
    const carry = async (step: ShutdownStep): Promise<void> => {
      switch (step) {
        case "intake":
          seats.stop()
          control.stop()
          return
        case "close":
          keeper.close()
          work.owner?.close()
          return
        case "quiet":
          // Queued steps, a compaction among them, finish their writes.
          return quiet()
        case "agent":
          return agent.close()
        case "work":
          // A container runs only while its lane runs (ADR-0034).
          return work.close()
        case "exchange":
          histories.dispose()
          await exchange.flush()
          return exchange.shutdown()
        case "server":
          return server.close()
      }
    }
    for (const step of planShutdown()) {
      if (step === "server") await carry(step)
      else
        try {
          await carry(step)
        } catch {}
    }
  }
  let stopping: Promise<void> | null = null

  return {
    port: server.port,
    httpUrl: server.httpUrl,
    wsUrl: server.wsUrl,
    session,
    docs,
    live,
    presence,
    places,
    cardText: (id: CardId) => exchange.get(cardDocId(id), TextDoc).text(),
    agent,
    key,
    invites: server.invites,
    quiet,
    shutdown() {
      stopping ??= stop()
      return stopping
    },
  }
}
