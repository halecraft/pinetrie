// pi/agent — harness lifecycle at the pi boundary.
//
// The directory is named for what it wraps, so the architecture rule reads as a
// tautology: only `pi/` may import pi. The harness and model runtime sit here
// beside the `Storage` implementation because they are the same concern —
// isolating pi — not because they are storage.
//
// Everything pi-shaped is converted to OUR shapes here. host/ never sees a pi
// type, never imports pi, and would keep compiling if pi's surface moved.

import {
  BACKGROUND_CONTEXT,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  StorageBackedSession,
  uuidv7,
  value,
} from "@earendil-works/pi-agent-core"
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/harness/env/nodejs"
import { insertEntry } from "@earendil-works/pi-agent-core/harness/session"
import {
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type LaneName,
  laneNameForThread,
  type Position,
  type StreamEvent,
  toolLabel,
  type WriterId,
} from "@pineta/core"
import {
  type ChatMessage,
  encodeHeld,
  encodeReference,
  type Held,
  OUTBOX_NAMESPACE,
  PARTICIPANT_NAMESPACE,
  REFERENCE_NAMESPACE,
  type Reference,
} from "@pineta/marginalia"
import { hasLaneRecord, type SessionDocHandle } from "@pineta/schema"
import { type ModelChoice, setUpModel } from "./config.ts"
import { buildSystemPrompt, createAgentHarness } from "./deep.ts"
import { KynetaStorage } from "./storage.ts"

export { KynetaStorage }

/** pi's ambient context. Opaque to host/. */
export const CTX = BACKGROUND_CONTEXT

/** Coordination-free id, used for peer ids. Same generator pi uses for entries. */
export const newId = (): string => uuidv7()

export interface CreateAgentOptions {
  readonly doc: SessionDocHandle
  /**
   * This PROCESS's replica id, used by storage for write tokens. It is not a
   * writer's identity: writers are people, identified by the transport.
   */
  readonly replicaId: string
  readonly model: ModelChoice
  /**
   * Where the agent reads, writes, edits and runs commands; null for no tools.
   * Tools run as the host's user, so they are on only when asked for.
   */
  readonly tools: { readonly cwd: string } | null
  /** What a running turn writes, in Pineta's own words, per lane. */
  readonly onStream?: (event: StreamEvent) => void
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
 * pi's vocabulary passes the boundary (ADR-0003). `LaneBusy` cannot arise:
 * the host never writes to a running lane (S21), so it is an ordinary refusal.
 */
export function laneErrCode(tag: string): ErrCode {
  if (tag === "UnknownTarget") return ERR.UNKNOWN_TARGET
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
  append(message: ChatMessage): Promise<AppendOutcome>
  /** Run one turn with `message`, a compelled chat, as the prompt itself (S19). */
  run(message: ChatMessage): Promise<WriteOutcome>
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
  /** Store a reference as a pi value in `pineta.reference` (ADR-0016, ADR-0017). */
  addReference(reference: Reference): Promise<void>
  /** Store a writer's display name in `pineta.participant`, keyed by writer. */
  setParticipantName(writer: WriterId, name: string): Promise<void>
  stats(): Promise<{ messageCount: number }>
  close(): Promise<void>
}

/**
 * Build the pi stack over a caller-supplied Kyneta document, and return a
 * narrow facade.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const { doc, replicaId } = options

  const storage = new KynetaStorage({ doc, peerId: replicaId })
  const session = new StorageBackedSession(
    { id: `pineta-${replicaId}`, createdAt: Date.now(), storageVersion: 1 },
    storage,
    {},
  )

  const cwd = options.tools?.cwd ?? process.cwd()
  const setup = await setUpModel(options.model, { cwd })
  const resolved = setup.model
  // pi-agent-core's own tools, built for this harness; they run in `cwd`.
  const tools =
    options.tools === null
      ? []
      : [
          createReadTool(),
          createWriteTool(),
          createEditTool(),
          createBashTool(),
        ]
  const toolNames = tools.map(t => t.name)

  const { harness } = await createAgentHarness(
    {
      session,
      models: setup.models,
      model: resolved,
      tools: tools as never[],
      activeToolNames: toolNames,
      toolContext: { env: new NodeExecutionEnv({ cwd }) },
      // pi's own prompt, with the repo's context files and the person's skills,
      // so an extension that shapes pi's prompt sections finds them (S23).
      systemPrompt: buildSystemPrompt({
        cwd,
        selectedTools: toolNames,
        contextFiles: setup.contextFiles,
        skills: setup.skills,
      }),
      // Pineta's outbox means pi's own queue is never used; should it be, it
      // answers one message at a time rather than batching them (S20).
      followUpMode: "one-at-a-time",
    },
    CTX,
  )

  // Streaming: every harness event carries the lane it happened on, so
  // concurrent threads' streams stay apart. pi's events become `StreamEvent`s
  // here; nothing else of them leaves this module. The harness's tool events
  // are `tool_*`: the `tool_execution_*` in pi's types are its older loop's.
  const emit = (event: StreamEvent) => options.onStream?.(event)
  const offs = [
    harness.events.on("message_update", event => {
      const inner = event.event
      if (inner.type !== "text_delta") return
      const delta = typeof inner.delta === "string" ? inner.delta : ""
      if (delta.length > 0) emit({ kind: "text", lane: event.lane, delta })
    }),
    harness.events.on("message_end", event =>
      emit({ kind: "messageEnd", lane: event.lane }),
    ),
    harness.events.on("tool_start", event =>
      emit({
        kind: "toolStart",
        lane: event.lane,
        callId: event.toolCallId,
        label: toolLabel(event.toolName, event.args),
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
    harness.events.on("tool_end", event =>
      emit({ kind: "toolEnd", lane: event.lane, callId: event.toolCallId }),
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

  function threadLane(name: LaneName): ThreadLaneHandle {
    return {
      name,
      async append(message) {
        const lane = await existing(name)
        if (lane === undefined)
          return { kind: "refused", code: ERR.UNKNOWN_TARGET }
        try {
          return {
            kind: "appended",
            id: entryId(await lane.appendMessage(message, CTX)),
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
        const result = await lane.prompt(message, CTX)
        return result.ok ? { kind: "ok" } : refused(result.error)
      },
      async abort() {
        const lane = await existing(name)
        if (lane !== undefined) await lane.abort(CTX)
      },
    }
  }

  return {
    modelLabel: `${resolved.provider}/${resolved.id}`,
    lane: threadLane,

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
      await session.setValue(
        value(OUTBOX_NAMESPACE, item.id),
        encodeHeld(item),
        CTX,
      )
    },

    async release(id) {
      await session.deleteValue(value(OUTBOX_NAMESPACE, id), CTX)
    },

    async addReference(reference) {
      await session.setValue(
        value(REFERENCE_NAMESPACE, reference.id),
        encodeReference(reference),
        CTX,
      )
    },

    async setParticipantName(writer, displayName) {
      await session.setValue(
        value(PARTICIPANT_NAMESPACE, writer),
        displayName,
        CTX,
      )
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
