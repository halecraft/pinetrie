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
import { ERR, type ErrCode, type LaneName } from "@pineta/core"
import type { SessionDocHandle } from "@pineta/schema"
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
  readonly peerId: string
  /** Branded (ADR-0011): only `laneNameForWriter` can mint one. */
  readonly laneName: LaneName
  readonly provider: string
  readonly model: string
  readonly onDelta?: (event: { runId: string; delta: string }) => void
  readonly onTurnEnd?: (event: { runId: string; entryId?: string }) => void
}

/**
 * The narrow facade host/ sees. Declared explicitly rather than inferred, so
 * that "no pi type crosses this boundary" is a checked property of the
 * signature instead of a convention: every member below is a string, a
 * promise of our own shapes, or void.
 */
/**
 * pi's navigation error -> our `ErrCode`, as a value.
 *
 * Pure, so it is unit-testable without a harness, a model, or a document. Same
 * extraction as `orderNewEntries` and `toStoredRow`: the calculation leaves
 * the shell. pi's errors are TaggedError classes and `_tag` is the
 * discriminant.
 */
export function navigationErrCode(tag: string): ErrCode {
  if (tag === "UnknownTarget") return ERR.UNKNOWN_TARGET
  if (tag === "InvalidNavigation") return ERR.INVALID_NAVIGATION
  if (tag === "LaneBusy") return ERR.BUSY
  return ERR.INVALID_NAVIGATION
}

const navigationStatus = (error: { _tag: string }): string =>
  `rejected:${navigationErrCode(error._tag)}`

export interface Agent {
  readonly laneName: LaneName
  readonly modelLabel: string
  /**
   * Run one turn. Resolves when pi considers the turn complete.
   *
   * `status` is pi's own terminal status (`completed` / `declined` / `aborted`
   * / `failed`), or `suspended`, or `rejected` when the lane refused the run.
   * The pre-TypeScript version of this read `result.stopReason`, which does
   * not exist on `RunResult` \u2014 so it reported `"unknown"` on every single
   * turn, including failures. See the note in the implementation.
   */
  /**
   * Run a turn. `parentId` null appends at the lane tip; a string navigates
   * there first, so the turn forks from that entry.
   *
   * One method rather than a separate `branch()`: both map pi's `RunResult`
   * the same way, and a duplicated mapping is where "navigation succeeded but
   * the prompt failed" gets handled in one copy and not the other.
   */
  run(
    text: string,
    parentId: string | null,
  ): Promise<{ ok: boolean; status: string }>

  /**
   * Move the lane tip without running a turn.
   *
   * pi treats tree navigation as an operation in its own right; wrapping only
   * the navigate-then-prompt half was arbitrary. Moving back to a previous tip
   * is a navigation with no prompt, and a lane that has branched needs it.
   */
  navigate(targetId: string | null): Promise<{ ok: boolean; status: string }>
  tipId(): Promise<string | null>
  stats(): Promise<{ messageCount: number }>
  close(): Promise<void>
}

/**
 * Build the whole pi stack over a caller-supplied Kyneta document, and return a
 * narrow facade.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
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
  const offUpdate = harness.events.on("message_update", event => {
    const inner = event.event
    if (inner.type !== "text_delta") return
    const delta = typeof inner.delta === "string" ? inner.delta : ""
    if (delta.length > 0) options.onDelta?.({ runId: event.runId, delta })
  })

  const offEnd = harness.events.on("message_end", event => {
    options.onTurnEnd?.({ runId: event.runId ?? "", entryId: event.entryId })
  })

  return {
    laneName,
    modelLabel: `${resolved.provider ?? provider}/${resolved.id}`,

    async run(text: string, parentId: string | null) {
      if (parentId !== null) {
        // pi owns the tree operation. `lane.prompt` has no parent parameter —
        // it always appends at the lane tip — so branching is "move the tip,
        // then prompt", which is exactly what navigateTree is for.
        const moved = await lane.navigateTree(parentId, {}, CTX)
        if (!moved.ok) {
          return { ok: false, status: navigationStatus(moved.error) }
        }
      }
      // `RunResult` is a Result union — `{ ok: true, value } | { ok: false,
      // error }` — where `value` is an OperationResultRecord or a SuspendedRun.
      // There is no `stopReason` on any branch, which is why the previous
      // `result?.stopReason ?? "unknown"` silently reported "unknown" forever.
      const result = await lane.prompt(text, undefined, CTX)
      if (!result.ok) {
        // pi's errors are TaggedError classes; `_tag` is the discriminant.
        return { ok: false, status: `rejected:${result.error._tag}` }
      }
      return { ok: true, status: result.value.status }
    },

    async navigate(targetId: string | null) {
      const moved = await lane.navigateTree(targetId, {}, CTX)
      return moved.ok
        ? { ok: true, status: "navigated" }
        : { ok: false, status: navigationStatus(moved.error) }
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
