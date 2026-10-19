// pi/agent — the agent at work in threads' lanes: a harness per root, built
// through the scribe over that root's one pi session, from the person's pi
// setup. Everything pi-shaped is converted to pinetrie's shapes here or in
// the modules `createAgent` wires, so the host never sees a pi type.

import {
  type AgentMessage,
  BACKGROUND_CONTEXT,
  compact,
  convertToLlm,
  type StorageBackedSession,
  uuidv7,
} from "@earendil-works/pi-agent-core"
import {
  type BlobStore,
  ERR,
  isImageMime,
  isThreadId,
  type RootId,
  type Spot,
  type ThreadId,
} from "@pinetrie/core"
import {
  type BannerAnswer,
  type BannerAsk,
  messageImageShas,
  type RequestTokens,
  withMessageImages,
} from "@pinetrie/rules"
import {
  type RootDocHandle,
  readLaneTip,
  type ScratchDocHandle,
} from "@pinetrie/schema"
import { type StreamEvent, TOOL_IDS } from "@pinetrie/threads"
import { carryContext, carryPrompt, withCarried } from "./carry.ts"
import { PINETRIE_COMPACTION } from "./compaction.ts"
import { NO_MODEL_STAND_IN } from "./config.ts"
import { createAgentHarness } from "./deep.ts"
import { countedDiagnostics } from "./diagnostics.ts"
import {
  type LaneAccess,
  type LaneHooks,
  laneToolContext,
  promptSectionsFor,
  systemPromptFor,
  type ToolContext,
} from "./lanes.ts"
import { type PiSetup, setupInside } from "./pi-setup.ts"
import { type Scribe, scribeInside } from "./scribe.ts"
import { harnessStreamEvent, STREAM_SOURCES } from "./stream.ts"
import { threadOfContext } from "./thread-context.ts"
import {
  type CreateOutcome,
  type LaneRefusal,
  type ThreadLaneHandle,
  type ThreadLanes,
  threadLanes,
} from "./thread-lanes.ts"
import { assembleTools } from "./tools.ts"
import { transcriptPromptModels } from "./transcript-prompt.ts"

const CTX = BACKGROUND_CONTEXT

const NO_BLOBS: Pick<BlobStore, "get"> = { get: () => undefined }

/** A lane no root holds: every write to it is refused. */
const UNKNOWN_LANE: LaneRefusal = { kind: "refused", code: ERR.UNKNOWN_TARGET }
const NO_MODEL: LaneRefusal = { kind: "refused", code: ERR.NO_MODEL }

/** A peer id, from the generator pi uses for entries. */
export const newId = (): string => uuidv7()

/** The documents pi's sessions are over, a pi session for each root. */
export interface AgentDocuments {
  /**
   * A root's document, loaded. The host refuses a root it does not hold for
   * the caller (a step or a lease); the scribe asks once per root and keeps
   * its session until `release`.
   */
  root(root: RootId): Promise<RootDocHandle>
  /**
   * The root's scratch document (`KynetaStorage`'s `scratch`): the one
   * loaded, if any. Refused as `root` is, for a root nothing holds.
   */
  scratch(root: RootId): ScratchDocHandle | undefined
  /** The root's scratch document, made if there is none, once it can be written. Refused as `scratch` is. */
  makeScratch(root: RootId): Promise<ScratchDocHandle>
  /** Resolves once the store holds every write made so far. */
  stored(): Promise<void>
  /** The root a lane works in, from its record; null for a lane no root holds. */
  rootOfLane(lane: ThreadId): RootId | null
}

export interface CreateAgentOptions {
  readonly documents: Pick<AgentDocuments, "root" | "rootOfLane">
  /** Each root's harness is built over the scribe's session for it. */
  readonly scribe: Scribe
  readonly setup: PiSetup
  /**
   * How each lane uses the agent's tools; null for no tools. Tools run as
   * the host's user, so they are on only when asked for.
   */
  readonly tools: {
    /** How a lane's tools reach its files: its container; null for a lane with no copy of its own. */
    readonly access: (lane: ThreadId) => LaneAccess | null
    readonly hooks: LaneHooks
    /** Where `set_banner` sends its asks: the host answers each. */
    readonly bannerAsks: (
      lane: ThreadId,
      ask: BannerAsk,
    ) => Promise<BannerAnswer>
  } | null
  /**
   * Where images are kept. A chat's are read from it for every request;
   * `read` puts each image it reads there. Without it, a chat's images reach
   * the model as "no longer stored".
   */
  readonly blobs?: Pick<BlobStore, "get" | "put" | "ref">
  readonly onStream?: (event: StreamEvent) => void
  /**
   * Each model request's tokens, per lane: what a budget for agents talking
   * spends from (`addedTokens`).
   */
  readonly onUsage?: (lane: ThreadId, tokens: RequestTokens) => void
  /**
   * Asked before each model request of a lane's run; false aborts the run
   * before the request is sent, so a spent budget overruns by at most the
   * request that crossed it. Absent: every request is sent.
   */
  readonly mayRequest?: (lane: ThreadId) => boolean
}

