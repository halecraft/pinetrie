// pi/agent — the pi stack over the session's documents, a pi session and a
// harness per document (ADR-0063), and the facade the host sees. Only this
// package may import pi (ADR-0003, enforced by module resolution):
// everything pi-shaped is converted to Pineta's shapes here or in the
// modules `createAgent` wires, so the host never sees a pi type.

import path from "node:path"
import {
  type AgentMessage,
  BACKGROUND_CONTEXT,
  compact,
  convertToLlm,
  deleteValue,
  StorageBackedSession,
  setValue,
  uuidv7,
  value,
} from "@earendil-works/pi-agent-core"
import { insertEntry } from "@earendil-works/pi-agent-core/harness/session"
import {
  type BlobStore,
  ERR,
  entryId,
  isLaneName,
  type LaneName,
  type RootId,
  type Spot,
  type StreamEvent,
  type Target,
  type ValueWrite,
} from "@pineta/core"
import {
  type BannerAnswer,
  type BannerAsk,
  type BannerConfig,
  type ChatMessage,
  chatImageShas,
  labelCommands,
  type ModelRef,
  withChatImages,
} from "@pineta/marginalia"
import {
  asRootDoc,
  type RootDocHandle,
  readLaneTip,
  type SessionDocHandle,
  type StorageDocHandle,
} from "@pineta/schema"
import { type Banners, banners } from "./banner.ts"
import { type CommandFiles, commandFiles } from "./commands.ts"
import {
  complete,
  DEFAULT_AGENT_DIR,
  type ModelChoice,
  setUpModel,
  titleModelOf,
} from "./config.ts"
import { createAgentHarness } from "./deep.ts"
import {
  type LaneAccess,
  type LaneHooks,
  laneOf,
  systemPromptFor,
  type ToolContext,
  toolContextOf,
} from "./lanes.ts"
import { carryPinned, withCarried } from "./pinned.ts"
import { prefixChange, prefixOf } from "./prefix.ts"
import { KynetaStorage } from "./storage.ts"
import { STREAM_SOURCES, streamEventOf } from "./stream.ts"
import {
  type AppendOutcome,
  type CreateOutcome,
  type LaneRefusal,
  type ThreadLaneHandle,
  type ThreadLanes,
  threadLanes,
  toPi,
} from "./thread-lanes.ts"
import { activeToolNames, assembleTools } from "./tools.ts"

const CTX = BACKGROUND_CONTEXT

const NO_BLOBS: Pick<BlobStore, "get"> = { get: () => undefined }

/** A lane no root holds: every write to it is refused. */
const UNKNOWN_LANE: LaneRefusal = { kind: "refused", code: ERR.UNKNOWN_TARGET }

/**
 * Writes grouped by the document they go to, in the order each target first
 * appears. Pure.
 */
export function byTarget(
  writes: readonly ValueWrite[],
): readonly (readonly [Target, readonly ValueWrite[]])[] {
  const groups = new Map<string, [Target, ValueWrite[]]>()
  for (const w of writes) {
    const key = w.target.kind === "session" ? "" : w.target.root
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [w.target, [w]])
    else group[1].push(w)
  }
  return [...groups.values()]
}

/** A host write as pi's: set or delete the value at its address. */
const toPiWrite = (w: ValueWrite) =>
  w.kind === "set"
    ? setValue(value(w.namespace, w.key), w.value as never)
    : deleteValue(value(w.namespace, w.key))

/** Coordination-free id, used for peer ids. Same generator pi uses for entries. */
export const newId = (): string => uuidv7()

/**
 * Pineta's own skills, loaded after yours and the repo's: `resolve-conflicts`,
 * `commit-message`, `offer-stack`, `column-banner`, `ask-digest` and
 * `tab-title`.
 */
const SKILLS_DIR = path.join(import.meta.dirname, "skills")

/**
 * The documents pi's sessions are over (ADR-0063), as the host opens them:
 * the session's, for the host's session-wide records, and each root's, a pi
 * session of its own.
 */
export interface AgentDocuments {
  readonly session: SessionDocHandle
  /** A root's document, held and loaded: opened if it is not. */
  root(root: RootId): Promise<RootDocHandle>
  /** The root a lane works in, from its record; null for a lane no root holds. */
  rootOfLane(lane: LaneName): RootId | null
}

