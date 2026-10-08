// pi/thread-lanes — each thread's pi lane (ADR-0120) in one root's document,
// held while that root's harness is (`Scribe.release` closes it), behind
// handles that speak only pinetrie's types. A lane is never moved, and its tip
// is never read here: readers use the document.

import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core"
import {
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type LaneName,
  type Position,
} from "@pinetrie/core"
import type {
  BehindMessage,
  ChatMessage,
  FactMessage,
  PinnedMessage,
  PromptMessage,
  UpdateMessage,
} from "@pinetrie/rules"
import {
  hasLaneRecord,
  type RootDocHandle,
  readLaneNames,
} from "@pinetrie/schema"
import type { createAgentHarness } from "./deep.ts"
import { laneContext } from "./lanes.ts"
import { toolsChanged } from "./tools.ts"

const CTX = BACKGROUND_CONTEXT

type Harness = Awaited<ReturnType<typeof createAgentHarness>>["harness"]
type PiLane = Awaited<ReturnType<Harness["lane"]>>

/** pi refused: the one refusal every lane outcome shares. */
export interface LaneRefusal {
  readonly kind: "refused"
  readonly code: ErrCode
}

/** The result of a run: pi may refuse to admit it. */
export type WriteOutcome = { readonly kind: "ok" } | LaneRefusal

export type AppendOutcome =
  | { readonly kind: "appended"; readonly id: EntryId }
  | LaneRefusal

export type CreateOutcome =
  | { readonly kind: "created"; readonly lane: LaneName }
  | LaneRefusal

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

const refusedBy = (tag: string): LaneRefusal => ({
  kind: "refused",
  code: laneErrCode(tag),
})

const UNKNOWN: LaneRefusal = { kind: "refused", code: ERR.UNKNOWN_TARGET }
const OK: WriteOutcome = { kind: "ok" }

/**
 * `f`'s result, or the refusal for a pi TaggedError it throws. Where most of
 * pi's API returns a `Result`, `appendMessage` and `harness.lane` throw.
 * Anything without a tag is not a refusal, and is thrown on.
 */
async function orRefused<T>(f: () => Promise<T>): Promise<T | LaneRefusal> {
  try {
    return await f()
  } catch (error) {
    const tag = (error as { _tag?: unknown } | null)?._tag
    if (typeof tag === "string") return refusedBy(tag)
    throw error
  }
}

/** Position -> pi's spelling of it, which uses `null` for the root. */
export const toPi = (p: Position): string | null =>
  p.kind === "root" ? null : p.id

/** What a run or a resume returns: pi's `Result`, refused by a tag. */
type PiResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly _tag: string } }

/** What goes into a run's commit before its prompt (`ThreadLaneHandle.run`). */
export type BeforePrompt = BehindMessage | PinnedMessage

/**
 * A thread's lane (ADR-0120). It is never moved: it advances only by its own
 * appends and runs, so its tip stays its thread's end. The host touches it only
 * while it is idle (S21).
 */
export interface ThreadLaneHandle {
  readonly name: LaneName
  /**
   * Append with no run, through the pi `Lane`: it plans from its own cached
   * tip, so a write that bypasses it would be dropped from its next turn (S19).
   * A chat, or a host's fact: an update (ADR-0105), or what a command on the
   * thread's offer did (ADR-0080).
   */
  append(
    message: ChatMessage | UpdateMessage | FactMessage,
  ): Promise<AppendOutcome>
  /**
   * Run one turn with `message` as the prompt itself (S19). `before` goes
   * in first, in order: a base's news (ADR-0080) and a cards entry, which
   * stays the prompt's parent. pi writes them all in the commit that admits
   * the run, or none (S92).
   */
  run(
    message: PromptMessage,
    before: readonly BeforePrompt[],
  ): Promise<WriteOutcome>
  /**
   * Tell a running lane its base has new work (ADR-0080, S103 item 4): pi
   * places the message after the tool results of the turn in flight, at its
   * next boundary, appended, so the prompt cache holds. A steer that arrives
   * after the run's last tool call makes one more request.
   */
  steer(message: BehindMessage): Promise<WriteOutcome>
  /** Resume the operation a crash interrupted, in the lane's own directory. */
  resume(): Promise<WriteOutcome>
  /**
   * End the lane's running turn. A tool running is aborted, and its result
   * recorded as aborted (S22); the lane then takes its next message.
   */
  abort(): Promise<void>
}

