// host — the composition root. It builds the store, the Exchange, the
// documents, pi's scribe and setup, lane work and the agent, in that order,
// and wires the shell's modules; each module takes what it needs as a
// parameter, and only this file wires them (TECHNICAL.md).
//
// Imports NO pi. Everything pi-shaped arrives through pi/.

import { rm } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import {
  createInMemoryStore,
  Exchange,
  type Store,
  whenHydrated,
} from "@kyneta/exchange"
import { Interpret, Reject } from "@kyneta/schema"
import { WebsocketServerTransport } from "@kyneta/websocket-transport/server"
import {
  type ConfigPlaces,
  configPlaces,
  readStartLayers,
} from "@pinetrie/config"
import {
  atEntry,
  type BlobStore,
  type CardId,
  isTextCardId,
  type ModelLine,
  type SetupSession,
  type ThreadId,
  threadEnd,
} from "@pinetrie/core"
import { prepareProjectDir } from "@pinetrie/jj"
import { createKeeper } from "@pinetrie/keeper"
import type { LaneFiles } from "@pinetrie/lanes"
import {
  type AgentDirBinding,
  createAgent,
  createScribe,
  loadPiSetup,
  type ModelChoice,
  newId,
  prepareImage,
} from "@pinetrie/pi"
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
  readParticipantNames,
  readPlaces,
  readRoots,
  readRunning,
  readSetup,
  readThreadName,
  readThreads,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  displayName,
  encodeFact,
  type QueuedText,
  rootsHeld,
  SETUP,
  setIfChanged,
} from "@pinetrie/rules"
import {
  cardDocId,
  LiveDoc,
  type LiveDocHandle,
  PlacesDoc,
  type PlacesDocHandle,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  SessionDoc,
  type SessionDocHandle,
  TextDoc,
} from "@pinetrie/schema"
import { hostSocketIn } from "@pinetrie/ssh"
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
import { createBudgets } from "./budgets.ts"
import { createTaskContext } from "./canvas.ts"
import { createCanvasNews } from "./canvas-news.ts"
import { startCards } from "./cards.ts"
import { createCommands } from "./commands/index.ts"
import { startControl } from "./control.ts"
import { createDigests } from "./digests.ts"
import { startDirectory } from "./directory.ts"
import {
  type HostDocuments,
  hostDocuments,
  planLoads,
  rootsOpenedWords,
} from "./docs.ts"
import {
  compactAfter,
  sweepBlobs,
  sweepHistories,
  sweepHolds,
  sweepTrash,
} from "./housekeeping.ts"
import { startHttp } from "./http.ts"
import { lineDocPrefix } from "./lines.ts"
import {
  migrate,
  planStoredOpen,
  RECORD_MIGRATIONS,
  readStored,
  refusalLine,
} from "./migrations/index.ts"
import { createMoveHistories } from "./move-history.ts"
import { createNames } from "./names.ts"
import type { PageSource } from "./page.ts"
import { createPinned } from "./pinned.ts"
import { hostPolicy, resolveDoc, SCHEMA_OF } from "./policy.ts"
import { projectAdapter } from "./project.ts"
import { createProvenance } from "./provenance.ts"
import {
  chatOfPoppedQueuedCard,
  createWaits,
  drain as drainQueue,
  untilNotTyped,
} from "./queued-card-pop.ts"
import { createRecords, type Records } from "./records.ts"
import { createRelays, type Relays } from "./relays.ts"
import { createRuns, streamInto } from "./runs.ts"
import { startSeats } from "./seats.ts"
import {
  folderReport,
  type HostReport,
  iconSettings,
  listedFolders,
  SETTINGS,
  settleHost,
  titleSettings,
} from "./settings.ts"
import { createSettle } from "./settle.ts"
import { planSetupRecord } from "./setup-record.ts"
import { planShutdown, type ShutdownStep } from "./shutdown.ts"
import { createSplitCall } from "./split-call.ts"
import { recover } from "./startup.ts"
import { agentReadyLine, reportLines } from "./startup-lines.ts"
import { openStore } from "./store.ts"
import { tasksNow } from "./tasks.ts"
import { createTitles } from "./titles.ts"
import { startLaneWork } from "./work/index.ts"
import { findProject } from "./work/runtime.ts"
import { openProject } from "./work/setup.ts"
import { type PersonalSshPlaces, prepareSshDir } from "./work/ssh.ts"

