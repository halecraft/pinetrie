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
  StorageBackedSession,
  uuidv7,
} from "@earendil-works/pi-agent-core"
import { ERR, type ErrCode, type LaneName, type Position } from "@pineta/core"
import { hasLaneRecord, type SessionDocHandle } from "@pineta/schema"
import { createAgentHarness, ModelRuntime } from "./deep.ts"
import { KynetaStorage } from "./storage.ts"

export { KynetaStorage }

/** pi's ambient context. Opaque to host/. */
export const CTX = BACKGROUND_CONTEXT

/** Coordination-free id, used for peer ids. Same generator pi uses for entries. */
export const newId = (): string => uuidv7()

/**
 * Resolve a model.
 *
 * ADR-0009: we do NOT inject an IdGenerator. pi's default is
 * `{ next: uuidv7 }` (session.js:158) — a 41-bit monotonic counter seeded once
 * per module instance, so intra-process entry-id collision probability is
 * exactly 0. Replacing it is the documented hazard; the default is verified safe.
 */
export async function resolveModel({
  provider,
  model,
}: {
  provider: string
  model: string
}) {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false })
  const resolved = runtime.getModel(provider, model)
  if (resolved === undefined) {
    throw new Error(`model not found: ${provider}/${model}`)
  }
  return { models: runtime, model: resolved }
}

export interface CreateAgentOptions {
  readonly doc: SessionDocHandle
  /**
   * This PROCESS's replica id, used by storage for write tokens. It is not a
   * writer's identity: writers are lanes, named per connected client.
   */
  readonly replicaId: string
  readonly provider: string
  readonly model: string
  /** A text delta, attributed to the lane it streamed on. */
  readonly onDelta?: (event: { lane: string; delta: string }) => void
}

/** The result of asking pi to do something to a lane. */
export type LaneOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * pi's refusal tag -> our `ErrCode`, as a value.
 *
 * Pure, so it is unit-testable without a harness. It covers every lane
 * operation: runs, navigation and lane creation all refuse with pi
 * TaggedErrors whose `_tag` is the discriminant. Before this was shared, a
 * run's refusal passed pi's raw tag straight through, which leaked pi's
 * vocabulary past the boundary (ADR-0003).
 */
export function laneErrCode(tag: string): ErrCode {
  if (tag === "UnknownTarget") return ERR.UNKNOWN_TARGET
  if (tag === "InvalidNavigation") return ERR.INVALID_NAVIGATION
  if (tag === "LaneBusy") return ERR.BUSY
  return ERR.REFUSED
}

const refused = (error: { _tag: string }): LaneOutcome => ({
  kind: "refused",
  code: laneErrCode(error._tag),
})

/** Position -> pi's spelling of it, which uses `null` for the root. */
const toPi = (p: Position): string | null => (p.kind === "root" ? null : p.id)

/**
 * One writer's lane. Only ever obtained on the command path, and only by the
 * writer it belongs to: a pi `Lane` is single-writer state (S3).
 */
export interface WriterLane {
  readonly name: LaneName
  /** Create this lane at `at`. The host calls it only when `planAttach` says to. */
  create(at: Position): Promise<LaneOutcome>
  navigate(to: Position): Promise<LaneOutcome>
  /** Run one turn at the lane's tip. */
  run(text: string): Promise<LaneOutcome>
}

/**
 * The narrow facade host/ sees: one harness, a lane per writer. Every member
 * is a string, our own shape, or a promise of one, so "no pi type crosses this
 * boundary" is a checked property of the signature.
 *
 * There is deliberately no way to READ a tip here. Readers use the document,
 * as the client does, so observing a lane can never create one.
 */
export interface Agent {
  readonly modelLabel: string
  lane(name: LaneName): WriterLane
  stats(): Promise<{ messageCount: number }>
  close(): Promise<void>
}

/**
 * Build the pi stack over a caller-supplied Kyneta document, and return a
 * narrow facade.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const { doc, replicaId, provider, model } = options

  const storage = new KynetaStorage({ doc, peerId: replicaId })
  const session = new StorageBackedSession(
    { id: `pineta-${replicaId}`, createdAt: Date.now(), storageVersion: 1 },
    storage,
    {},
  )

  const { models, model: resolved } = await resolveModel({ provider, model })

  const { harness } = await createAgentHarness(
    {
      session,
      models,
      model: resolved,
      // The skeleton runs a plain chat turn. No tools, no skills, no compaction
      // surprises — those are "thicken" steps, not skeleton steps.
      activeToolNames: [],
      tools: [],
      systemPrompt:
        "You are a concise assistant inside a walking-skeleton test harness. Answer in one short sentence.",
    },
    CTX,
  )

  // Streaming: every harness event carries the lane it happened on, so
  // concurrent writers' deltas can be routed apart. Only the delta text and
  // the lane name leave this module.
  const offUpdate = harness.events.on("message_update", event => {
    const inner = event.event
    if (inner.type !== "text_delta") return
    const delta = typeof inner.delta === "string" ? inner.delta : ""
    if (delta.length > 0) options.onDelta?.({ lane: event.lane, delta })
  })

  // pi `Lane` objects, one per writer, held for the life of the process.
  type PiLane = Awaited<ReturnType<typeof harness.lane>>
  const held = new Map<LaneName, PiLane>()

  /** The writer's pi lane, or undefined if `create` has not run for it. */
  async function existing(name: LaneName): Promise<PiLane | undefined> {
    const cached = held.get(name)
    if (cached !== undefined) return cached
    // Restored from the document by a previous process: pi finds it by name.
    if (!hasLaneRecord(doc, name)) return undefined
    const lane = await harness.lane(name, CTX)
    held.set(name, lane)
    return lane
  }

  function writerLane(name: LaneName): WriterLane {
    return {
      name,

      async create(at) {
        try {
          // pi IGNORES `createAt` for a lane that already exists, which is why
          // this is only called when `planAttach` said the lane is absent. It
          // THROWS UnknownTarget for an entry pi does not hold, where
          // navigateTree returns a Result, so the throw is caught here and
          // nothing thrown by pi reaches the host.
          const lane = await harness.lane(name, { createAt: toPi(at) }, CTX)
          held.set(name, lane)
          return { kind: "ok" }
        } catch (error) {
          const tag = (error as { _tag?: unknown })?._tag
          if (typeof tag === "string") return refused({ _tag: tag })
          throw error
        }
      },

      async navigate(to) {
        const lane = await existing(name)
        if (lane === undefined)
          return { kind: "refused", code: ERR.UNKNOWN_TARGET }
        const moved = await lane.navigateTree(toPi(to), {}, CTX)
        return moved.ok ? { kind: "ok" } : refused(moved.error)
      },

      async run(text) {
        const lane = await existing(name)
        if (lane === undefined)
          return { kind: "refused", code: ERR.UNKNOWN_TARGET }
        // `RunResult` is a Result union. A run that pi admitted and that then
        // failed is still "ok" here: it ran. Only an admission refusal is
        // `refused`.
        const result = await lane.prompt(text, undefined, CTX)
        return result.ok ? { kind: "ok" } : refused(result.error)
      },
    }
  }

  return {
    modelLabel: `${resolved.provider ?? provider}/${resolved.id}`,
    lane: writerLane,

    async stats() {
      return session.getStats(CTX)
    },

    async close() {
      offUpdate?.()
      await harness.close(CTX)
    },
  }
}