export interface CreateAgentOptions {
  readonly documents: AgentDocuments
  /**
   * This PROCESS's replica id, used by storage for write tokens. It is not a
   * writer's identity: writers are people, identified by the transport.
   */
  readonly replicaId: string
  readonly model: ModelChoice
  /**
   * The agent's tools, and where each lane uses them; null for no tools.
   * Tools run as the host's user, so they are on only when asked for.
   */
  readonly tools: {
    /** The project: where pi's settings, `AGENTS.md` and skills load from. */
    readonly project: string
    /** How a lane's tools reach its files: its container, or a directory (ADR-0034). */
    readonly access: (lane: LaneName) => LaneAccess
    readonly hooks: LaneHooks
  } | null
  /** What a running turn writes, in Pineta's own words, per lane. */
  readonly onStream?: (event: StreamEvent) => void
  /**
   * A lane's request starts otherwise than its last one did: its earlier
   * thinking is dropped, and its prompt cached again (`prefix.ts`, S85).
   */
  readonly onPrefixChange?: (lane: LaneName) => void
  /**
   * pi's agent directory. With a scripted or named model, skills and prompts
   * load only when this is given: a suite's fixture, never the person's own.
   */
  readonly agentDir?: string
  /** The user config's `commands.names`: pi's `source` → a label (ADR-0036). */
  readonly commandRenames?: Readonly<Record<string, string>>
  /**
   * Where images are kept. A chat's are read from it for every request
   * (ADR-0042); `read` puts each image it reads there, and the session stores
   * a reference to it (ADR-0051). Without it, a chat's images reach the model
   * as "no longer stored", and a tool's are stored inline.
   */
  readonly blobs?: Pick<BlobStore, "get" | "put" | "ref">
  /**
   * Column banners, when the user config enables them: the image model, and
   * where `set_banner` sends its asks. Without it there is no tool, and
   * `drawBanner` draws nothing.
   */
  readonly banners?: {
    readonly config: BannerConfig
    request(lane: LaneName, ask: BannerAsk): Promise<BannerAnswer>
  }
  /** The user config's title model (ADR-0074); null or absent for the run's. */
  readonly titleModel?: ModelRef | null
}

/**
 * What the model reads: pi's own conversion, after each chat's images are
 * attached. Gathers the blobs, then `withChatImages` places them. Read from
 * the store for every request, uncached (S53 item 7).
 */
function providerMessages(
  messages: AgentMessage[],
  blobs: Pick<BlobStore, "get">,
): ReturnType<typeof convertToLlm> {
  const found = new Map(
    chatImageShas(messages).flatMap(sha => {
      const blob = blobs.get(sha)
      return blob === undefined
        ? []
        : [
            [
              sha,
              {
                data: Buffer.from(blob.bytes).toString("base64"),
                mimeType: blob.mimeType,
              },
            ] as const,
          ]
    }),
  )
  return convertToLlm(withChatImages(messages, found))
}

/** The pi stack over one document: its storage, session, harness and lanes. */
interface OverDoc {
  readonly session: StorageBackedSession
  readonly harness: Harness
  readonly lanes: ThreadLanes
  readonly close: () => Promise<void>
}

type Harness = Awaited<ReturnType<typeof createAgentHarness>>["harness"]

/**
 * The narrow facade the host sees. Every member is a string, our own shape, or a
 * promise of one, so "no pi type crosses this boundary" is a checked property
 * of the signature. There is no way to move a lane, and none to READ a tip:
 * readers use the document, so observing a lane can never create one.
 */
export interface Agent extends CommandFiles, Banners {
  readonly modelLabel: string
  /**
   * Create a thread's lane at `spot`, in its root, named `lane` (the host
   * decides the id, ADR-0057). Refused `lane_taken` for an id pi holds.
   */
  createThreadLane(spot: Spot, lane: LaneName): Promise<CreateOutcome>
  /** A thread's lane, in the root its record names. */
  lane(name: LaneName): ThreadLaneHandle
  /** Lanes pi holds an operation open on, in `roots`: a crash interrupted them. */
  interrupted(roots: readonly RootId[]): Promise<readonly LaneName[]>
  /**
   * Append at exactly `spot`, with no lane: a conversation thread (S21 Q1).
   * The host's serial executor guarantees nothing was written there since it
   * planned, so no re-read is needed here.
   */
  appendToTree(message: ChatMessage, spot: Spot): Promise<AppendOutcome>
  /**
   * Write the host's records (ADR-0062): each document's writes in one
   * commit, by their target (ADR-0063). A value can be written while a lane
   * runs: it does not go through the lane (S70). Throws, writing nothing, for
   * a namespace that is not the host's.
   */
  writeValues(writes: readonly ValueWrite[]): Promise<void>
  /**
   * Close and forget `root`'s harness, before the host lets its document
   * go (ADR-0063). The next call that needs the root opens it again.
   */
  release(root: RootId): Promise<void>
  /** pi's agent directory: settings, packages, and `auth.json`. Never mounted into a lane. */
  agentDir(): string
  /**
   * One request outside every thread, with no tools and no session
   * (`complete` in `config.ts`), on the title model for `purpose` `title`,
   * else the describe model. Null when it fails.
   */
  complete(request: {
    readonly system: string
    readonly user: string
    readonly purpose?: "title"
  }): Promise<string | null>
  /** False when the user config names a title model pi does not have: titles use the run's. */
  readonly titleModelFound: boolean
  close(): Promise<void>
}