/** How long an image nothing shows is kept, from its upload or last touch: for one pasted and not yet sent. */
export const BLOB_GRACE_MS = 24 * 60 * 60 * 1000

export interface StartHostOptions {
  readonly port?: number
  /** The address to listen on. Default loopback: only this machine. */
  readonly bind?: string
  /**
   * The invite key, off loopback. Absent, a fresh one is made; on loopback
   * there is none, since only this machine can connect.
   */
  readonly key?: string
  /**
   * No default: a suite that forgot one must not spend the person's models.
   * `configured` is the model the config settles.
   */
  readonly model:
    | { readonly kind: "configured" }
    | Exclude<ModelChoice, { readonly kind: "configured" }>
  /**
   * The project: where `AGENTS.md` loads from, and, with
   * `tools`, where the agent reads, writes and runs commands, each lane in its
   * own container, on its own disk. Absent or null: no project, and no tools.
   * With tools, a folder with no jj repo, or a runtime that cannot run lanes,
   * refuses the start (`HostRefused`); and `files` is where the session keeps
   * its lanes' runtime, ignore file and ssh files (`sessionFiles`), never in
   * the project.
   */
  readonly project?:
    | {
        readonly dir: string
        readonly tools: true
        readonly files: LaneFiles
      }
    | { readonly dir: string; readonly tools: false }
    | null
  /**
   * Where each config layer's file is, and pine·trie's own directories; by
   * default from the XDG variables, with no local layer: only a session
   * opened by `server.ts` has one. A suite passes its own rather than move
   * `XDG_CONFIG_HOME`, which git and jj read too.
   */
  readonly places?: ConfigPlaces
  /** The session served (`openSession`), which the setup page names; none by default. */
  readonly served?: SetupSession | null
  /** The variables the config's `env` layer reads; by default the process's. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** pi's agent directory, bound to `places`' config directory for this process (`bindAgentDir`). */
  readonly binding: AgentDirBinding
  /**
   * The person's ssh files (`~/.ssh`: its `config` and `known_hosts`) and
   * agent (`SSH_AUTH_SOCK`), which lanes' ssh reads. A suite passes its own,
   * so no suite reads the person's.
   */
  readonly ssh?: PersonalSshPlaces
  /**
   * Where the session is kept: a SQLite file; a Kyneta store a caller made, as
   * a suite does to read it while the host runs; or, absent or null, a store in
   * memory. Shutting the host down closes the store, whoever made it. Every
   * host has a store: Kyneta compacts only a document with one, and compaction
   * is also what trims the session's in-memory op log.
   */
  readonly store?: string | Store | null
  /** Where the page comes from: Vite unless given (`pnpm serve` gives the built page). */
  readonly page?: PageSource
  /**
   * The images, for a caller that gives a `Store` it made: pass the `blobs`
   * `openStore` gave with it, so a restart keeps them. A store given as a file
   * keeps its own; otherwise they are held in memory.
   */
  readonly blobs?: BlobStore
  /**
   * Where the host reads the time: its own (`Basics.now`) and the blobs it
   * opens or keeps in memory. `blobs` given here keep their own clock, which
   * must be this one: a store behind the host's clock makes every blob it
   * stamps look old to the sweep.
   */
  readonly now?: () => number
  /** How long presence lasts without a refresh; a suite shortens it. */
  readonly presenceDecay?: PresenceDecay
  readonly log?: (message: string) => void
}

