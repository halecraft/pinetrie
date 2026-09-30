// pi/agent — harness lifecycle at the pi boundary.
//
// The directory is named for what it wraps, so the architecture rule reads as a
// tautology: only `pi/` may import pi. The harness and model runtime sit here
// beside the `Storage` implementation because they are the same concern —
// isolating pi — not because they are storage.
//
// Everything pi-shaped is converted to OUR shapes here. host/ never sees a pi
// type, never imports pi, and would keep compiling if pi's surface moved.

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  type AgentMessage,
  BACKGROUND_CONTEXT,
  convertToLlm,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type ExecutionEnv,
  StorageBackedSession,
  uuidv7,
  value,
} from "@earendil-works/pi-agent-core"
import { insertEntry } from "@earendil-works/pi-agent-core/harness/session"
import {
  type ArchiveRecord,
  type BlobStore,
  type CommandRef,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  hostPathInLane,
  type LaneName,
  laneNameForThread,
  type MarkRecord,
  type NoteRecord,
  type Position,
  type SeatRecord,
  type StoredImage,
  type StreamEvent,
  type WriterId,
} from "@pineta/core"
import {
  ARCHIVE_NAMESPACE,
  type BannerAnswer,
  type BannerAsk,
  type BannerConfig,
  type ChatMessage,
  type CommandSource,
  chatImageShas,
  encodeArchive,
  encodeHeld,
  encodeMark,
  encodeNote,
  encodeSeat,
  encodeWorkRecord,
  expandSkill,
  type Held,
  type LandMessage,
  labelCommands,
  MARK_NAMESPACE,
  NOTE_NAMESPACE,
  OFFER_NAMESPACE,
  OUTBOX_NAMESPACE,
  PARTICIPANT_NAMESPACE,
  resolveCommand,
  SEAT_NAMESPACE,
  type StackMessage,
  type UpdateMessage,
  type WorkRecord,
  withChatImages,
} from "@pineta/marginalia"
import {
  hasLaneRecord,
  readLaneNames,
  readLaneTip,
  type SessionDocHandle,
} from "@pineta/schema"
import { BANNER_TOOL, bannerTool } from "./banner.ts"
import { DEFAULT_AGENT_DIR, type ModelChoice, setUpModel } from "./config.ts"
import {
  buildSystemPrompt,
  createAgentHarness,
  parseCommandArgs,
  stripFrontmatter,
  substituteArgs,
} from "./deep.ts"
import { prepareImage, readImageProcessor } from "./images.ts"
import { laneEnv } from "./lane-env.ts"
import {
  directEnv,
  GUIDANCE_TOOL,
  guidanceTool,
  type LaneAccess,
  type LaneFacts,
  type LaneHooks,
  laneContext,
  laneGuidelines,
  laneOf,
} from "./lanes.ts"
import { KynetaStorage } from "./storage.ts"

export { KynetaStorage }

const NO_BLOBS: Pick<BlobStore, "get"> = { get: () => undefined }

/**
 * What pi builds a request's tools and system prompt from. `lane` is null for
 * a lane that works directly: it gets no block, and every skill at its own path.
 */
interface ToolContext {
  readonly env: ExecutionEnv
  readonly dir: string
  readonly lane: {
    readonly facts: LaneFacts
    readonly hostPaths: readonly string[]
  } | null
}

/** pi's ambient context. Opaque to host/. */
export const CTX = BACKGROUND_CONTEXT

/** Coordination-free id, used for peer ids. Same generator pi uses for entries. */
export const newId = (): string => uuidv7()

/**
 * Pineta's own skills, loaded after yours and the repo's: `resolve-conflicts`,
 * `commit-message`, `offer-stack` and `column-banner`.
 */
const SKILLS_DIR = path.join(import.meta.dirname, "skills")

/**
 * The skills a lane of its own can read, at the paths it reads them: those
 * under a host path it has mounted, at `/mnt/host` and their path (ADR-0036).
 */
function skillsInLane<S extends { filePath: string; baseDir: string }>(
  skills: readonly S[] | undefined,
  hostPaths: readonly string[],
): S[] {
  const mounted = (p: string) =>
    hostPaths.some(r => p === r || p.startsWith(`${r}/`))
  return (skills ?? [])
    .filter(s => mounted(s.filePath))
    .map(s => ({
      ...s,
      filePath: hostPathInLane(s.filePath),
      baseDir: hostPathInLane(s.baseDir),
    }))
}