/**
 * What the model reads: pi's own conversion, after each chat's images are
 * attached. Read from the store for every request, uncached.
 */
function providerMessages(
  messages: AgentMessage[],
  blobs: Pick<BlobStore, "get">,
): ReturnType<typeof convertToLlm> {
  const found = new Map(
    messageImageShas(messages).flatMap(sha => {
      const blob = blobs.get(sha)
      // A chat's images alone: a quote's markdown is no image.
      return blob === undefined || !isImageMime(blob.mimeType)
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
  return convertToLlm(withMessageImages(messages, found))
}

/** The pi stack over one root's session. */
export interface Stack {
  readonly lanes: ThreadLanes
  /** Closes the harness, which closes the session it was built over. */
  readonly close: () => Promise<void>
}

/**
 * What the host asks of the agent. Every member is a string, our own shape,
 * or a promise of one, so "no pi type crosses this boundary" is a checked
 * property of the signature. There is no way to move a lane, and none to
 * READ a tip: readers use the document, so observing a lane can never create
 * one.
 */
export interface Agent {
  /**
   * Create a thread's lane at `spot`, in its root, named `lane` (the host
   * decides the id). Refused `lane-id-in-use` for an id pi holds.
   */
  createThreadLane(spot: Spot, lane: ThreadId): Promise<CreateOutcome>
  lane(name: ThreadId): ThreadLaneHandle
  /** Lanes pi holds an operation open on, in `roots`: a crash or a stop cut them off. */
  /**
   * `skip` names lanes not to ask of: pi's inspection of a lane waits for its
   * running operation to end, so a lane the host runs now is skipped.
   */
  interrupted(
    roots: readonly RootId[],
    skip?: (lane: ThreadId) => boolean,
  ): Promise<readonly ThreadId[]>
  /** Close every harness, which ends running runs. The scribe's sessions close after. */
  close(): Promise<void>
}

/**
 * The agent over the scribe's sessions, from the person's pi setup. One tool
 * list, system prompt and hook set serve every root; a root's harness is
 * built the first time a lane call needs it, and lives until the scribe
 * releases the root or the agent closes.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const { documents, tools } = options
  const { setup, project } = setupInside.open(options.setup)
  const inside = scribeInside.open(options.scribe)
  const resolved =
    setup.model.kind === "model" ? setup.model.model : NO_MODEL_STAND_IN
  /** Every run is refused on a host with no model: the harness's is a stand-in. */
  const noModel = setup.model.kind === "none"
  const assembled =
    tools === null
      ? { registered: [], files: [] }
      : assembleTools({
          hooks: tools.hooks,
          blobs: options.blobs,
          bannerAsks: tools.bannerAsks,
        })
  // An agent with no tools registers none, so its lanes may call none.
  const activeTools: string[] = tools === null ? [] : [...TOOL_IDS]
  // No tools, or a call with no lane named: no access, and every call is
  // refused (`laneToolContext`).
  const accessFor = (lane: ThreadId | undefined): LaneAccess | null =>
    tools === null || lane === undefined ? null : tools.access(lane)
  const systemPrompt = systemPromptFor(setup, assembled.files, project)
  const promptSections = promptSectionsFor(setup, assembled.files, project)
  // Every request leads with its lane's own prompt and the tools; titles,
  // describes, digests and focuses use `setup.models` as it is.
  const harnessModels = transcriptPromptModels(setup.models)

  /** The lane's last turn, recorded at its tip as its root's document has it. */
  async function recordTurn(lane: ThreadId): Promise<void> {
    if (tools === null) return
    const root = documents.rootOfLane(lane)
    if (root === null) return
    const tip = readLaneTip(await documents.root(root), lane)
    if (tip !== null) await tools.hooks.turnDone(lane, tip)
  }

  /** The pi stack over `root`'s session, given by the scribe: a harness and its lanes. */
  async function buildStack(
    session: StorageBackedSession,
    root: RootId,
  ): Promise<Stack> {
    const doc = await documents.root(root)
    const { harness } = await createAgentHarness(
      {
        session,
        models: harnessModels,
        model: resolved,
        tools: [...assembled.registered] as never[],
        activeToolNames: activeTools,
        toolContext: (context: typeof CTX): ToolContext =>
          laneToolContext(accessFor(threadOfContext(context)), project),
        systemPrompt,
        toProviderMessages: messages =>
          providerMessages(messages, options.blobs ?? NO_BLOBS),
        // pinetrie's queued cards mean pi's own queue is never used; should it
        // be, it answers one message at a time rather than batching.
        followUpMode: "one-at-a-time",
        compaction: PINETRIE_COMPACTION,
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
        if (event.step !== "assistant" || !isThreadId(lane)) return undefined
        await recordTurn(lane)
        return undefined
      })
    }
    // A spent budget stops the run before its next request. The abort is not
    // awaited: this hook runs inside the lane's drive, which an awaited abort
    // would wait on.
    const { mayRequest } = options
    if (mayRequest !== undefined)
      harness.hooks.on("before_request", async event => {
        const lane = event.lane
        if (event.step !== "assistant" || !isThreadId(lane)) return undefined
        if (mayRequest(lane)) return undefined
        // The lane is held, so this resolves at once; the abort is begun
        // before the request is sent, and not awaited.
        const held = await harness.lane(lane, CTX)
        void held.abort(CTX).catch(() => undefined)
        return undefined
      })
    const { onUsage } = options
    const usageOff =
      onUsage === undefined
        ? () => undefined
        : harness.events.on("usage", event => {
            if (!isThreadId(event.lane)) return
            const { input, cacheRead, cacheWrite, output } = event.row.usage
            onUsage(event.lane, {
              context: input + cacheRead + cacheWrite,
              output,
            })
          })
    // A compaction keeps the lane's prompt and the context the model last
    // read in view: the prompt summarised, folded, then the newest context
    // entry of each kind summarised, at the head of pi's retained tail.
    // Nothing is thrown: if `compact` fails, pi compacts on its own, and the
    // next run writes the prompt and restates the context.
    harness.hooks.on("before_compaction", async event => {
      const carried = [
        ...carryPrompt(event.preparation),
        ...carryContext(event.preparation),
      ]
      if (carried.length === 0) return undefined
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
        ? { compaction: withCarried(done.value, carried) }
        : undefined
    })
    // A reply is stored with each list of dropped thinking as its count.
    harness.hooks.on("after_response", async event => {
      const diagnostics = countedDiagnostics(event.message.diagnostics)
      return diagnostics === event.message.diagnostics
        ? undefined
        : {
            message: {
              ...event.message,
              diagnostics: diagnostics as typeof event.message.diagnostics,
            },
          }
    })
    const offs = STREAM_SOURCES.map(type =>
      harness.events.on(type, event => {
        const stream = harnessStreamEvent(event)
        if (stream !== null) options.onStream?.(stream)
      }),
    )
    const lanes = threadLanes({
      harness,
      doc,
      recordTurn,
      activeTools: tools === null ? null : activeTools,
      promptSections: lane =>
        promptSections(laneToolContext(accessFor(lane), project)),
    })
    return {
      lanes,
      async close() {
        for (const off of offs) off()
        usageOff()
        await harness.close(CTX)
      },
    }
  }

  const ofRoot = (root: RootId): Promise<Stack> =>
    inside.over(root, session => buildStack(session, root))

  /** A lane's stack, in the root its record names; undefined for none. */
  async function ofLane(name: ThreadId): Promise<Stack | undefined> {
    const root = documents.rootOfLane(name)
    return root === null ? undefined : ofRoot(root)
  }

  /** A handle whose every call finds the lane's root when it is made. */
  function laneHandle(name: ThreadId): ThreadLaneHandle {
    const on = async <T>(
      f: (h: ThreadLaneHandle) => Promise<T>,
      none: T,
    ): Promise<T> => {
      const stack = await ofLane(name)
      return stack === undefined ? none : f(stack.lanes.lane(name))
    }
    return {
      name,
      // pi's inspection needs no model, so a host without one is told too.
      isLeftOpen: () => on(h => h.isLeftOpen(), false),
      append: message => on(h => h.append(message), UNKNOWN_LANE),
      run: (message, before) =>
        noModel
          ? Promise.resolve(NO_MODEL)
          : on(h => h.run(message, before), UNKNOWN_LANE),
      steer: message =>
        noModel
          ? Promise.resolve(NO_MODEL)
          : on(h => h.steer(message), UNKNOWN_LANE),
      resume: () =>
        noModel ? Promise.resolve(NO_MODEL) : on(h => h.resume(), UNKNOWN_LANE),
      abort: () => on(h => h.abort(), undefined),
    }
  }

  return {
    lane: laneHandle,

    async createThreadLane(spot, lane) {
      return (await ofRoot(spot.root)).lanes.createThreadLane(spot.at, lane)
    },

    async interrupted(roots, skip) {
      const out: ThreadId[] = []
      for (const root of roots)
        out.push(...(await (await ofRoot(root)).lanes.interrupted(skip)))
      return out
    },

    close: () => inside.closeBuilt(),
  }
}