export interface RunningHost {
  readonly port: number
  readonly httpUrl: string
  readonly wsUrl: string
  /** The run's model, or why there is none. */
  readonly model: ModelLine
  /** What the host read of its config, settled. */
  readonly config: HostReport
  /** The session's records, as the host holds them: for the suites to read. */
  readonly session: SessionDocHandle
  /** Every document, each root's among them (`docs.ts`): for the suites. */
  readonly docs: HostDocuments
  /** What is streaming now, as the host holds it: for the suites to read. */
  readonly live: LiveDocHandle
  readonly presence: PresenceDocHandle
  /**
   * Where every card is, as the host holds it: for the suites to read. Only
   * `applyPlaceSteps` writes it.
   */
  readonly places: PlacesDocHandle
  /** A card's text as the host holds it: for the suites. */
  cardText(id: CardId): string
  /** The host's records: for a suite to write one as the host would. */
  readonly records: Records
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

/**
 * Thrown by `startHost` when a host with tools cannot run its lanes here:
 * `findProject`'s refusal, worded with its fix. Nothing was opened.
 */
export class HostRefused extends Error {}

export async function startHost({
  port = 0,
  bind = DEFAULT_BIND,
  key: givenKey,
  model,
  project = null,
  env = process.env,
  places: where = configPlaces(env, homedir(), null),
  served = null,
  binding,
  ssh = {
    dir: path.join(homedir(), ".ssh"),
    agent: process.env.SSH_AUTH_SOCK ?? null,
  },
  store: storeFile = null,
  page = { kind: "vite" },
  blobs: givenBlobs,
  now = Date.now,
  presenceDecay = PRESENCE_DECAY,
  log = console.log,
}: StartHostOptions): Promise<RunningHost> {
  const key = isLoopback(bind) ? null : (givenKey ?? newKey())
  const toolsIn = project?.tools === true ? project.dir : null

  // The config layers that do not change while the host runs, read once.
  // The project's copies are read once the project is open (`openProject`).
  const start = await readStartLayers(SETTINGS, where, env)
  // The project, before anything opens, so a refusal leaves nothing to close,
  // and before pi's setup, which loads from its root.
  // The host's ssh socket's directory, named before the runtime is found:
  // the Mac's lease names the socket, which listens once lane work starts.
  const sshDir = await prepareSshDir()
  const projectDir = toolsIn === null ? null : await prepareProjectDir(toolsIn)
  // Chosen once, by the project's kind: a folder lanes cannot serve is
  // refused before any runtime is asked.
  const chosen = projectDir === null ? null : projectAdapter(projectDir)
  if (chosen !== null && "refused" in chosen) {
    await rm(sshDir, { recursive: true, force: true })
    throw new HostRefused(chosen.refused)
  }
  const found = await findProject({
    hostSocket: hostSocketIn(sshDir),
    root: chosen?.root ?? null,
    // A port of 0 is chosen when the host listens, after this.
    ownPort: port === 0 ? null : port,
    // Only the machine's and your own file may set it: no project's copy.
    slots: settleHost(start, {}).settled["lanes.vm.slots"].value,
    log,
  })
  if (found?.kind === "refused") {
    await rm(sshDir, { recursive: true, force: true })
    throw new HostRefused(found.words)
  }

  // --- transport + exchange ------------------------------------------------
  const serverTransport = new WebsocketServerTransport()
  const opened =
    typeof storeFile === "string"
      ? openStore(storeFile, { now })
      : {
          store: storeFile ?? createInMemoryStore(),
          blobs: givenBlobs ?? memoryBlobs(now),
          backup: null,
        }
  const { store, blobs } = opened
  // Every stored command Line belongs to a client seat that cannot return: a
  // client keeps no store and does not reconnect (host/lines.ts).
  for await (const id of store.listDocIds(lineDocPrefix(CONTROL_TOPIC)))
    await store.delete(id)
  // Each stored document's schema, checked before anything opens one: opened
  // under a changed schema, a dropped field's data goes at the next compaction.
  const stored = await readStored(store)
  const openPlan = planStoredOpen(stored)
  if (openPlan.kind === "refuse") {
    await store.close()
    throw new Error(refusalLine(openPlan))
  }
  // Clients find the host by its principal and address their Lines to the seat
  // Kyneta issues it. The host has no WRITER identity: writers are the
  // connected clients, named by their principals, and they own no lanes; lanes
  // belong to threads.
  const exchange = new Exchange({
    principal: HOST_PRINCIPAL,
    type: "service",
    transports: [serverTransport],
    store,
    // A client does not reconnect: a closed channel is a seat that has left,
    // so there is nothing to wait for before its Line goes.
    departureTimeout: 0,
    // Cards' texts and a person's documents are created by clients: without
    // this, a document the host never opened itself would be neither stored nor
    // relayed. The host never writes a person's document.
    resolve: docId => {
      const kind = resolveDoc(docId, root => readRoots(session).has(root))
      if (kind === "reject") return Reject()
      return kind === undefined ? undefined : Interpret(SCHEMA_OF[kind])
    },
  })

  await migrate({
    plan: openPlan,
    records: RECORD_MIGRATIONS,
    storedIds: [...stored.keys()],
    exchange,
    backup: opened.backup,
    log,
  })
  // The session's records, the directory of roots among them. Each root's
  // document is opened through `docs`, below.
  const session = exchange.get(SESSION_DOC_ID, SessionDoc)
  // The host is every document's authority: no peer is upstream of it. So
  // Kyneta loads a root it let go again when a client asks for it.
  exchange.register({ name: "pinetrie.authority", authority: "self" })
  // Clients may write presence and cards' texts (host/policy.ts); only the
  // host the session and the places, and only its person an inventory
  // (`writersPolicy`, registered on every client too).
  exchange.register(hostPolicy)
  exchange.register(writersPolicy)
  // Held here so the host relays it between clients.
  const presence = exchange.get(PRESENCE_DOC_ID, presenceDoc(presenceDecay))
  // Where every card is, which only the host writes.
  const places: PlacesDocHandle = exchange.get(PLACES_DOC_ID, PlacesDoc)
  // What is streaming now, which only the host writes.
  const live: LiveDocHandle = exchange.get(LIVE_DOC_ID, LiveDoc)
  // A stored session loads asynchronously; pi must see it before it starts.
  // Only storage is awaited: the host is the authority, with no peer upstream.
  await whenHydrated(session)
  await whenHydrated(places)
  await whenHydrated(live)
  // Each person's history of moves, per root.
  const histories = createMoveHistories(exchange)
  const docs = hostDocuments({ exchange, session, live, places })
  const basics: Basics = {
    session,
    live,
    docs,
    places,
    log,
    newId,
    now,
  }

  // The host writes its own records; every module that writes one takes this.
  const records = createRecords(docs)

  // --- pi: the scribe and the model setup --------------------------------
  // A thread's appends go through the scribe, which holds each root's one pi
  // session; the agent, made last, builds its harnesses over them.
  const scribe = createScribe({ documents: docs, replicaId: newId(), blobs })
  // Before a root's document goes, what holds it lets go: the scribe closes the
  // agent's harness over it, then its session.
  docs.onReleasing(root => scribe.release(root))
  // So do the stacks of moves of the tasks holding its threads.
  docs.onReleasing(async root => {
    const tasks = tasksNow({ places, session }).tasksOfRoot.get(root) ?? []
    for (const task of tasks) await histories.unloadTask(task)
  })
  const projectRoot = found?.project.root ?? project?.dir ?? null
  // The project, opened, and the config settled with accepted work's copy:
  // before pi's setup, which reads `model`, `skills` and `prompts` from it.
  // A host without lane work reads its folder's file as every copy.
  const openedProject = await openProject({
    basics,
    found,
    adapter: chosen?.adapter ?? null,
    files: project?.tools === true ? project.files : null,
    start,
  })
  const report: HostReport =
    openedProject === null
      ? await folderReport(start, project?.dir ?? null)
      : openedProject.configs.accepted().report
  for (const line of reportLines(report)) log(line)
  const { settled } = report
  const iconConfig = iconSettings(settled)
  const draws = iconConfig.source === "drawn"
  const titleConfig = titleSettings(settled)
  const accepted =
    openedProject === null ? null : openedProject.configs.accepted().copy.values
  const listRoot = projectRoot ?? process.cwd()
  const piSetup = await loadPiSetup({
    model:
      model.kind === "configured"
        ? { kind: "configured", model: settled.model.value }
        : model,
    places: {
      configDir: where.dirs.config,
      credentials: where.credentials,
      models: where.models,
    },
    binding,
    lists: {
      packages: settled.packages.value,
      skills: listedFolders(start, accepted, "skills", listRoot),
      prompts: listedFolders(start, accepted, "prompts", listRoot),
    },
    commandRenames: settled["commands.names"].value,
    titleModel: titleConfig.model,
    ...(iconConfig.source === "drawn" ? { banner: iconConfig.model } : {}),
    ...(projectRoot === null ? {} : { project: projectRoot }),
  })
  for (const p of piSetup.refusedPackages)
    log(`[host] ${p} is not a folder: the package is not loaded`)
  const setupRecordNow = (r: HostReport) =>
    planSetupRecord({
      report: r,
      model: piSetup.model,
      origins: model.kind === "configured" ? r.settled.model.origins : null,
      setup: piSetup,
      session: served,
    })
  if (titleConfig.model !== null && !piSetup.titleModelFound)
    log(
      `[host] titles name ${titleConfig.model.provider}/${titleConfig.model.model}, which pi does not have: titles use the run's model`,
    )
  if (iconConfig.source === "drawn" && !(await piSetup.canDrawBanners()))
    log(
      `[host] icons are drawn, but ${iconConfig.model.provider}/${iconConfig.model.model} cannot be drawn: no key, or no such model`,
    )

  const keeper: HostKeeper = createKeeper<HostKey>({
    onError: failed(basics, "step"),
    onSlow: slow(basics),
  })
  // The roots that are not archived, opened before anything reads one: every
  // lane that could be running is in one of them (`planLoads`).
  const threadsNow = readThreads(session)
  const roots = planLoads(
    rootsHeld(
      readPlaces(places),
      threadsNow,
      new Set(readArchived(session, places).keys()),
      new Set(readRoots(session).keys()),
    ),
  )
  for (const root of roots) await docs.root(root)
  const total = new Set([...threadsNow.values()].map(t => t.root)).size
  log(`[host] ${rootsOpenedWords({ opened: roots.length, total })}`)
  // The directory follows the roots opened above as well as those opened
  // later (`onOpened`).
  startDirectory({ basics, keeper, records })
  // Each thread's banner: a pasted one under any icon source, a drawn one only
  // under `drawn`.
  const banners = createBanners({
    basics,
    keeper,
    blobs,
    records,
    piSetup,
    draws,
  })
  // Each run's verdict, and each ask's digest unless the config turns
  // digests off. What agents talking spend. Its drain and the relays are made
  // after the agent, whose hooks call them: bound late.
  let queueDrainLate: (lane: ThreadId) => void = () => {}
  const budgets = createBudgets({
    basics,
    keeper,
    records,
    limit: settled["agents.budget"].value,
    drain: lane => queueDrainLate(lane),
  })
  const digests = createDigests({
    basics,
    keeper,
    presence,
    records,
    piSetup,
    enabled: settled["digests.enabled"].value,
    spent: (ask, tokens) => budgets.spendFor(ask, tokens),
  })
  const digestFailed = (lane: ThreadId) =>
    failed(basics, "summarizing its ask", lane)
  // Each root's title, unasked as its first lane starts unless the config
  // turns that off, or when a person asks.
  const titles = createTitles({
    basics,
    keeper,
    enabled: titleConfig.enabled,
    records,
    piSetup,
  })
  // Every thread's name. A drawn banner is drawn from its name, so it starts
  // as the name is written.
  const names = createNames({
    basics,
    records,
    onNamed: lane => {
      banners.due(lane).catch(failed(basics, "banner"))
    },
  })
  const provenance = createProvenance({ basics, presence, records })
  // `split_offer`: a split card queued on the agent's lane, which its run's end
  // pops.
  const askSplit = createSplitCall({ basics, keeper, provenance })

  // --- where lanes work -----------------------------------------------------
  const work = await startLaneWork({
    basics,
    project: openedProject,
    report: openedProject === null ? null : report,
    places: where,
    sshDir,
    personalSsh: ssh,
    records,
    piSetup,
    ensureNames: names.ensure,
  })

  let relaysLate: Relays | null = null
  const relaysNow = (): Relays => {
    if (relaysLate === null) throw new Error("the relays are not made yet")
    return relaysLate
  }

  // --- the agent, at work in threads' lanes ---------------------------------
  const agent = await createAgent({
    documents: docs,
    scribe,
    setup: piSetup,
    blobs,
    tools:
      toolsIn === null
        ? null
        : {
            access: work.access,
            bannerAsks: banners.request,
            hooks: {
              ...work.hooks,
              askSplit,
              ask: (lane, to, text) => relaysNow().ask(lane, to, text),
              leave: (lane, thread) => relaysNow().leave(lane, thread),
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
    onUsage: (lane, tokens) => budgets.onUsage(lane, tokens),
    mayRequest: lane => budgets.mayRequest(lane),
  })
  log(
    agentReadyLine({
      model: piSetup.model,
      origins: model.kind === "configured" ? settled.model.origins : null,
      tools: toolsIn === null ? null : (projectRoot ?? toolsIn),
    }),
  )

  // --- the shell -----------------------------------------------------------
  // What each thread is told of its base's new work: lane work's refreshes
  // announce a changed base, and a running lane is steered.
  const baseNews = createBaseNews({ basics, agent, keeper })
  work.onBaseChanged(lane => baseNews.baseChanged(lane))
  // A card added to or taken from a task, told to its running threads.
  const canvasNews = createCanvasNews({ basics, agent, keeper })
  provenance.onChanged(change => canvasNews.changed(change))
  // Commands are received only from `startControl`, after `recover`.
  const listener = Control.listen(exchange)
  const cardPort = startCards({ exchange, store, session })
  const { readPinned } = createPinned({ basics, cards: cardPort })
  const { readTaskContext } = createTaskContext({ basics, cards: cardPort })
  const runs = createRuns({
    basics,
    agent,
    work,
    readPinned,
    readTaskContext,
    baseNews,
    pending: digests.pending,
  })
  const relays = createRelays({
    basics,
    keeper,
    agent,
    scribe,
    start: runs.start,
    runnable: lane => work.runnable(lane),
    budgets,
    piSetup,
    drain: lane => queueDrain(lane),
  })
  relaysLate = relays
  const commands = createCommands({
    basics,
    agent,
    scribe,
    records,
    piSetup,
    work,
    blobs,
    fitImage: async (bytes, most) => {
      const fitted = await prepareImage(bytes, {
        maxWidth: most,
        maxHeight: most,
      })
      return fitted.ok ? fitted.image : null
    },
    cards: cardPort,
    start: runs.start,
    cancel: runs.cancel,
    names,
    titles,
    drain: lane => queueDrain(lane),
    histories,
    provenance,
    keeper,
    relays,
  })
  // The drain's waits for its top card: its text, someone's typing in it to
  // stop, or a blank card to be written in.
  const wait = createWaits({ places, drain: lane => queueDrain(lane) })
  const behind = (card: QueuedText) =>
    wait(card, signal => cardPort.whenHolds(card.id, card.place.seen, signal))
  const typing = (card: QueuedText) =>
    wait(card, signal => untilNotTyped(presence, card.id, signal))
  const blank = (card: QueuedText) =>
    wait(card, signal => cardPort.whenWritten(card.id, signal))
  const drain = (lane: ThreadId) =>
    drainQueue(
      {
        basics,
        records,
        texts: cardPort,
        blobs,
        agent,
        work,
        start: runs.start,
        send: async popped => {
          const root = readThreads(session).get(popped.card.place.thread)?.root
          return root === undefined
            ? { kind: "failed", message: "its thread has no record" }
            : commands.sendPoppedQueuedCard(
                popped.card.place.by,
                newId(),
                chatOfPoppedQueuedCard(popped, root),
              )
        },
        presence,
        behind,
        typing,
        blank,
        provenance,
        relay: (to, relay) => relays.relayCard(to, relay),
        appendLaneless: async (thread, fact) => {
          if (docs.docOfLane(thread) !== null) return false
          const root = readThreads(session).get(thread)?.root
          const doc = root === undefined ? null : docs.view(root)?.doc
          const end =
            doc === null || doc === undefined
              ? null
              : threadEnd(readTreeIndex(doc), thread)
          if (root === undefined || end === null) return false
          const names = readParticipantNames(session)
          await scribe.appendToTree(
            encodeFact(
              fact,
              displayName(fact.by, names.get(fact.by)),
              basics.now(),
            ),
            { root, at: atEntry(end) },
            thread,
          )
          return true
        },
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
        grace: BLOB_GRACE_MS,
        texts: cardPort.texts,
      })
      await sweepHistories({ basics, store, histories, startup: false })
      await sweepHolds({ basics, records })
      await sweepTrash({ basics, cards: cardPort, work })
      await provenance.sweep()
    },
  })
  // A run's end: the lane drains and the session compacts. A thread whose banner failed tries again. The
  // final digest is for the run's prompt: the drain queued before it may
  // append to the lane or start its next run.
  runs.onEnded((lane, prompt) => {
    void relays.ended(lane, prompt).catch(failed(basics, "an answer"))
    void settle([lane])
    banners.due(lane).catch(failed(basics, "banner"))
    const root = docs.rootOfLane(lane)
    if (prompt !== null && root !== null)
      void digests.ended(root, lane, prompt, digestFailed(lane))
  })
  // A card queued on a lane that is not running is popped at once: the move
  // that queued it asks for a drain. A lane's drain is the keeper's `once`:
  // queued once until its step starts, and a move while it runs queues one
  // more, which finds what that one missed. It keeps its place among the
  // commands, so a late message still goes after the queued cards.
  const queueDrain = (lane: ThreadId) => {
    if (readRunning(live, lane)) return
    void keeper.once(`drain:${lane}`, () => drain(lane))
  }
  queueDrainLate = queueDrain
  /**
   * Resolves when no queued step remains (a compaction after a run among
   * them), no lane's queue has work, and every write has reached the store.
   */
  async function quiet(): Promise<void> {
    await keeper.idle()
    // Lanes' own queues: snapshots, fetches and stops after a run.
    await work.quiet()
    await exchange.flush()
  }