/** A skill file's instructions: its text after the frontmatter block. */
export function withoutFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return (match === null ? text : text.slice(match[0].length)).trim()
}

export type { LaneAccess, LaneHooks }

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
 * A banner's image, fitted as an upload is (`prepareImage`), or why there is
 * none.
 */
export type Drawn =
  | { readonly kind: "drawn"; readonly image: StoredImage }
  | { readonly kind: "failed"; readonly reason: string }

/** A model's image, as base64, fitted as an upload is, or why it is not one. */
export async function drawnOf(data: string): Promise<Drawn> {
  const prepared = await prepareImage(
    new Uint8Array(Buffer.from(data, "base64")),
  )
  return prepared.ok
    ? { kind: "drawn", image: prepared.image }
    : { kind: "failed", reason: prepared.reason }
}

/** How long one image request may take: S60 measured about 9 s. */
const DRAW_TIMEOUT_MS = 120_000

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

/** The result of a run: pi may refuse to admit it. */
export type WriteOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * pi's refusal tag -> our `ErrCode`, as a value.
 *
 * Pure, so it is unit-testable without a harness. Runs and lane creation
 * refuse with pi TaggedErrors whose `_tag` is the discriminant, and none of
 * pi's vocabulary passes the boundary (ADR-0003). The host never writes to a
 * running lane (S21), but after a crash pi holds the interrupted operation
 * open, and the lane is `LaneBusy` until it is resumed (S36 item 18).
 */
export function laneErrCode(tag: string): ErrCode {
  if (tag === "UnknownTarget") return ERR.UNKNOWN_TARGET
  if (tag === "LaneBusy") return ERR.BUSY
  return ERR.REFUSED
}

const refused = (error: { _tag: string }): WriteOutcome => ({
  kind: "refused",
  code: laneErrCode(error._tag),
})

