// storage/pi — the pi boundary.
//
// SRP note (reported, not hidden): this directory is named `storage/` but it is
// really "the pi adapter". The dependency rule is "exactly one module imports
// pi", and the harness/model runtime belong on the same side of that boundary
// as the Storage implementation. When the skeleton is thickened, renaming this
// directory to `pi/` would be more honest.
//
// Everything pi-shaped is converted to OUR shapes here. host/ never sees a pi
// type, never imports pi, and would keep compiling if pi's surface moved.

import {
  BACKGROUND_CONTEXT,
  StorageBackedSession,
  uuidv7,
} from "@earendil-works/pi-agent-core"
import { createAgentHarness, ModelRuntime } from "./pi-deep.mjs"
import { KynetaStorage } from "./kyneta-storage.mjs"

export { KynetaStorage }

/** pi's ambient context. Opaque to host/. */
export const CTX = BACKGROUND_CONTEXT

/** Coordination-free id, used for peer ids. Same generator pi uses for entries. */
export const newId = () => uuidv7()

/**
 * Resolve a model.
 *
 * ADR-0009: we do NOT inject an IdGenerator. pi's default is
 * `{ next: uuidv7 }` (session.js:158) — a 41-bit monotonic counter seeded once
 * per module instance, so intra-process entry-id collision probability is
 * exactly 0. Replacing it is the documented hazard; the default is verified safe.
 */
export async function resolveModel({ provider, model }) {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false })
  const resolved = runtime.getModel(provider, model)
  if (resolved === undefined) {
    throw new Error(`model not found: ${provider}/${model}`)
  }
  return { models: runtime, model: resolved }
}

/**
 * Build the whole pi stack over a caller-supplied Kyneta document, and return a
 * narrow facade.
 *
 * @param {{ doc: object, peerId: string, laneName: string,
 *           provider: string, model: string,
 *           onDelta: (d: {runId: string, delta: string}) => void,
 *           onTurnEnd: (d: {runId: string}) => void }} options
 */
export async function createAgent(options) {
  const { doc, peerId, laneName, provider, model } = options

  const storage = new KynetaStorage({ doc, peerId })
  const session = new StorageBackedSession(
    { id: `pineta-${peerId}`, createdAt: Date.now(), storageVersion: 1 },
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

  const lane = await harness.lane(laneName, CTX)

  // Streaming: pi emits `message_update` with an AssistantMessageEvent carrying
  // text deltas. We forward only the delta text — no pi types escape.
  const offUpdate = harness.events.on("message_update", (event) => {
    const inner = event?.event
    if (inner?.type !== "text_delta") return
    const delta = typeof inner.delta === "string" ? inner.delta : ""
    if (delta.length > 0) options.onDelta?.({ runId: event.runId, delta })
  })

  const offEnd = harness.events.on("message_end", (event) => {
    options.onTurnEnd?.({ runId: event.runId ?? "", entryId: event.entryId })
  })

  return {
    laneName,
    modelLabel: `${resolved.provider ?? provider}/${resolved.id}`,

    /** Run one turn. Resolves when pi considers the turn complete. */
    async prompt(text) {
      const result = await lane.prompt(text, undefined, CTX)
      return { stopReason: result?.stopReason ?? "unknown" }
    },

    async tipId() {
      return lane.getTipId(CTX)
    },

    async stats() {
      return session.getStats(CTX)
    },

    async close() {
      offUpdate?.()
      offEnd?.()
      await harness.close(CTX)
    },
  }
}
