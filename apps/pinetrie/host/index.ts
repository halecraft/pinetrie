// host — the composition root. It builds the store, the Exchange, the
// documents, pi's scribe and setup, lane work with its lanes ready, and the
// agent, in that order, then listens, and wires the shell's modules; each module takes what it needs as a
// parameter, and only this file wires them (TECHNICAL.md).
//
// Imports NO pi. Everything pi-shaped arrives through pi/.

import { rm } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { createInMemoryStore, Exchange, whenHydrated } from "@kyneta/exchange"
import { Interpret, Reject } from "@kyneta/schema"
import { WebsocketServerTransport } from "@kyneta/websocket-transport/server"
import {
  type ConfigPlaces,
  configPlaces,
  readStartLayers,
} from "@pinetrie/config"
import type { RootId, SnapshotId, ThreadId } from "@pinetrie/core"
import { type Install, thisInstall } from "@pinetrie/install"
import { prepareProjectDir } from "@pinetrie/jj"
import { createKeeper } from "@pinetrie/keeper"
import type { LaneFiles } from "@pinetrie/lanes"
import { planCapabilities, planStoreSize } from "@pinetrie/machine"
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
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import { writersPolicy } from "@pinetrie/protocol/writers"
import {
  readLaneRecords,
  readReadingCanvases,
  readRoots,
  readRunning,
  readSetup,
  readThreads,
} from "@pinetrie/reads"
import {
  type ModelLine,
  type QueuedText,
  SETUP,
  type SetupSession,
  SUBSCRIPTION_SETTING,
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
  type RootDocHandle,
  readActiveLanes,
  SessionDoc,
  type SessionDocHandle,
  TextDoc,
} from "@pinetrie/schema"
import { hostSocketIn } from "@pinetrie/ssh"
import { type CardId, isTextCardId } from "@pinetrie/threads"
import { DEFAULT_BIND, isLoopback, newKey } from "./admission.ts"
import { createAllowances } from "./allowances.ts"
import { createAnswers } from "./answers.ts"
import { createBanners } from "./banners.ts"
import { createBaseNews } from "./base-news.ts"
import {
  type Basics,
  compactionLine,
  failed,
  type HostKeeper,
  type HostKey,
  inStep,
  type LeaseBasics,
  SLOW_COMPACTION_MS,
  slow,
} from "./basics.ts"
import { memoryBlobs } from "./blobs.ts"
import { createCanvasContext } from "./canvas.ts"
import { createCanvasNews } from "./canvas-news.ts"
import { startCards } from "./cards.ts"
import { createCommands } from "./commands/index.ts"
import { startControl } from "./control.ts"
import { createDelivery } from "./delivery.ts"
import { createDigests, writePendingRunEndReport } from "./digests.ts"
import { startDirectory } from "./directory.ts"
import {
  type HostDocuments,
  hostDocuments,
  planLoads,
  rootsOfLanes,
  rootsOpenedWords,
} from "./docs.ts"
import { moveCanvasToActive } from "./first-work.ts"
import { createFocuses } from "./focuses.ts"
import { forward } from "./forward.ts"
import { HostRefused } from "./host-refused.ts"
import { type SweepDeps, sweepUnused } from "./housekeeping.ts"
import { startHttp } from "./http.ts"
import { createLater } from "./later.ts"
import { createRunStarts, gatherLaneImportance } from "./machine/importance.ts"
import {
  type MachineWatch,
  type MachineWatchOptions,
  startMachineWatch,
} from "./machine/index.ts"
import { memoryMachineMeasurements } from "./machine/measurements.ts"
import { createStoreRecords } from "./machine/records.ts"
import { createShellCalls } from "./machine/shell-calls.ts"
import {
  migrate,
  planStoredStart,
  prepareStore,
  readStored,
  refusalLine,
} from "./migrations/index.ts"
import { memoryLedger } from "./migrations/ledger.ts"
import { createMoveHistories } from "./move-history.ts"
import { createNames } from "./names.ts"
import { NO_PAGE, type PageSource } from "./page.ts"
import { createPinned } from "./pinned.ts"
import { createPlaces } from "./places.ts"
import { hostPolicy, resolveDoc, SCHEMA_OF } from "./policy.ts"
import { projectAdapter } from "./project.ts"
import { createProvenance } from "./provenance.ts"
import { createPutImage } from "./put-image.ts"
import {
  createWaits,
  drain as drainQueue,
  sendOfPoppedQueuedCard,
  untilNotTyped,
} from "./queued-card-pop.ts"
import { createReadCard } from "./read-card.ts"
import { createRecords, type Records } from "./records.ts"
import { createRelays, type Relays } from "./relays.ts"
import { fileTrace } from "./root-trace.ts"
import { createRoots, queueUpkeepOn, type StepDocs } from "./roots.ts"
import { createRunDocs, createRuns, streamInto } from "./runs.ts"
import { createReadBlob } from "./save-blob.ts"
import { startSeats } from "./seats.ts"
import {
  folderReport,
  type HostReport,
  iconSettings,
  listedFolders,
  SETTINGS,
  settleHost,
  storeSettings,
  titleSettings,
} from "./settings.ts"
import { createSettle } from "./settle.ts"
import { planSetupRecord } from "./setup-record.ts"
import { planShutdown, type ShutdownStep } from "./shutdown.ts"
import { memorySnapshotIndex } from "./snapshot-index.ts"
import { createSplitCall } from "./split-call.ts"
import { createSshNews } from "./ssh-news.ts"
import { stallWords, watchStalls } from "./stalls.ts"
import {
  laneMachine,
  planStartSteps,
  type StartProgress,
} from "./start-checklist.ts"
import { lineProgress } from "./start-terminal.ts"
import { recover, recoverRoot } from "./startup.ts"
import {
  agentReadyLine,
  reportLines,
  subscriptionLines,
} from "./startup-lines.ts"
import { type OpenedStore, openStore } from "./store.ts"
import { createTitles } from "./titles.ts"
import { startLaneWork } from "./work/index.ts"
import { findProject } from "./work/runtime.ts"
import { openProject } from "./work/setup.ts"
import { type PersonalSshPlaces, prepareSshDir } from "./work/ssh.ts"