/** A tool's partial result -> its text: the first text part, or "". */
function firstText(result: unknown): string {
  const content = (result as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return ""
  const part = content.find(
    (c): c is { type: "text"; text: string } =>
      (c as { type?: unknown })?.type === "text" &&
      typeof (c as { text?: unknown }).text === "string",
  )
  return part?.text ?? ""
}

/** Position -> pi's spelling of it, which uses `null` for the root. */
const toPi = (p: Position): string | null => (p.kind === "root" ? null : p.id)

export type AppendOutcome =
  | { readonly kind: "appended"; readonly id: EntryId }
  | { readonly kind: "refused"; readonly code: ErrCode }

export type CreateOutcome =
  | { readonly kind: "created"; readonly lane: LaneName }
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * A thread's lane (ADR-0020). It is never moved: it advances only by its own
 * appends and runs, so its tip stays its thread's end. The host touches it only
 * while it is idle (S21).
 */
export interface ThreadLaneHandle {
  readonly name: LaneName
  /**
   * Append with no run, through the pi `Lane`: it plans from its own cached
   * tip, so a write that bypasses it would be dropped from its next turn (S19).
   */
  append(message: ChatMessage | UpdateMessage): Promise<AppendOutcome>
  /**
   * Run one turn with `message` as the prompt itself (S19): a compelled chat,
   * a land message (ADR-0033), or a stack message (ADR-0038).
   */
  run(message: ChatMessage | LandMessage | StackMessage): Promise<WriteOutcome>
  /** Resume the operation a crash interrupted, in the lane's own directory. */
  resume(): Promise<WriteOutcome>
  /** Turn `ask_for_guidance` on or off for this lane's runs. */
  withGuidance(on: boolean): Promise<void>
  /**
   * End the lane's running turn. A tool running is aborted, and its result
   * recorded as aborted (S22); the lane then takes its next message.
   */
  abort(): Promise<void>
}

/**
 * The narrow facade host/ sees. Every member is a string, our own shape, or a
 * promise of one, so "no pi type crosses this boundary" is a checked property
 * of the signature. There is no way to move a lane, and none to READ a tip:
 * readers use the document, so observing a lane can never create one.
 */
export interface Agent {
  readonly modelLabel: string
  /**
   * Append at exactly `parent`, with no lane: a conversation thread (S21 Q1).
   * The host's serial executor guarantees nothing was written there since it
   * planned, so no re-read is needed here.
   */
  appendToTree(message: ChatMessage, parent: Position): Promise<AppendOutcome>
  /** Create a thread's lane at `at`. Called only where no lane is. */
  createThreadLane(at: Position): Promise<CreateOutcome>
  lane(name: LaneName): ThreadLaneHandle
  /** Hold a message in `pineta.outbox` until its lane is idle. */
  hold(item: Held): Promise<void>
  /** Remove a held message: it has been taken. */
  release(id: string): Promise<void>
  /** Store a writer's display name in `pineta.participant`, keyed by writer. */
  setParticipantName(writer: WriterId, name: string): Promise<void>
  /** Store a note's record in `pineta.note`, keyed by its id (ADR-0025). */
  setNote(note: NoteRecord): Promise<void>
  /** Store a seat's record in `pineta.seat`, keyed by its `clientID` (ADR-0048). */
  setSeat(seat: SeatRecord): Promise<void>
  /** Delete a seat's record: no stored text names it. */
  removeSeat(clientId: number): Promise<void>
  /** Store a root's archive record in `pineta.archive`, keyed by the root (ADR-0029). */
  setArchive(record: ArchiveRecord): Promise<void>
  /** Store an entry's mark in `pineta.mark`, keyed by the entry (ADR-0045). */
  setMark(record: MarkRecord): Promise<void>
  /** Delete an entry's mark: its title was cleared. */
  removeMark(entry: EntryId): Promise<void>
  /** Store one of the host's records (`WorkRecord`), under its namespace and key. */
  setWorkRecord(record: WorkRecord): Promise<void>
  /** Delete a lane's offer record: the offer was withdrawn (ADR-0039). */
  removeOffer(lane: LaneName): Promise<void>
  /** Lanes pi holds an operation open on: a crash interrupted them. */
  interrupted(): Promise<readonly LaneName[]>
  /**
   * A skill by its qualified name, e.g. `pineta:skill:resolve-conflicts`,
   * read now. Null if no command has that name.
   */
  skill(name: string): Promise<{
    readonly path: string
    readonly content: string
    readonly hash: string
  } | null>
  /** Every command pi loaded, labelled by package (ADR-0036). */
  commands(): readonly CommandSource[]
  /** pi's agent directory: settings, packages, and `auth.json`. Never mounted into a lane. */
  agentDir(): string
  /** Commands refused for their labels, with why. */
  refusedCommands(): readonly {
    readonly name: string
    readonly reason: string
  }[]
  /**
   * A command as the model reads it, from its file as it is now: a skill's
   * block (pi's format), or a template with its arguments. `inLane`: the
   * thread works in its own copy, so the paths are the lane's (`/mnt/host`).
   */
  expand(
    command: CommandSource,
    args: string,
    inLane: boolean,
  ): Promise<CommandRef | null>
  stats(): Promise<{ messageCount: number }>
  /**
   * One request for a commit message (ADR-0038): no tools, no session, so
   * nothing enters the tree or a lane's context. Null when it fails.
   */
  describe(request: {
    readonly system: string
    readonly user: string
  }): Promise<string | null>
  /**
   * Whether a banner can be drawn: banners are enabled, their model is
   * known, and there is a key for its provider. Asked before the brief, so a
   * host with no key spends nothing.
   */
  canDrawBanners(): Promise<boolean>
  /**
   * One banner image from `prompt`, asked at `ratio` (`W:H`, OpenRouter's
   * `image_config.aspect_ratio`, which pi-ai does not send itself), fitted
   * as an upload is. Never rejects: a failure, banners being off or bytes
   * that are not an image included, is `failed` and why.
   */
  drawBanner(prompt: string, ratio: string): Promise<Drawn>
  close(): Promise<void>
}

/**
 * Build the pi stack over a caller-supplied Kyneta document, and return a
 * narrow facade.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const { doc, replicaId } = options

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

  const lanes = options.tools
  const project = lanes?.project ?? process.cwd()
  const setup = await setUpModel(options.model, {
    cwd: project,
    skillsDir: SKILLS_DIR,
    ...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
  })
  const labelled = labelCommands(setup.commands, options.commandRenames ?? {})
  const resolved = setup.model
  // pi-agent-core's own tools. Each lane uses them in its own directory:
  // `toolContext` below. `read` fits an image and stores it before pi writes
  // the result, so the session keeps a reference (ADR-0051).
  const blobs = options.blobs
  const fileTools =
    lanes === null
      ? []
      : [
          createReadTool(
            blobs === undefined
              ? {}
              : { imageProcessor: readImageProcessor(blobs) },
          ),
          createWriteTool(),
          createEditTool(),
          createBashTool(),
        ]
  const toolNames = fileTools.map(t => t.name)
  const banners = lanes === null ? undefined : options.banners
  const tools =
    lanes === null
      ? []
      : [
          ...fileTools,
          guidanceTool((lane, q) => lanes.hooks.askedForGuidance(lane, q)),
          bannerTool(banners?.request),
        ]
  // What a lane's runs may call: the file tools, `set_banner` when banners
  // are on, and `ask_for_guidance` during a landing. pi stores the list in a
  // lane's configuration once it is set, and fails a run whose list names a
  // tool not registered, so every tool here is registered whatever the
  // setting, and `withGuidance` sets the whole list: a lane stored before
  // banners were turned on or off gets the current one at its next run's end.
  const activeTools = (guidance: boolean): string[] => [
    ...toolNames,
    ...(banners === undefined ? [] : [BANNER_TOOL]),
    ...(guidance ? [GUIDANCE_TOOL] : []),
  ]
  const imageModel =
    options.banners === undefined
      ? undefined
      : setup.images.model(
          options.banners.config.provider,
          options.banners.config.model,
        )
  // A call with no lane named (none should run tools) works in the project.
  const accessFor = (lane: LaneName | undefined): LaneAccess =>
    lanes === null || lane === undefined
      ? { kind: "direct", dir: project, ready: Promise.resolve() }
      : lanes.access(lane)
  // pi's own prompt, with the repo's context files and the person's skills, so
  // an extension that shapes pi's prompt sections finds them (S23). It names
  // the lane's directory, and does not wait for its setup. A lane of its own
  // is told about itself (`laneGuidelines`, ADR-0046), and sees its skills at
  // the paths it can read them (`skillsInLane`, ADR-0036).
  const promptFor = (toolContext: ToolContext) =>
    buildSystemPrompt({
      cwd: toolContext.dir,
      selectedTools: toolNames,
      contextFiles: setup.contextFiles,
      skills:
        toolContext.lane === null
          ? setup.skills
          : skillsInLane(setup.skills, toolContext.lane.hostPaths),
      ...(toolContext.lane === null
        ? {}
        : { promptGuidelines: laneGuidelines(toolContext.lane.facts) }),
    })

  const { harness } = await createAgentHarness(
    {
      session,
      models: setup.models,
      model: resolved,
      tools: tools as never[],
      activeToolNames: activeTools(false),
      toolContext: (context: typeof CTX): ToolContext => {
        const access = accessFor(laneOf(context))
        if (access.kind === "direct")
          return {
            env: directEnv(access.dir, access.ready),
            dir: access.dir,
            lane: null,
          }
        const { facts, hostPaths } = access
        return {
          env: laneEnv(facts.dir, access.gate),
          dir: facts.dir,
          lane: { facts, hostPaths },
        }
      },
      systemPrompt: promptFor,
      toProviderMessages: messages =>
        providerMessages(messages, options.blobs ?? NO_BLOBS),
      // Pineta's outbox means pi's own queue is never used; should it be, it
      // answers one message at a time rather than batching them (S20).
      followUpMode: "one-at-a-time",
    },
    CTX,
  )

  if (lanes !== null) {
    // A turn's files, recorded before the next request: every tool of the
    // turn has finished, and pi awaits this, so no write races the commit.
    // The snapshot after it is queued on the lane: the next tool call waits
    // for it, the next request does not. On a run's first request the tip is
    // its prompt. The tip is read from
    // the document: asking the lane here, inside its own drive, could wait on
    // itself.
    harness.hooks.on("before_request", async event => {
      if (event.step !== "assistant") return undefined
      const tip = readLaneTip(doc, event.lane)
      if (tip !== null)
        await lanes.hooks.turnDone(event.lane as LaneName, entryId(tip))
      return undefined
    })
  }

  // Streaming: every harness event carries the lane it happened on, so
  // concurrent threads' streams stay apart. pi's events become `StreamEvent`s
  // here; nothing else of them leaves this module. The harness's tool events
  // are `tool_*`: the `tool_execution_*` in pi's types are its older loop's.
  // `message_end` and `tool_end` are not mapped: the entry pi commits after
  // each is what ends its stream on screen (`planStream`).
  const emit = (event: StreamEvent) => options.onStream?.(event)
  const offs = [
    harness.events.on("message_update", event => {
      const inner = event.event
      if (inner.type !== "text_delta") return
      const delta = typeof inner.delta === "string" ? inner.delta : ""
      if (delta.length > 0) emit({ kind: "text", lane: event.lane, delta })
    }),
    harness.events.on("tool_start", event =>
      emit({
        kind: "toolStart",
        lane: event.lane,
        callId: event.toolCallId,
      }),
    ),
    harness.events.on("tool_update", event =>
      emit({
        kind: "toolOutput",
        lane: event.lane,
        callId: event.toolCallId,
        text: firstText(event.partialResult),
      }),
    ),
  ]

  // pi `Lane` objects, one per thread, held for the life of the process.
  type PiLane = Awaited<ReturnType<typeof harness.lane>>
  const held = new Map<LaneName, PiLane>()

  /** A thread's pi lane: held, or restored from the document after a restart. */
  async function existing(name: LaneName): Promise<PiLane | undefined> {
    const cached = held.get(name)
    if (cached !== undefined) return cached
    // Restored from the document by a previous process: pi finds it by name.
    // Checked first, because `harness.lane(name)` would CREATE a missing lane.
    if (!hasLaneRecord(doc, name)) return undefined
    const lane = await harness.lane(name, CTX)
    held.set(name, lane)
    return lane
  }

  const tagOf = (error: unknown) => (error as { _tag?: unknown })?._tag

  /** The last turn's files, after a run: before-request records every earlier one. */
  async function afterRun(name: LaneName): Promise<void> {
    if (lanes === null) return
    const tip = readLaneTip(doc, name)
    if (tip !== null) await lanes.hooks.turnDone(name, entryId(tip))
  }

  function threadLane(name: LaneName): ThreadLaneHandle {
    const ctx = laneContext(name, CTX)
    return {
      name,
      async append(message) {
        const lane = await existing(name)
        if (lane === undefined)
          return { kind: "refused", code: ERR.UNKNOWN_TARGET }
        try {
          return {
            kind: "appended",
            id: entryId(await lane.appendMessage(message, ctx)),
          }
        } catch (error) {
          const tag = tagOf(error)
          if (typeof tag === "string")
            return { kind: "refused", code: laneErrCode(tag) }
          throw error
        }
      },
      async run(message) {
        const lane = await existing(name)
        if (lane === undefined)
          return { kind: "refused", code: ERR.UNKNOWN_TARGET }
        // `RunResult` is a Result union. A run that pi admitted and that then
        // failed is still "ok" here: it ran. Only an admission refusal is
        // `refused`.
        const result = await lane.prompt(message, ctx)
        if (!result.ok) return refused(result.error)
        await afterRun(name)
        return { kind: "ok" }
      },
      async resume() {
        const lane = await existing(name)
        if (lane === undefined)
          return { kind: "refused", code: ERR.UNKNOWN_TARGET }
        // pi records a tool call the crash interrupted as interrupted, never
        // running it again; the run then continues in the lane's directory.
        const result = await lane.resume(ctx)
        if (!result.ok) return refused(result.error)
        await afterRun(name)
        return { kind: "ok" }
      },
      async withGuidance(on) {
        const lane = await existing(name)
        if (lane === undefined || lanes === null) return
        const active = await lane.getActiveTools(ctx)
        const next = activeTools(on)
        const same =
          next.length === active.length && next.every(t => active.includes(t))
        if (!same) await lane.setActiveTools(next, ctx)
      },
      async abort() {
        const lane = await existing(name)
        if (lane !== undefined) await lane.abort(ctx)
      },
    }
  }

  /** One value written at `namespace`/`key`: every setter's body. */
  const put = (namespace: string, key: string, stored: unknown) =>
    session.setValue(value(namespace, key), stored as never, CTX)

  return {
    modelLabel: `${resolved.provider}/${resolved.id}`,
    lane: threadLane,

    async describe({ system, user }) {
      try {
        const reply = await setup.models.completeSimple(setup.describeModel, {
          systemPrompt: system,
          messages: [{ role: "user", content: user, timestamp: Date.now() }],
        })
        const text = reply.content
          .flatMap(p => (p.type === "text" ? [p.text] : []))
          .join("")
          .trim()
        return reply.stopReason === "error" || text === "" ? null : text
      } catch {
        return null
      }
    },

    async canDrawBanners() {
      if (imageModel === undefined) return false
      return (await setup.images.apiKey(imageModel.provider)) !== undefined
    },

    async drawBanner(prompt, ratio) {
      const failed = (reason: string): Drawn => ({ kind: "failed", reason })
      if (imageModel === undefined) return failed("no banner model")
      try {
        const apiKey = await setup.images.apiKey(imageModel.provider)
        if (apiKey === undefined)
          return failed(`no key for ${imageModel.provider}`)
        const reply = await setup.images.models.generateImages(
          imageModel,
          { input: [{ type: "text", text: prompt }] },
          {
            apiKey,
            timeoutMs: DRAW_TIMEOUT_MS,
            onPayload: payload => ({
              ...(payload as object),
              image_config: { aspect_ratio: ratio },
            }),
          },
        )
        const image = reply.output.find(o => o.type === "image")
        if (reply.stopReason !== "stop")
          return failed(reply.errorMessage ?? reply.stopReason)
        if (image?.type !== "image") return failed("the reply held no image")
        return await drawnOf(image.data)
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error))
      }
    },

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

    async createThreadLane(at) {
      const name = laneNameForThread(uuidv7())
      try {
        // pi THROWS UnknownTarget for an entry it does not hold, where most of
        // its API returns a Result, so the throw is caught here and nothing
        // thrown by pi reaches the host.
        const lane = await harness.lane(name, { createAt: toPi(at) }, CTX)
        held.set(name, lane)
        return { kind: "created", lane: name }
      } catch (error) {
        const tag = tagOf(error)
        if (typeof tag === "string")
          return refused({ _tag: tag }) as CreateOutcome
        throw error
      }
    },

    async hold(item) {
      await put(OUTBOX_NAMESPACE, item.id, encodeHeld(item))
    },

    async release(id) {
      await session.deleteValue(value(OUTBOX_NAMESPACE, id), CTX)
    },

    async setParticipantName(writer, displayName) {
      await put(PARTICIPANT_NAMESPACE, writer, displayName)
    },

    async setNote(note) {
      await put(NOTE_NAMESPACE, note.id, encodeNote(note))
    },

    async setSeat(seat) {
      await put(SEAT_NAMESPACE, String(seat.clientId), encodeSeat(seat))
    },

    async removeSeat(clientId) {
      await session.deleteValue(value(SEAT_NAMESPACE, String(clientId)), CTX)
    },

    async setArchive(record) {
      await put(ARCHIVE_NAMESPACE, record.root, encodeArchive(record))
    },

    async setMark(record) {
      await put(MARK_NAMESPACE, record.entry, encodeMark(record))
    },

    async removeMark(entry) {
      await session.deleteValue(value(MARK_NAMESPACE, entry), CTX)
    },

    async setWorkRecord(record) {
      const { namespace, key, value: stored } = encodeWorkRecord(record)
      await put(namespace, key, stored)
    },

    async removeOffer(lane) {
      await session.deleteValue(value(OFFER_NAMESPACE, lane), CTX)
    },

    async interrupted() {
      const out: LaneName[] = []
      for (const stored of readLaneNames(doc)) {
        const name = stored as LaneName
        const lane = await existing(name)
        if (lane === undefined) continue
        const info = await lane.inspectExecution(CTX)
        if (info.current !== null) out.push(name)
      }
      return out
    },

    async skill(name) {
      const file = resolveCommand(name, labelled.commands)?.file
      if (file === undefined) return null
      const text = await readFile(file, "utf8").catch(() => null)
      if (text === null) return null
      return {
        path: file,
        content: withoutFrontmatter(text),
        hash: createHash("sha256").update(text).digest("hex"),
      }
    },

    commands() {
      return labelled.commands
    },

    agentDir() {
      return options.agentDir ?? DEFAULT_AGENT_DIR
    },

    refusedCommands() {
      return labelled.refused
    },

    async expand(command, args, inLane) {
      const text = await readFile(command.file, "utf8").catch(() => null)
      if (text === null) return null
      const where = (p: string) => (inLane ? hostPathInLane(p) : p)
      // pi's name for it: the last part of the qualified name.
      const name = command.name.split(":").at(-1) ?? command.name
      const expanded =
        command.kind === "skill"
          ? expandSkill({
              name,
              file: where(command.file),
              dir: where(command.dir),
              body: stripFrontmatter(text).trim(),
              args,
            })
          : substituteArgs(stripFrontmatter(text), parseCommandArgs(args))
      return {
        name: command.name,
        kind: command.kind,
        file: command.file,
        hash: createHash("sha256").update(text).digest("hex"),
        expanded,
      }
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