/**
 * Build the pi stack over the session's documents, and return a narrow
 * facade. One model setup, tool list and system prompt serve every
 * document's harness; a document's own is made the first time it is asked
 * for, and lives as long as the agent.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const { documents, replicaId, tools } = options

  const project = tools?.project ?? process.cwd()
  const setup = await setUpModel(options.model, {
    cwd: project,
    skillsDir: SKILLS_DIR,
    ...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
  })
  const resolved = setup.model
  const titles = titleModelOf(
    setup,
    options.titleModel ?? null,
    options.model.kind === "scripted",
  )
  // `set_banner` asks only while the agent has tools and banners are on.
  const bannerAsks = tools === null ? undefined : options.banners?.request
  const assembled =
    tools === null
      ? { registered: [], files: [] }
      : assembleTools({
          hooks: tools.hooks,
          blobs: options.blobs,
          bannerAsks,
        })
  // An agent with no tools registers none, so its lanes may call none.
  const activeTools =
    tools === null
      ? []
      : activeToolNames({
          files: assembled.files,
          banners: bannerAsks !== undefined,
        })
  // A call with no lane named (none should run tools) works in the project.
  const accessFor = (lane: LaneName | undefined): LaneAccess =>
    tools === null || lane === undefined
      ? { kind: "direct", dir: project, ready: Promise.resolve() }
      : tools.access(lane)
  const systemPrompt = systemPromptFor(setup, assembled.files)
  // Each lane's last request's prefix, in memory: a restart starts fresh.
  const prefixes = new Map<string, string>()

  /** The lane's last turn, recorded at its tip as its root's document has it. */
  async function recordTurn(lane: LaneName): Promise<void> {
    if (tools === null) return
    const root = documents.rootOfLane(lane)
    if (root === null) return
    const tip = readLaneTip(await documents.root(root), lane)
    if (tip !== null) await tools.hooks.turnDone(lane, tip)
  }

  /** The pi stack over `doc`: a session, a harness and its lanes. */
  async function overDoc(doc: StorageDocHandle, id: string): Promise<OverDoc> {
    const storage = new KynetaStorage({
      doc,
      peerId: replicaId,
      ...(options.blobs === undefined ? {} : { blobs: options.blobs }),
    })
    const session = new StorageBackedSession(
      {
        id: `pineta-${replicaId}-${id}`,
        createdAt: Date.now(),
        storageVersion: 1,
      },
      storage,
      {},
    )
    const { harness } = await createAgentHarness(
      {
        session,
        models: setup.models,
        model: resolved,
        tools: [...assembled.registered] as never[],
        activeToolNames: activeTools,
        toolContext: (context: typeof CTX): ToolContext =>
          toolContextOf(accessFor(laneOf(context))),
        systemPrompt,
        toProviderMessages: messages =>
          providerMessages(messages, options.blobs ?? NO_BLOBS),
        // Pineta's queued cards mean pi's own queue is never used; should it
        // be, it answers one message at a time rather than batching (S20).
        followUpMode: "one-at-a-time",
      },
      CTX,
    )
    if (tools !== null) {
      // A turn's files, recorded before the next request: every tool of the
      // turn has finished, and pi awaits this, so no write races the commit.
      // `recordTurn` reads the tip from the document: asking the lane here,
      // inside its own drive, could wait on itself.
      harness.hooks.on("before_request", async event => {
        const lane = event.lane
        if (event.step !== "assistant" || !isLaneName(lane)) return undefined
        await recordTurn(lane)
        return undefined
      })
    }
    // A compaction keeps the cards the model last read in view (S92): the
    // newest cards entry summarised is carried into pi's retained tail.
    // Nothing is thrown: if `compact` fails, pi compacts on its own, and
    // only the cards are lost, until the next run restates them.
    harness.hooks.on("before_compaction", async event => {
      const cards = carryPinned(event.preparation)
      if (cards === null) return undefined
      const done = await compact(
        event.preparation,
        setup.models,
        resolved,
        event.customInstructions,
        undefined,
        undefined,
        undefined,
        CTX,
      )
      return done.ok
        ? { compaction: withCarried(done.value, cards) }
        : undefined
    })
    harness.hooks.on("before_payload", async event => {
      const next = prefixOf(event.payload)
      if (
        prefixChange(prefixes.get(event.lane), next) &&
        isLaneName(event.lane)
      )
        options.onPrefixChange?.(event.lane)
      prefixes.set(event.lane, next)
      return undefined
    })
    const offs = STREAM_SOURCES.map(type =>
      harness.events.on(type, event => {
        const stream = streamEventOf(event)
        if (stream !== null) options.onStream?.(stream)
      }),
    )
    const lanes = threadLanes({
      harness,
      doc: asRootDoc(doc),
      recordTurn,
      activeTools: tools === null ? null : activeTools,
    })
    return {
      session,
      harness,
      lanes,
      async close() {
        for (const off of offs) off()
        await harness.close(CTX)
      },
    }
  }

  // Each document's stack, made once: the promise is held, so two callers
  // asking at once share one harness.
  const stacks = new Map<string, Promise<OverDoc>>()
  const stackOf = (key: string, open: () => Promise<StorageDocHandle>) => {
    const held = stacks.get(key)
    if (held !== undefined) return held
    const made = open().then(doc => overDoc(doc, key))
    stacks.set(key, made)
    return made
  }
  const ofSession = () => stackOf("session", async () => documents.session)
  const ofRoot = (root: RootId) => stackOf(root, () => documents.root(root))
  const ofTarget = (target: Target) =>
    target.kind === "session" ? ofSession() : ofRoot(target.root)

  /** A lane's stack, in the root its record names; undefined for none. */
  async function ofLane(name: LaneName): Promise<OverDoc | undefined> {
    const root = documents.rootOfLane(name)
    return root === null ? undefined : ofRoot(root)
  }

  /** A handle whose every call finds the lane's root when it is made. */
  function laneHandle(name: LaneName): ThreadLaneHandle {
    const on = async <T>(
      f: (h: ThreadLaneHandle) => Promise<T>,
      none: T,
    ): Promise<T> => {
      const stack = await ofLane(name)
      return stack === undefined ? none : f(stack.lanes.lane(name))
    }
    return {
      name,
      append: message => on(h => h.append(message), UNKNOWN_LANE),
      run: (message, pinned) => on(h => h.run(message, pinned), UNKNOWN_LANE),
      resume: () => on(h => h.resume(), UNKNOWN_LANE),
      abort: () => on(h => h.abort(), undefined),
    }
  }

  return {
    lane: laneHandle,

    async createThreadLane(spot, lane) {
      return (await ofRoot(spot.root)).lanes.createThreadLane(spot.at, lane)
    },

    async interrupted(roots) {
      const out: LaneName[] = []
      for (const root of roots)
        out.push(...(await (await ofRoot(root)).lanes.interrupted()))
      return out
    },

    ...commandFiles(
      labelCommands(setup.commands, options.commandRenames ?? {}),
    ),
    ...banners(setup.images, options.banners?.config),
    modelLabel: `${resolved.provider}/${resolved.id}`,

    complete: ({ purpose, ...request }) =>
      complete(
        setup,
        purpose === "title" ? titles.model : setup.describeModel,
        request,
      ),
    titleModelFound: titles.found,

    async appendToTree(message, spot) {
      const { session } = await ofRoot(spot.root)
      const id = session.idGenerator.next()
      await session.mutate(
        m =>
          m.commit(
            [
              insertEntry({
                id,
                parentId: toPi(spot.at),
                type: "message",
                message,
              }),
            ],
            CTX,
          ),
        CTX,
      )
      return { kind: "appended", id: entryId(id) }
    },

    async writeValues(writes) {
      if (writes.length === 0) return
      const foreign = writes.find(w => !w.namespace.startsWith("pineta."))
      if (foreign !== undefined)
        throw new Error(
          `writeValues: ${foreign.namespace} is not the host's to write`,
        )
      for (const [target, group] of byTarget(writes)) {
        const { session } = await ofTarget(target)
        await session.mutate(m => m.commit(group.map(toPiWrite), CTX), CTX)
      }
    },

    async release(root) {
      const stack = stacks.get(root)
      if (stack === undefined) return
      stacks.delete(root)
      await (await stack).close()
    },

    agentDir() {
      return options.agentDir ?? DEFAULT_AGENT_DIR
    },

    async close() {
      for (const stack of stacks.values()) await (await stack).close()
    },
  }
}