export interface ThreadLanes {
  /**
   * Create a thread's lane at `at`, named `lane` (the host decides the id,
   * ADR-0057). Called only where no lane is; refused `lane_id_in_use` for an id
   * pi holds, since `harness.lane` would return that lane instead.
   */
  createThreadLane(at: Position, lane: LaneName): Promise<CreateOutcome>
  lane(name: LaneName): ThreadLaneHandle
  /** Lanes pi holds an operation open on: a crash interrupted them. */
  interrupted(): Promise<readonly LaneName[]>
}

export function threadLanes(input: {
  readonly harness: Harness
  /** The root's document the harness is over: its lanes' records are there. */
  readonly doc: RootDocHandle
  /** Record the lane's last turn: awaited after each run. */
  readonly recordTurn: (lane: LaneName) => Promise<void>
  /** The tools every lane's runs may call; null when the agent has no tools. */
  readonly activeTools: readonly string[] | null
}): ThreadLanes {
  const { harness, doc } = input
  const held = new Map<LaneName, PiLane>()

  /**
   * A thread's pi lane: held, or restored after a restart. Checked against the
   * document first, because `harness.lane(name)` would CREATE a missing lane.
   * A restored lane stored with another tool list is given the current one,
   * once: a new lane takes it from the harness's seed.
   */
  async function existing(name: LaneName): Promise<PiLane | undefined> {
    const cached = held.get(name)
    if (cached !== undefined) return cached
    if (!hasLaneRecord(doc, name)) return undefined
    const lane = await harness.lane(name, CTX)
    const tools = input.activeTools
    if (tools !== null && toolsChanged(await lane.getActiveTools(CTX), tools))
      await lane.setActiveTools([...tools], CTX)
    held.set(name, lane)
    return lane
  }

  async function onLane<T>(
    name: LaneName,
    f: (lane: PiLane) => Promise<T | LaneRefusal>,
  ): Promise<T | LaneRefusal> {
    const lane = await existing(name)
    return lane === undefined ? UNKNOWN : f(lane)
  }

  function handle(name: LaneName): ThreadLaneHandle {
    const ctx = laneContext(name, CTX)
    // A run that pi admitted and that then failed is still "ok" here: it
    // ran. Only an admission refusal is `refused`.
    const turn = (start: (lane: PiLane) => Promise<PiResult>) =>
      onLane<WriteOutcome>(name, async lane => {
        const result = await start(lane)
        if (!result.ok) return refusedBy(result.error._tag)
        await input.recordTurn(name)
        return OK
      })
    return {
      name,
      append: message =>
        onLane<AppendOutcome>(name, lane =>
          orRefused(async () => ({
            kind: "appended",
            id: entryId(await lane.appendMessage(message, ctx)),
          })),
        ),
      run: (message, before) =>
        turn(lane =>
          lane.prompt(
            before.length === 0 ? message : [...before, message],
            ctx,
          ),
        ),
      steer: message =>
        onLane<WriteOutcome>(name, async lane => {
          const queued = await lane.steer(message, undefined, ctx)
          return queued.ok ? OK : refusedBy(queued.error._tag)
        }),
      // pi records a tool call the crash interrupted as interrupted, never
      // running it again; the run then continues in the lane's directory.
      resume: () => turn(lane => lane.resume(ctx)),
      async abort() {
        const lane = await existing(name)
        if (lane !== undefined) await lane.abort(ctx)
      },
    }
  }

  return {
    lane: handle,

    async createThreadLane(at, name) {
      if (held.has(name) || hasLaneRecord(doc, name))
        return { kind: "refused", code: ERR.LANE_ID_IN_USE }
      return orRefused(async () => {
        held.set(name, await harness.lane(name, { createAt: toPi(at) }, CTX))
        return { kind: "created", lane: name } as const
      })
    },

    async interrupted() {
      const out: LaneName[] = []
      for (const name of readLaneNames(doc)) {
        const lane = await existing(name)
        if (lane === undefined) continue
        const info = await lane.inspectExecution(CTX)
        if (info.current !== null) out.push(name)
      }
      return out
    },
  }
}
