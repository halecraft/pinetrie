// pi/thread-lanes — each thread's pi lane in one root's document,
// held while that root's harness is (`Scribe.release` closes it), behind
// handles that speak only pinetrie's types. A lane is never moved, and its tip
// is never read here: readers use the document.

import {
  BACKGROUND_CONTEXT,
  HarnessClosed,
} from "@earendil-works/pi-agent-core"
import {
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  type Position,
  type ThreadId,
} from "@pinetrie/core"
import type {
  AnswerMessage,
  BehindMessage,
  CanvasFactMessage,
  CanvasMessage,
  CanvasPinnedMessage,
  CarryOnMessage,
  FactMessage,
  IncomingEntriesMessage,
  PersonMessage,
  PinnedMessage,
  PromptMessage,
  SshFactMessage,
  UpdateMessage,
} from "@pinetrie/rules"
import {
  hasLaneRecord,
  type RootDocHandle,
  readLaneNames,
} from "@pinetrie/schema"
import type { createAgentHarness } from "./deep.ts"
import { threadContext } from "./thread-context.ts"
import { toolsChanged } from "./tools.ts"
import {
  type PromptSections,
  promptPatch,
  sectionsInView,
} from "./transcript-prompt.ts"

const CTX = BACKGROUND_CONTEXT

type Harness = Awaited<ReturnType<typeof createAgentHarness>>["harness"]
type PiLane = Awaited<ReturnType<Harness["lane"]>>

/** pi refused: the one refusal every lane outcome shares. */
export interface LaneRefusal {
  readonly kind: "refused"
  readonly code: ErrCode
}

/** The result of a write that runs or queues: pi may refuse to admit it. */
export type WriteOutcome = { readonly kind: "ok" } | LaneRefusal

/**
 * pi's harness closed while the run or resume was in flight. pi keeps its
 * operation open, so the next process finds the lane interrupted.
 */
export interface Interrupted {
  readonly kind: "interrupted"
}

/** The result of a resume: it ran, was cut off, or pi refused it. */
export type ResumeOutcome = { readonly kind: "ok" } | Interrupted | LaneRefusal

/** The result of a run: ran, naming the prompt's sections it changed; cut off; or refused. */
export type RunOutcome =
  | {
      readonly kind: "ok"
      /** The sections of the lane's prompt the run wrote anew; empty when none, or when the lane held no prompt before. */
      readonly promptChanged: readonly string[]
    }
  | Interrupted
  | LaneRefusal

export type AppendOutcome =
  | { readonly kind: "appended"; readonly id: EntryId }
  | LaneRefusal

export type CreateOutcome =
  | { readonly kind: "created"; readonly lane: ThreadId }
  | LaneRefusal

/**
 * pi's refusal tag as our `ErrCode`, so none of pi's vocabulary passes the
 * boundary. The host never writes to a running lane, but after a crash or a
 * stop pi holds the interrupted operation open, and the lane is `LaneBusy`
 * until it is resumed.
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
const BUSY: LaneRefusal = { kind: "refused", code: ERR.BUSY }
const OK: WriteOutcome = { kind: "ok" }
const INTERRUPTED: Interrupted = { kind: "interrupted" }

/**
 * `drive`'s result, or `INTERRUPTED` when pi's harness closed under it. pi
 * rejects with `HarnessClosed` only for a close during the call: a drive's
 * operation stays open, and a close during its admission leaves a mark the
 * next start finds nothing behind and clears. A close before the call is
 * pi's `Closed`, a refusal; a call on a harness rebuilt after it faults.
 */
async function driven(
  drive: Promise<PiResult>,
): Promise<PiResult | Interrupted> {
  try {
    return await drive
  } catch (error) {
    if (error instanceof HarnessClosed) return INTERRUPTED
    throw error
  }
}

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

/** pi's spelling of a position, which uses `null` for the root. */
export const toPi = (p: Position): string | null =>
  p.kind === "root" ? null : p.id