  await recover({
    basics,
    roots,
    agent,
    records,
    piSetup,
    work,
    keeper,
    start: runs.start,
    settle,
    cards: cardPort,
    provenance,
    ensureNames: names.ensure,
    icons: { source: iconConfig.source },
    setup: setupRecordNow(report),
  })
  // Accepted work moved: what its copy of the config refused, and what it
  // settles, may have too.
  openedProject?.configs.onTaken(next =>
    keeper
      .run(() =>
        records.writeValues(
          setIfChanged(
            SETUP,
            setupRecordNow(next.report),
            readSetup(session) ?? undefined,
          ),
        ),
      )
      .catch(failed(basics, "the setup record")),
  )
  await sweepHistories({ basics, store, histories, startup: true })
  await sweepHolds({ basics, records })
  await sweepTrash({ basics, cards: cardPort, work })
  await provenance.sweep()
  const seats = startSeats({ exchange, basics, keeper, records, histories })
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
    blobs,
    destination: work.destination,
    page,
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
          work.destination?.close()
          return
        case "quiet":
          // Queued steps, a compaction among them, finish their writes.
          return quiet()
        case "agent":
          // Every harness closes, which ends running runs.
          return agent.close()
        case "scribe":
          // Every session, the session document's too: a later write is refused.
          return scribe.close()
        case "work":
          // A container runs only while its lane runs.
          await work.close()
          return rm(sshDir, { recursive: true, force: true })
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
    model: piSetup.model,
    config: report,
    session,
    docs,
    live,
    presence,
    places,
    cardText: (id: CardId) =>
      isTextCardId(id) ? exchange.get(cardDocId(id), TextDoc).text() : "",
    records,
    key,
    invites: server.invites,
    quiet,
    shutdown() {
      stopping ??= stop()
      return stopping
    },
  }
}