/** How long an image nothing shows is kept, from its upload or last touch: for one pasted and not yet sent. */
export const BLOB_GRACE_MS = 24 * 60 * 60 * 1000

export interface StartHostOptions {
  /**
   * The pine·trie install lanes run from: this process's own by default. A
   * suite names an installed package's, to run its scripts in lanes.
   */
  readonly install?: Install
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
   * Where the session is kept: a SQLite file; a store a caller opened
   * (`openStore`), as a suite does to read it while the host runs, with its
   * blobs and ledger; or, absent or null, a store in memory. Shutting the host
   * down closes the store, whoever opened it. Every host has a store: Kyneta
   * compacts only a document with one, and compaction is also what trims the
   * session's in-memory op log.
   */
  readonly store?: string | OpenedStore | null
  /** Where the page comes from: none unless given (`pnpm dev` gives Vite's, `pinetrie serve` the built page). */
  readonly page?: PageSource
  /**
   * Where the host reads the time: its own (`Basics.now`) and the blobs it
   * opens or keeps in memory. A store a caller opened keeps its blobs' clock,
   * which must be this one (`openStore`'s `now`): a store behind the host's
   * clock makes every blob it stamps look old to the sweep.
   */
  readonly now?: () => number
  /** How long presence lasts without a refresh; a suite shortens it. */
  readonly presenceDecay?: PresenceDecay
  /** The machine's sensor and how often it is sampled; a suite gives its own pressure. */
  readonly machine?: MachineWatchOptions
  /**
   * Keep each root's last copy for `rootsRead`, so a suite reads a root the
   * host let go. Never in use: it keeps every root ever loaded in memory.
   */
  readonly keepRootsRead?: boolean
  readonly log?: (message: string) => void
  /**
   * Where the start's steps are reported (`start-terminal.ts`); by default a
   * line of `log` for each step's end.
   */
  readonly progress?: StartProgress
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
  /** The documents always held (`docs.ts`): for the suites. */
  readonly docs: HostDocuments
  /**
   * The documents' keeper: a suite reads a root in a step of its own
   * (`run`), as the host does.
   */
  readonly steps: Pick<HostKeeper, "run">
  /** The roots loaded now: for a suite to check what the upkeep let go. */
  rootsLoaded(): readonly RootId[]
  /**
   * With `keepRootsRead`, each root this host has loaded, as it last held it
   * (`Roots.lastRead`):
   * what the suites read synchronously, loaded or not now.
   */
  rootsRead(): ReadonlyMap<RootId, RootDocHandle>
  /** What is streaming now, as the host holds it: for the suites to read. */
  readonly live: LiveDocHandle
  readonly presence: PresenceDocHandle
  /**
   * Where every card is, as the host holds it: for the suites to read. Only
   * the writer of the places (`places.ts`) writes it.
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
 * Start a host: every step of its start reported to `progress` (by default
 * a line of `log` per step), and listening last. A start that throws, a
 * `HostRefused` among them, first closes what it opened.
 */
export async function startHost(
  options: StartHostOptions,
): Promise<RunningHost> {
  const progress =
    options.progress ??
    lineProgress(options.log ?? console.log, {
      steps: planStartSteps({ tools: options.project?.tools === true }),
      machine: laneMachine(process.platform),
      times: {},
    })
  // Disposed only when the start throws: once returned, `shutdown()` closes
  // the host in `planShutdown`'s order.
  const closers = new AsyncDisposableStack()
  try {
    const host = await openHost(options, progress, closers)
    progress.end()
    return host
  } catch (error) {
    progress.fail(error)
    await closers.disposeAsync().catch(() => {})
    throw error
  }
}

async function openHost(
  {
    install = thisInstall,
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
    page = NO_PAGE,
    now = Date.now,
    presenceDecay = PRESENCE_DECAY,
    machine: machineOptions = {},
    keepRootsRead = false,
    log = console.log,
  }: StartHostOptions,
  progress: StartProgress,
  closers: AsyncDisposableStack,
): Promise<RunningHost> {
  const key = isLoopback(bind) ? null : (givenKey ?? newKey())
  const toolsIn = project?.tools === true ? project.dir : null

  // The config layers that do not change while the host runs, read once.
  // The project's copies are read once the project is open (`openProject`).
  const start = await readStartLayers(SETTINGS, where, env)
  // The project, before the store opens, so a refusal has little to close,
  // and before pi's setup, which loads from its root.
  // The host's ssh socket's directory, named before the runtime is found:
  // the Mac's lease names the socket, which listens once lane work starts.
  if (toolsIn !== null) progress.begin("lane-machine")
  const sshDir = await prepareSshDir()
  closers.defer(() => rm(sshDir, { recursive: true, force: true }))
  const projectDir = toolsIn === null ? null : await prepareProjectDir(toolsIn)
  // Chosen once, by the project's kind: a folder lanes cannot serve is
  // refused before any runtime is asked.
  const chosen = projectDir === null ? null : projectAdapter(projectDir)
  if (chosen !== null && "refused" in chosen)
    throw new HostRefused(chosen.refused)
  // The settings no project's copy may set, settled from the start's layers.
  const hostOnly = settleHost(start, {}).settled
  const found = await findProject({
    install,
    hostSocket: hostSocketIn(sshDir),
    root: chosen?.root ?? null,
    // A port of 0 is chosen when the host listens, after this.
    ownPort: port === 0 ? null : port,
    // Only the machine's and your own file may set it: no project's copy.
    slots: hostOnly["lanes.vm.slots"].value,
    log,
    working: work => progress.working(work),
    // Like the slots, from the machine's and your own file alone.
    manage: hostOnly["lanes.manage"].value,
    growData: facts =>
      planStoreSize(
        facts,
        storeSettings(hostOnly),
        planCapabilities("lane-vm"),
      ),
  })
  if (found?.kind === "refused") throw new HostRefused(found.words)
  if (found !== null) closers.defer(() => found.close())

  // --- transport + exchange ------------------------------------------------
  progress.begin("store")
  const serverTransport = new WebsocketServerTransport()
  const opened: OpenedStore =
    typeof storeFile === "string"
      ? openStore(storeFile, { now })
      : (storeFile ?? {
          store: createInMemoryStore(),
          blobs: memoryBlobs(now),
          ledger: memoryLedger(),
          snapshots: memorySnapshotIndex(),
          measurements: memoryMachineMeasurements(now),
          backup: null,
          sizes: null,
        })
  const { store, blobs } = opened
  // The exchange closes the store once it is made (`shutdown`).
  let storeClosedBy: "start" | "exchange" = "start"
  closers.defer(async () => {
    if (storeClosedBy === "start") await store.close()
  })
  // Each stored document's schema, checked before anything opens one: opened
  // under a changed schema, a dropped field's data goes at the next
  // compaction. Read before anything is deleted, so one plan decides it all.
  const startPlan = planStoredStart(
    await readStored(store),
    opened.ledger.ran(),
  )
  if (startPlan.kind === "refuse")
    throw new Error(refusalLine(startPlan.refusal))
  await prepareStore(opened, startPlan, { now, log })
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
  storeClosedBy = "exchange"

  await migrate({
    plan: startPlan.open,
    records: startPlan.records,
    storedIds: startPlan.kept,
    exchange,
    opened,
    now,
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
  const docs = hostDocuments({ session, live, places })
  // Every root's document, reached only through a step of the documents'
  // keeper or a lease (`roots.ts`). The upkeep is queued on the keeper, made
  // below; one due before is dropped, since `recover`'s settle queues an
  // upkeep after every load before it.
  const upkeepDue = forward<[]>("the upkeep", "drop")
  // `PINETRIE_ROOT_TRACE=<file>` logs every use of a root, to replay offline.
  const rootTrace =
    env.PINETRIE_ROOT_TRACE === undefined || env.PINETRIE_ROOT_TRACE === ""
      ? null
      : fileTrace(env.PINETRIE_ROOT_TRACE, now)
  if (rootTrace !== null)
    log(`[host] tracing roots to ${env.PINETRIE_ROOT_TRACE}`)
  const roots = createRoots({
    exchange,
    session,
    queueUpkeep: upkeepDue.call,
    failed: error => failed(basics, "compaction")(error),
    sizes: opened.sizes,
    // A run's lane is cleared from `pinetrie:live` before its settle queues
    // the upkeep, so the run that just ended keeps no scratch document.
    running: () =>
      new Set(
        rootsOfLanes(
          readActiveLanes(live),
          lane => readLaneRecords(session).get(lane)?.root,
        ),
      ),
    compacted: c => {
      if (c.ms > SLOW_COMPACTION_MS) log(compactionLine(c))
    },
    keepLastRead: keepRootsRead,
    ...(rootTrace === null ? {} : { trace: rootTrace.trace }),
  })
  closers.defer(async () => {
    roots.close()
    histories.dispose()
    await exchange.flush()
    await exchange.shutdown()
    await rootTrace?.close()
  })
  // Each root's first load is recovered (`recoverRoot`) in a step of its own,
  // once the agent and the runs exist: the roots that load before are held
  // until then.
  const recoverFirstLoad = forward<[RootId]>("recovering a root", "hold")
  roots.onFirstLoad(recoverFirstLoad.call)
  const basics: Basics = {
    session,
    live,
    docs,
    places,
    log,
    newId,
    now,
  }
  /** `basics` for work off the keeper, which takes a lease to reach a root. */
  const leaseBasics: LeaseBasics = { ...basics, leases: roots.leases }
  // Each run's lease on its lane's root: what reads a running lane's root.
  const runDocs = createRunDocs()

  // The host writes the session's records; every module that writes one takes
  // this. A root's are written in a step, through its documents.
  const records = createRecords(session)
  // Cards' texts, and the one writer of the places: each change records its
  // cards' history and traces, and destroys the texts of the cards it removed.
  const cardPort = startCards({ exchange, store, session })
  const { provenance, hooks } = createProvenance({ basics, presence, records })
  const placesWriter = createPlaces({
    basics,
    readingCanvases: () => readReadingCanvases(presence).values(),
    provenance: hooks,
    texts: cardPort,
  })

  // --- pi: the scribe and the model setup --------------------------------
  // A thread's appends go through the scribe, which holds each root's one pi
  // session; the agent, made last, builds its harnesses over them.
  const scribe = createScribe({
    documents: roots.pi,
    replicaId: newId(),
    blobs,
  })
  // Before a root's document goes, what holds it lets go: the scribe closes the
  // agent's harness over it, then its session.
  roots.onReleasing(async root => scribe.release(root))
  closers.defer(() => scribe.close())
  const projectRoot = found?.project.root ?? project?.dir ?? null
  // The project, opened, and the config settled with accepted work's copy:
  // before pi's setup, which reads `model`, `skills` and `prompts` from it.
  // A host without lane work reads its folder's file as every copy.
  progress.begin("project")
  const openedProject = await openProject({
    basics: leaseBasics,
    found,
    adapter: chosen?.adapter ?? null,
    files: project?.tools === true ? project.files : null,
    records,
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
  progress.begin("model")
  const piSetup = await loadPiSetup({
    model:
      model.kind === "configured"
        ? {
            kind: "configured",
            model: settled.model.value,
            subscriptionShaping: settled[SUBSCRIPTION_SETTING].value,
          }
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
  for (const line of subscriptionLines(piSetup.subscription)) log(line)
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

  const keeper: HostKeeper = createKeeper<HostKey, StepDocs>({
    context: roots.context,
    onError: failed(basics, "step"),
    onSlow: slow(basics),
  })
  closers.defer(() => keeper.close("drop"))
  // The roots of the lanes the last host left a run open in, read before
  // `recover` clears what was running, opened in one step. Every other root
  // is loaded by the step that needs it (`planLoads`).
  progress.begin("roots")
  const opening = planLoads(
    readActiveLanes(live),
    lane => readLaneRecords(session).get(lane)?.root,
  )
  await keeper.run(async step => {
    for (const root of opening) await step.root(root)
  })
  const total = new Set([...readThreads(session).values()].map(t => t.root))
    .size
  log(`[host] ${rootsOpenedWords({ opened: opening.length, total })}`)
  // The directory follows the roots opened above as well as those opened
  // later (`onOpened`).
  startDirectory({ basics, keeper, records, roots })
  // Every write the host decides before a gap and makes after it. Its drain
  // is bound once the commands it sends through exist; one asked before is
  // dropped, since its fact stays queued and `recover`'s settle drains every
  // lane with cards queued.
  const drainDue = forward<[ThreadId]>("the drain", "drop")
  const later = createLater({
    basics,
    keeper,
    placesWriter,
    drain: drainDue.call,
  })
  // Each thread's banner: a pasted one under any icon source, a drawn one only
  // under `drawn`.
  const banners = createBanners({
    basics,
    later,
    blobs,
    piSetup,
    draws,
  })
  // Each run's end report, and each ask's digest unless the config turns
  // digests off. What agents talking spend. Its drain and the relays are made
  // after the agent, whose hooks call them: bound late.
  const allowances = createAllowances({
    basics,
    runs: runDocs,
    keeper,
    records,
    placesWriter,
    limit: settled["agents.budget"].value,
    later,
  })
  const digests = createDigests({
    basics,
    later,
    presence,
    piSetup,
    enabled: settled["digests.enabled"].value,
    spent: (ask, tokens) => allowances.spendFor(ask, tokens),
  })
  const digestFailed = (lane: ThreadId) =>
    failed(basics, "summarizing its ask", lane)
  // Each thread's focus, asked once its run's end has settled.
  const focuses = createFocuses({
    basics,
    later,
    piSetup,
    enabled: settled["digests.enabled"].value,
    spent: (ask, tokens) => allowances.spendFor(ask, tokens),
  })
  // Each root's title, unasked as its first lane starts unless the config
  // turns that off, or when a person asks.
  const titles = createTitles({
    basics,
    later,
    enabled: titleConfig.enabled,
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
  // `split_proposed_changes`: a split card queued on the agent's lane, which
  // its run's end pops.
  const askSplit = createSplitCall({ basics, keeper, placesWriter })

  // --- where lanes work -----------------------------------------------------
  // What lane work tells or asks of the machine, before it is watched, is
  // held for it.
  const snapshotSkipped = forward<[]>("the machine", "hold")
  const requestUpkeep = forward<[]>("the machine", "hold")
  const markArchived = forward<[readonly SnapshotId[]]>("the machine", "hold")
  const keepRestored = forward<[readonly ThreadId[]]>("the machine", "hold")
  // Before the machine is watched, and on a host that watches none, every
  // lane is let through at once.
  let waitUntilAllowed: MachineWatch["waitUntilAllowed"] = async () => {}
  const runStarts = createRunStarts()
  const shellCalls = createShellCalls({
    now,
    ended: call => opened.measurements.recordShellCall(call),
  })
  const work = await startLaneWork({
    basics: leaseBasics,
    project: openedProject,
    report: openedProject === null ? null : report,
    places: where,
    sshDir,
    personalSsh: ssh,
    records,
    piSetup,
    ensureNames: names.ensure,
    progress,
    snapshots: opened.snapshots,
    snapshotSkipped: snapshotSkipped.call,
    upkeep: {
      requestUpkeep: requestUpkeep.call,
      markArchivedForDeletion: markArchived.call,
      keepRestored: keepRestored.call,
    },
    machine: {
      waitUntilAllowed: (lane, activity, signal) =>
        waitUntilAllowed(lane, activity, signal),
      noteRunStarted: runStarts.noteRunStarted,
      shellStarted: shellCalls.shellStarted,
    },
  })
  progress.begin("agent")

  // --- the machine lanes run on, watched for its health ---------------------
  // Only where lanes run: a host without tools reads no machine. Its first
  // sample is queued, not awaited.
  const machine =
    found?.kind === "found"
      ? await startMachineWatch({
          reach: found.machine,
          session,
          keeper,
          records,
          settings: storeSettings(settled),
          mode: settled["lanes.manage"].value,
          index: opened.snapshots,
          storeRecords: createStoreRecords({
            basics: leaseBasics,
            reach: found.machine,
          }),
          laneFacts: {
            lanesByImportance: lanes =>
              gatherLaneImportance(
                { basics: leaseBasics, presence, runStarts },
                lanes,
              ),
            programInFlight: shellCalls.programInFlight,
          },
          options: machineOptions,
          measurements: opened.measurements,
          log,
        })
      : null
  // Its `unsampled` is a step on the documents' keeper: it closes first.
  if (machine !== null) {
    closers.defer(() => machine.close())
    waitUntilAllowed = machine.waitUntilAllowed
    snapshotSkipped.bind(() => machine.noteSnapshotSkipped())
    const { upkeep } = machine
    requestUpkeep.bind(() => upkeep.requestUpkeep())
    markArchived.bind(s => void upkeep.markArchivedForDeletion(s))
    keepRestored.bind(l => void upkeep.keepRestored(l))
  }

  // `put_image` acts through the commands, and the agent's tools ask the
  // relays, which start runs over the agent: each bound once what carries it
  // out exists. Only a run calls them, and none runs before.
  const putImage = forward<
    Parameters<ReturnType<typeof createPutImage>>,
    ReturnType<ReturnType<typeof createPutImage>>
  >("the commands", "refuse")
  const askAgent = forward<
    Parameters<Relays["ask"]>,
    ReturnType<Relays["ask"]>
  >("the relays", "refuse")
  const leaveThread = forward<
    Parameters<Relays["leave"]>,
    ReturnType<Relays["leave"]>
  >("the relays", "refuse")

  // --- the agent, at work in threads' lanes ---------------------------------
  const agent = await createAgent({
    documents: roots.pi,
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
              ask: askAgent.call,
              leave: leaveThread.call,
              readBlob: createReadBlob({ runs: runDocs, blobs }),
              putImage: putImage.call,
              readCard: createReadCard({ basics, cards: cardPort, blobs }),
              // A turn recorded, then a live digest of the ask `tip` is in,
              // when due.
              turnDone: async (lane, tip) => {
                await work.hooks.turnDone(lane, tip)
                void digests.step(lane, tip, digestFailed(lane))
              },
            },
          },
    onStream: streamInto(basics, runDocs),
    onUsage: (lane, tokens) => allowances.onUsage(lane, tokens),
    mayRequest: lane => allowances.mayRequest(lane),
  })
  // As `planShutdown`: the queues close before the agent, so the steps the
  // ends of its closed runs queue are refused.
  closers.defer(async () => {
    keeper.close("drop")
    await agent.close()
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
  const baseNews = createBaseNews({ basics, agent, keeper, runs: runDocs })
  work.onBaseChanged(lane => baseNews.baseChanged(lane))
  // A card added to or taken from a canvas, told to its running threads.
  const canvasNews = createCanvasNews({ basics, agent, keeper })
  provenance.onChanged(change => canvasNews.changed(change))
  // Commands are received only from `startControl`, after `recover`.
  const listener = Control.listen(exchange)
  const { readPinned } = createPinned({
    basics,
    runs: runDocs,
    cards: cardPort,
  })
  const { readCanvasContext } = createCanvasContext({
    basics,
    runs: runDocs,
    cards: cardPort,
  })
  const runs = createRuns({
    basics,
    runDocs,
    agent,
    work,
    readPinned,
    readCanvasContext,
    baseNews,
    pending: writePendingRunEndReport({ runs: runDocs, records }),
    started: lane =>
      void keeper
        .track(moveCanvasToActive({ basics, places: placesWriter }, lane))
        .catch(failed(basics, "moving a canvas to Active", lane)),
  })
  const relays = createRelays({
    basics,
    keeper,
    start: runs.start,
    runnable: lane => work.runnable(lane),
    allowances,
    drain: lane => queueDrain(lane),
    placesWriter,
  })
  askAgent.bind(relays.ask)
  leaveThread.bind(relays.leave)
  // Where a host's message goes in a thread: an answer, a lane's ssh news.
  const deliver = createDelivery({
    basics,
    agent,
    scribe,
    start: runs.start,
    runnable: lane => work.runnable(lane),
  })
  const answers = createAnswers({
    basics,
    later,
    keeper,
    runs: runDocs,
    relays,
    agent,
    deliver,
    allowances,
    piSetup,
  })
  // A lane is told each change to its use of its owner's ssh; an approval
  // wakes it.
  const sshNews = createSshNews({ basics, later, deliver })
  work.onSshNews((lane, news) => sshNews.told(lane, news))
  const commands = createCommands({
    basics,
    agent,
    scribe,
    records,
    piSetup,
    work,
    blobs,
    quoteBytes: settled["shares.quoteBytes"].value,
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
    runs: runDocs,
    placesWriter,
    provenance,
    keeper,
    later,
    relays,
  })
  putImage.bind(
    createPutImage({
      basics,
      perform: (writer, intent) => commands.perform(writer, intent),
    }),
  )
  // The drain's waits for its top card: its text, someone's typing in it to
  // stop, or a blank card to be written in.
  const wait = createWaits({ places, drain: lane => queueDrain(lane) })
  const behind = (card: QueuedText) =>
    wait(card, signal => cardPort.whenHolds(card.id, card.place.seen, signal))
  const typing = (card: QueuedText) =>
    wait(card, signal => untilNotTyped(presence, card.id, signal))
  const blank = (card: QueuedText) =>
    wait(card, signal => cardPort.whenWritten(card.id, signal))
  // A lane's drain, in the step whose documents are `step`: the lane's root
  // loaded first, which pi's appends and runs there need.
  const drain = async (step: StepDocs, lane: ThreadId) => {
    await step.lane(lane)
    return drainQueue(
      {
        basics: inStep(basics, step),
        records: step.records,
        texts: cardPort,
        blobs,
        agent,
        work,
        start: (l, s) => runs.start(step, l, s),
        send: async popped => {
          const root = readThreads(session).get(popped.card.place.thread)?.root
          return root === undefined
            ? { kind: "failed", message: "its thread has no record" }
            : commands.sendPoppedQueuedCard(
                step,
                popped.card.place.by,
                newId(),
                sendOfPoppedQueuedCard(popped, root),
              )
        },
        presence,
        behind,
        typing,
        blank,
        placesWriter,
        relay: (to, relay) => relays.relayCard(step, to, relay),
        scribe,
      },
      lane,
    )
  }
  // What no one will use again, swept at the start and after each settle
  // (`planSweeps`).
  const sweeps: SweepDeps = {
    basics: leaseBasics,
    blobs,
    grace: BLOB_GRACE_MS,
    texts: cardPort.texts,
    store,
    histories,
    records,
    placesWriter,
    work,
    provenance,
  }
  // The upkeep (`roots.ts`): what runs changed compacted, the roots nothing
  // holds let go; after a settle, the sweeps. One body for every caller: a
  // `later` keeps the body of the call that queued it.
  const upkeep = (): Promise<void> =>
    queueUpkeepOn(keeper, async step => {
      const { settled } = await roots.upkeep(step)
      if (settled) await sweepUnused(sweeps, "upkeep")
    })
  upkeepDue.bind(() => void upkeep())
  const settle = createSettle({
    basics,
    keeper,
    drain,
    rootOf: docs.rootOfLane,
    settled: changed => {
      roots.settled(changed)
      return upkeep()
    },
  })
  // A run's end: the lane drains and the upkeep follows, compacting what is
  // due. A thread whose banner failed tries again. The
  // final digest is for the run's prompt: the drain queued before it may
  // append to the lane or start its next run. The thread's focus is asked
  // once that has settled, from what it wrote.
  runs.onEnded((lane, prompt) => {
    void answers.ended(lane, prompt).catch(failed(basics, "an answer"))
    void settle([lane])
    banners.due(lane).catch(failed(basics, "banner"))
    const root = docs.rootOfLane(lane)
    if (prompt !== null && root !== null)
      void digests
        .ended(root, lane, prompt, digestFailed(lane))
        .then(s => focuses.ended(s, failed(basics, "naming its focus", lane)))
  })
  // A card queued on a lane that is not running is popped at once: the move
  // that queued it asks for a drain. A lane's drain is the keeper's `once`:
  // queued once until its step starts, and a move while it runs queues one
  // more, which finds what that one missed. It keeps its place among the
  // commands, so a late message still goes after the queued cards.
  const queueDrain = (lane: ThreadId) => {
    if (readRunning(live, lane)) return
    void keeper.once(`drain:${lane}`, step => drain(step, lane))
  }
  drainDue.bind(queueDrain)
  /**
   * Resolves when no queued step remains (a compaction after a run among
   * them), no lane's queue has work, no disk upkeep is queued or running,
   * and every write has reached the store.
   */
  async function quiet(): Promise<void> {
    await keeper.idle()
    // Lanes' own queues: snapshots, fetches and stops after a run.
    await work.quiet()
    // The disk upkeep an archive or a run's end asked for.
    await machine?.idle()
    await exchange.flush()
  }

  await recover({
    basics,
    roots: opening,
    agent,
    records,
    piSetup,
    work,
    keeper,
    start: runs.start,
    settle,
    cards: cardPort,
    placesWriter,
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
  // Every other root is recovered as it first loads, in a step of its own:
  // `recover` did those it opened.
  recoverFirstLoad.bind(root => {
    if (opening.includes(root)) return
    void keeper
      .run(step =>
        recoverRoot({ basics, agent, work, start: runs.start }, step, root),
      )
      .catch(failed(basics, "recovering a root"))
  })
  await keeper.run(() => sweepUnused(sweeps, "start"))
  const seats = startSeats({ exchange, basics, keeper, records, histories })
  const control = startControl({
    exchange,
    listener,
    handle: commands.handle,
  })

  progress.begin("listening")
  const server = await startHttp({
    port,
    bind,
    key,
    tools: toolsIn !== null,
    serverTransport,
    blobs,
    destination: work.destination,
    page,
    measurements: {
      store: opened.measurements,
      heading: {
        backend: found?.kind === "found" ? found.machine.target : null,
        source: found?.kind === "found" ? found.machine.memorySource : null,
      },
    },
    log,
  })

  // From here, not the start: the start's checklist times its own steps.
  const stalls = watchStalls()
  stalls.listen(stall => log(stallWords(stall)))
  if (machine !== null) stalls.listen(stall => machine.hearStall(stall))

  const stop = async (): Promise<void> => {
    const carry = async (step: ShutdownStep): Promise<void> => {
      switch (step) {
        case "intake":
          seats.stop()
          control.stop()
          stalls.stop()
          // Before the documents' keeper closes: its `unsampled` is a step there.
          return machine?.close()
        case "close":
          // The documents' upkeep compacts: it finishes before the store closes.
          keeper.close("finish")
          work.destination?.close()
          return
        case "quiet":
          // Queued steps, a compaction among them, finish their writes.
          return quiet()
        case "agent":
          // Every harness closes. A run in flight ends interrupted, and its
          // lane stays marked running for the next start.
          return agent.close()
        case "scribe":
          // Every session, the session document's too: a later write is refused.
          return scribe.close()
        case "work":
          // A container runs only while its lane runs.
          await work.close()
          return rm(sshDir, { recursive: true, force: true })
        case "exchange":
          roots.close()
          histories.dispose()
          await exchange.flush()
          await exchange.shutdown()
          return rootTrace?.close()
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
    steps: keeper,
    rootsLoaded: () => roots.loaded(),
    rootsRead: () => roots.lastRead(),
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