/** What a run or a resume returns: pi's `Result`, refused by a tag. */
type PiResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly _tag: string } }

/**
 * What goes into a run's commit before its prompt (`ThreadLaneHandle.run`):
 * what an asked agent heard of the thread that asked, a base's news, and the
 * context entries.
 */
export type BeforePrompt =
  | IncomingEntriesMessage
  | BehindMessage
  | PinnedMessage
  | CanvasPinnedMessage
  | CanvasMessage

/**
 * A thread's lane. It is never moved: it advances only by its own appends and
 * runs, so its tip stays its thread's end. The host touches it only while it
 * is idle: a message appended to a running lane lands at a moment no one
 * chose.
 */
export interface ThreadLaneHandle {
  readonly name: ThreadId
  /**
   * Whether pi holds an operation open on the lane that no run or resume of
   * this process drives: one a crash or a stop cut off. False for a lane this
   * process drives, whose open operation is its own run's, and which is not
   * inspected; false for an unknown lane.
   */
  isLeftOpen(): Promise<boolean>
  /**
   * Append with no run, through the pi `Lane`: it plans from its own cached
   * tip, so a write that bypasses it would be dropped from its next turn.
   * A chat, or a host's fact: an update, what a command on the thread's
   * proposed changes did, or its ssh news. Refused `busy` on a lane left
   * open, where pi would queue it in the operation's inbox, which only a
   * resume delivers, as a turn no one asked for. On a lane this process
   * drives, pi queues it into the run in flight.
   */
  append(
    message:
      | PersonMessage
      | UpdateMessage
      | FactMessage
      | AnswerMessage
      | CarryOnMessage
      | SshFactMessage,
  ): Promise<AppendOutcome>
  /**
   * Run one turn with `message` as the prompt itself. What of the lane's
   * prompt changed goes in first, as a system message (`promptPatch`), then
   * `before`, in order: a base's news and a cards entry, which stays the
   * prompt's parent. pi writes them all in the commit that admits the run, or
   * none.
   */
  run(
    message: PromptMessage,
    before: readonly BeforePrompt[],
  ): Promise<RunOutcome>
  /**
   * Tell a running lane something that changed while it runs: its base has
   * new work, a card was added to or taken from its canvas, an agent it
   * asked answered, or its owner answered its ssh request. pi places the message after the tool results of the
   * turn in flight, at its next boundary, appended, so the prompt cache
   * holds. A steer that arrives after the run's last tool call makes one
   * more request.
   */
  steer(
    message:
      | BehindMessage
      | CanvasFactMessage
      | AnswerMessage
      | CarryOnMessage
      | SshFactMessage,
  ): Promise<WriteOutcome>
  /** Resume the operation a crash or a stop cut off, in the lane's own directory. */
  resume(): Promise<ResumeOutcome>
  /**
   * End the lane's running turn. A tool running is aborted, and its result
   * recorded as aborted; the lane then takes its next message.
   */
  abort(): Promise<void>
}

export interface ThreadLanes {
  /**
   * Create a thread's lane at `at`, named `lane` (the host decides the id).
   * Called only where no lane is; refused `lane-id-in-use` for an id pi
   * holds, since `harness.lane` would return that lane instead.
   */
  createThreadLane(at: Position, lane: ThreadId): Promise<CreateOutcome>
  lane(name: ThreadId): ThreadLaneHandle
  /** Lanes pi holds an operation open on: a crash or a stop cut them off. */
  interrupted(skip?: (lane: ThreadId) => boolean): Promise<readonly ThreadId[]>
}

