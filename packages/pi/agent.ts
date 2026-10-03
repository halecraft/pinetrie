// pi/agent — the pi stack over the session document, and the facade the host
// sees. Only this package may import pi (ADR-0003, enforced by module
// resolution): everything pi-shaped is converted to Pineta's shapes here or
// in the modules `createAgent` wires, so the host never sees a pi type.

import path from "node:path"
import {
  type AgentMessage,
  BACKGROUND_CONTEXT,
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
  entryId,
  isLaneName,
  type LaneName,
  type Position,
  type StreamEvent,
  type ValueWrite,
} from "@pineta/core"
import {
  type BannerAnswer,
  type BannerAsk,
  type BannerConfig,
  type ChatMessage,
  chatImageShas,
  labelCommands,
  withChatImages,
} from "@pineta/marginalia"
import { readLaneTip, type SessionDocHandle } from "@pineta/schema"
import { type Banners, banners } from "./banner.ts"
import { type CommandFiles, commandFiles } from "./commands.ts"
import {
  complete,
  DEFAULT_AGENT_DIR,
  type ModelChoice,
  setUpModel,
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
import { KynetaStorage } from "./storage.ts"
import { STREAM_SOURCES, streamEventOf } from "./stream.ts"
import {
  type AppendOutcome,
  type ThreadLanes,
  threadLanes,
  toPi,
} from "./thread-lanes.ts"
import { activeToolNames, assembleTools } from "./tools.ts"

const CTX = BACKGROUND_CONTEXT

const NO_BLOBS: Pick<BlobStore, "get"> = { get: () => undefined }

/** A host write as pi's: set or delete the value at its address. */
const toPiWrite = (w: ValueWrite) =>
  w.kind === "set"
    ? setValue(value(w.namespace, w.key), w.value as never)
    : deleteValue(value(w.namespace, w.key))

/** Coordination-free id, used for peer ids. Same generator pi uses for entries. */
export const newId = (): string => uuidv7()

/**
 * Pineta's own skills, loaded after yours and the repo's: `resolve-conflicts`,
 * `commit-message`, `offer-stack` and `column-banner`.
 */
const SKILLS_DIR = path.join(import.meta.dirname, "skills")

export interface CreateAgentOptions {
  readonly doc: SessionDocHandle
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

/**
 * The narrow facade the host sees. Every member is a string, our own shape, or a
 * promise of one, so "no pi type crosses this boundary" is a checked property
 * of the signature. There is no way to move a lane, and none to READ a tip:
 * readers use the document, so observing a lane can never create one.
 */
export interface Agent extends ThreadLanes, CommandFiles, Banners {
  readonly modelLabel: string
  /**
   * Append at exactly `parent`, with no lane: a conversation thread (S21 Q1).
   * The host's serial executor guarantees nothing was written there since it
   * planned, so no re-read is needed here.
   */
  appendToTree(message: ChatMessage, parent: Position): Promise<AppendOutcome>
  /**
   * Write the host's records (ADR-0062), in one commit. A value can be
   * written while a lane runs: it does not go through the lane (S70). Throws,
   * writing nothing, for a namespace that is not the host's.
   */
  writeValues(writes: readonly ValueWrite[]): Promise<void>
  /** pi's agent directory: settings, packages, and `auth.json`. Never mounted into a lane. */
  agentDir(): string
  stats(): Promise<{ messageCount: number }>
  /**
   * One request outside every thread, with no tools and no session
   * (`complete` in `config.ts`). Null when it fails.
   */
  complete(request: {
    readonly system: string
    readonly user: string
  }): Promise<string | null>
  close(): Promise<void>
}

/**
 * Build the pi stack over a caller-supplied Kyneta document, and return a
 * narrow facade.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const { doc, replicaId, tools } = options

  const storage = new KynetaStorage({
    doc,
    peerId: replicaId,
    ...(options.blobs === undefined ? {} : { blobs: options.blobs }),
  })
  const session = new StorageBackedSession(
    { id: `pineta-${replicaId}`, createdAt: Date.now(), storageVersion: 1 },
    storage,
    {},
  )

  const project = tools?.project ?? process.cwd()
  const setup = await setUpModel(options.model, {
    cwd: project,
    skillsDir: SKILLS_DIR,
    ...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
  })
  const resolved = setup.model
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
  const activeTools = (guidance: boolean): string[] =>
    activeToolNames({
      files: assembled.files,
      banners: bannerAsks !== undefined,
      guidance,
    })
  // A call with no lane named (none should run tools) works in the project.
  const accessFor = (lane: LaneName | undefined): LaneAccess =>
    tools === null || lane === undefined
      ? { kind: "direct", dir: project, ready: Promise.resolve() }
      : tools.access(lane)

  const { harness } = await createAgentHarness(
    {
      session,
      models: setup.models,
      model: resolved,
      tools: [...assembled.registered] as never[],
      activeToolNames: activeTools(false),
      toolContext: (context: typeof CTX): ToolContext =>
        toolContextOf(accessFor(laneOf(context))),
      systemPrompt: systemPromptFor(setup, assembled.files),
      toProviderMessages: messages =>
        providerMessages(messages, options.blobs ?? NO_BLOBS),
      // Pineta's queued cards mean pi's own queue is never used; should it be, it
      // answers one message at a time rather than batching them (S20).
      followUpMode: "one-at-a-time",
    },
    CTX,
  )

  /** The lane's last turn, recorded at its tip as the document has it. */
  async function recordTurn(lane: LaneName): Promise<void> {
    if (tools === null) return
    const tip = readLaneTip(doc, lane)
    if (tip !== null) await tools.hooks.turnDone(lane, tip)
  }

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

  const offs = STREAM_SOURCES.map(type =>
    harness.events.on(type, event => {
      const stream = streamEventOf(event)
      if (stream !== null) options.onStream?.(stream)
    }),
  )

  const lanes = threadLanes({
    harness,
    doc,
    recordTurn,
    activeTools: tools === null ? null : activeTools,
  })

  return {
    ...lanes,
    ...commandFiles(
      labelCommands(setup.commands, options.commandRenames ?? {}),
    ),
    ...banners(setup.images, options.banners?.config),
    modelLabel: `${resolved.provider}/${resolved.id}`,

    complete: request => complete(setup, request),

    async appendToTree(message, parent) {
      const id = session.idGenerator.next()
      await session.mutate(
        m =>
          m.commit(
            [
              insertEntry({
                id,
                parentId: toPi(parent),
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
      await session.mutate(m => m.commit(writes.map(toPiWrite), CTX), CTX)
    },

    agentDir() {
      return options.agentDir ?? DEFAULT_AGENT_DIR
    },

    async stats() {
      return session.getStats(CTX)
    },

    async close() {
      for (const off of offs) off()
      await harness.close(CTX)
    },
  }
}
