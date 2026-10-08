// pi/agent — the agent at work in threads' lanes (ADR-0020, ADR-0092): a
// harness per root (ADR-0063), built through the scribe over that root's one
// pi session, from the person's pi setup. Only this package may import pi
// (ADR-0003, enforced by module resolution): everything pi-shaped is
// converted to pinetrie's shapes here or in the modules `createAgent` wires,
// so the host never sees a pi type.

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
  isLaneName,
  type LaneName,
  type RootId,
  type Spot,
  type StreamEvent,
} from "@pinetrie/core"
import {
  type BannerAnswer,
  type BannerAsk,
  chatImageShas,
  withChatImages,
} from "@pinetrie/rules"
import { type RootDocHandle, readLaneTip } from "@pinetrie/schema"
import { PINETRIE_COMPACTION } from "./compaction.ts"
import { createAgentHarness } from "./deep.ts"
import {
  type LaneAccess,
  type LaneHooks,
  laneOf,
  systemPromptFor,
  type ToolContext,
  toolContextOf,
} from "./lanes.ts"
import { type PiSetup, setupInside } from "./pi-setup.ts"
import { carryPinned, withCarried } from "./pinned.ts"
import { prefixChange, prefixOf } from "./prefix.ts"
import { type Scribe, scribeInside } from "./scribe.ts"
import { STREAM_SOURCES, streamEventOf } from "./stream.ts"
import {
  type CreateOutcome,
  type LaneRefusal,
  type ThreadLaneHandle,
  type ThreadLanes,
  threadLanes,
} from "./thread-lanes.ts"
import { activeToolNames, assembleTools } from "./tools.ts"

const CTX = BACKGROUND_CONTEXT

const NO_BLOBS: Pick<BlobStore, "get"> = { get: () => undefined }

/** A lane no root holds: every write to it is refused. */
const UNKNOWN_LANE: LaneRefusal = { kind: "refused", code: ERR.UNKNOWN_TARGET }

/** Coordination-free id, used for peer ids. Same generator pi uses for entries. */
export const newId = (): string => uuidv7()

/**
 * The documents pi's sessions are over (ADR-0063), as the host opens them:
 * the session's, where the scribe writes the host's session-wide records, and
 * each root's, a pi session of its own.
 */
export interface AgentDocuments {
  /** A root's document, held and loaded: opened if it is not. */
  root(root: RootId): Promise<RootDocHandle>
  /** The root a lane works in, from its record; null for a lane no root holds. */
  rootOfLane(lane: LaneName): RootId | null
}

export interface CreateAgentOptions {
  readonly documents: Pick<AgentDocuments, "root" | "rootOfLane">
  /** Each root's harness is built over the scribe's session for it (S113). */
  readonly scribe: Scribe
  readonly setup: PiSetup
  /**
   * How each lane uses the agent's tools; null for no tools. Tools run as
   * the host's user, so they are on only when asked for.
   */
  readonly tools: {
    /** How a lane's tools reach its files: its container, or a directory (ADR-0034). */
    readonly access: (lane: LaneName) => LaneAccess
    readonly hooks: LaneHooks
  } | null
  /**
   * Where images are kept. A chat's are read from it for every request
   * (ADR-0042); `read` puts each image it reads there (ADR-0051). Without it,
   * a chat's images reach the model as "no longer stored".
   */
  readonly blobs?: Pick<BlobStore, "get" | "put" | "ref">
  /**
   * Where `set_banner` sends its asks, when the user config enables banners.
   * Without it, or without tools, there is no `set_banner`.
   */
  readonly bannerAsks?: (
    lane: LaneName,
    ask: BannerAsk,
  ) => Promise<BannerAnswer>
  /** What a running turn writes, in pinetrie's own words, per lane. */
  readonly onStream?: (event: StreamEvent) => void
  /**
   * A lane's request starts otherwise than its last one did: its earlier
   * thinking is dropped, and its prompt cached again (`prefix.ts`, S85).
   */
  readonly onPrefixChange?: (lane: LaneName) => void
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

/** The pi stack over one root's session: its harness's lanes, and how it closes. */
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
   * decides the id, ADR-0057). Refused `lane_id_in_use` for an id pi holds.
   */
  createThreadLane(spot: Spot, lane: LaneName): Promise<CreateOutcome>
  /** A thread's lane, in the root its record names. */
  lane(name: LaneName): ThreadLaneHandle
  /** Lanes pi holds an operation open on, in `roots`: a crash interrupted them. */
  interrupted(roots: readonly RootId[]): Promise<readonly LaneName[]>
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
  const resolved = setup.model
  // `set_banner` asks only while the agent has tools and banners are on.
  const bannerAsks = tools === null ? undefined : options.bannerAsks
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
    tools === null ? [] : activeToolNames({ banners: bannerAsks !== undefined })
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

  /** The pi stack over `root`'s session, given by the scribe: a harness and its lanes. */
  async function buildStack(
    session: StorageBackedSession,
    root: RootId,
  ): Promise<Stack> {
    const doc = await documents.root(root)
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
        // pinetrie's queued cards mean pi's own queue is never used; should it
        // be, it answers one message at a time rather than batching (S20).
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
      doc,
      recordTurn,
      activeTools: tools === null ? null : activeTools,
    })
    return {
      lanes,
      async close() {
        for (const off of offs) off()
        await harness.close(CTX)
      },
    }
  }

  /** `root`'s stack, built once through the scribe. */
  const ofRoot = (root: RootId): Promise<Stack> =>
    inside.over(root, session => buildStack(session, root))

  /** A lane's stack, in the root its record names; undefined for none. */
  async function ofLane(name: LaneName): Promise<Stack | undefined> {
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
      run: (message, before) => on(h => h.run(message, before), UNKNOWN_LANE),
      steer: message => on(h => h.steer(message), UNKNOWN_LANE),
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

    close: () => inside.closeBuilt(),
  }
}