export function threadLanes(input: {
  readonly harness: Harness
  /** The root's document the harness is over: its lanes' records are there. */
  readonly doc: RootDocHandle
  /** Record the lane's last turn: awaited after each run. */
  readonly recordTurn: (lane: ThreadId) => Promise<void>
  /** The tools every lane's runs may call; null when the agent has no tools. */
  readonly activeTools: readonly string[] | null
  /** The prompt a run of the lane is told now, as its named sections. */
  readonly promptSections: (lane: ThreadId) => PromptSections
}): ThreadLanes {
  const { harness, doc } = input
  const held = new Map<ThreadId, PiLane>()
  /** Lanes with a run or resume of this process in flight. */
  const driving = new Set<ThreadId>()

  /** Whether `lane` holds an operation no drive of this process runs. */
  const leftOpen = async (name: ThreadId, lane: PiLane): Promise<boolean> =>
    !driving.has(name) && (await lane.inspectExecution(CTX)).current !== null

  /**
   * A thread's pi lane: held, or restored after a restart. Checked against the
   * document first, because `harness.lane(name)` would CREATE a missing lane.
   * A restored lane stored with another tool list is given the current one,
   * once: a new lane takes it from the harness's seed.
   */
  async function existing(name: ThreadId): Promise<PiLane | undefined> {
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
    name: ThreadId,
    f: (lane: PiLane) => Promise<T | LaneRefusal>,
  ): Promise<T | LaneRefusal> {
    const lane = await existing(name)
    return lane === undefined ? UNKNOWN : f(lane)
  }

  function handle(name: ThreadId): ThreadLaneHandle {
    const ctx = threadContext(name, CTX)
    // A run that pi admitted and that then failed is still "ok" here: it
    // ran. Only an admission refusal is `refused`. A cut-off drive records
    // no turn: the process that resumes it does.
    const turn = <T>(
      start: (lane: PiLane) => Promise<{
        readonly result: PiResult | Interrupted
        readonly ok: T
      }>,
    ) =>
      onLane<T | Interrupted | LaneRefusal>(name, async lane => {
        driving.add(name)
        try {
          const { result, ok } = await start(lane)
          if (!("ok" in result)) return result
          if (!result.ok) return refusedBy(result.error._tag)
          await input.recordTurn(name)
          return ok
        } finally {
          driving.delete(name)
        }
      })
    return {
      name,
      isLeftOpen: async () => {
        const lane = await existing(name)
        return lane !== undefined && leftOpen(name, lane)
      },
      append: message =>
        onLane<AppendOutcome>(name, async lane =>
          (await leftOpen(name, lane))
            ? BUSY
            : orRefused(async () => ({
                kind: "appended",
                id: entryId(await lane.appendMessage(message, ctx)),
              })),
        ),
      run: (message, before) =>
        turn<RunOutcome>(async lane => {
          // gather: the entries the run's first request reads, as pi scans them
          const entries = await lane.findEntries(
            { stopAtType: "compaction", order: "newestFirst" },
            ctx,
          )
          // plan
          const patch = promptPatch(
            sectionsInView(entries.reverse()),
            input.promptSections(name),
            Date.now(),
          )
          const first = patch === null ? [] : [patch.message]
          // execute
          const messages = [...first, ...before]
          const result = await driven(
            lane.prompt(
              messages.length === 0 ? message : [...messages, message],
              ctx,
            ),
          )
          return {
            result,
            ok: { kind: "ok", promptChanged: patch?.changed ?? [] },
          }
        }),
      steer: message =>
        onLane<WriteOutcome>(name, async lane => {
          const queued = await lane.steer(message, undefined, ctx)
          return queued.ok ? OK : refusedBy(queued.error._tag)
        }),
      // pi records a tool call a crash or a stop cut off as interrupted,
      // never running it again; the run then continues in the lane's
      // directory.
      resume: () =>
        turn<ResumeOutcome>(async lane => ({
          result: await driven(lane.resume(ctx)),
          ok: OK,
        })),
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

    async interrupted(skip) {
      const out: ThreadId[] = []
      for (const name of readLaneNames(doc)) {
        if (skip?.(name) === true) continue
        const lane = await existing(name)
        if (lane !== undefined && (await leftOpen(name, lane))) out.push(name)
      }
      return out
    },
  }
}
