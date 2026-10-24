// host/work/memory-holds — a lane's start and its tool calls waiting for the
// machine's leave while memory is short. A run's start waits in its queue
// step, so it holds the lane's queue: a Stop, its run's end or the host's
// close aborts it, or what queues behind it (the run's turn, a Stop's stop)
// would wait for room. The run's turn queued there is awaited by pi's loop,
// so a run whose start is held waits whole from its first reply's end. A
// start asked from a step of the documents' keeper refuses instead: that
// keeper's steps must never wait at the gate, or the sample that would let
// the lane go may wait behind them.

import type { ThreadId } from "@pinetrie/core"
import { KeeperClosed } from "@pinetrie/keeper"
import type { LaneActivity } from "@pinetrie/machine"

/** What lanes ask of the machine they run on while memory is short, and tell it of their calls. */
export interface LaneMachineAsks extends LaneGate {
  /** A run on `lane` is starting: the order runs start in, for which lanes matter most. */
  noteRunStarted(lane: ThreadId): void
  /** A `bash` call on `lane` past its gate; what it returns is called with how it ended. */
  shellStarted(lane: ThreadId, command: string): (outcome: string) => void
}

/** The machine's leave for a lane's activity: both answers from one object, so they agree. */
export interface LaneGate {
  /** Settles once the machine lets `lane` do `activity`; rejects on `signal`'s abort. */
  waitUntilAllowed(
    lane: ThreadId,
    activity: LaneActivity,
    signal: AbortSignal | undefined,
  ): Promise<void>
  /** Whether the machine lets `lane` do `activity` now. */
  isLaneActivityAllowed(lane: ThreadId, activity: LaneActivity): boolean
}

/** The gate before the machine is watched, and on a host that watches none. */
export const EVERYTHING_ALLOWED: LaneGate = {
  waitUntilAllowed: async () => {},
  isLaneActivityAllowed: () => true,
}

/** `work`, or `signal`'s reason as soon as it aborts, whichever comes first. */
export function settledOrAborted<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    work.then(
      value => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

/**
 * What a held start came to: `started`, or `start-held`, nothing started:
 * the machine held it when its step ran (`refuse`), or its wait was
 * aborted first (`wait`), which is no failure.
 */
export type StartAnswer = "started" | "start-held"

export interface StartHolds {
  /**
   * A start asked for `lane`, now, before its queue step runs: a start
   * still waiting for the lane is aborted. Returns what the step runs:
   * `start` once the machine lets the lane start. With `wait`, the step
   * waits for that, and the run is noted started at once, so a held start
   * is ranked by it; with `refuse`, a start the machine holds when the step
   * runs starts nothing, is noted nowhere, and the step ends at once.
   */
  holdStart(
    lane: ThreadId,
    whenHeld: "wait" | "refuse",
  ): (start: () => Promise<void>) => Promise<StartAnswer>
  /** `lane`'s run is stopped or has ended: its start waiting, if any, starts nothing. */
  abandon(lane: ThreadId): void
  /** The host is closing: every start waiting starts nothing. */
  close(): void
}

export function createStartHolds(
  machine: LaneGate & Pick<LaneMachineAsks, "noteRunStarted">,
): StartHolds {
  const waiting = new Map<ThreadId, AbortController>()
  return {
    holdStart(lane, whenHeld) {
      waiting.get(lane)?.abort()
      if (whenHeld === "refuse") {
        waiting.delete(lane)
        return async start => {
          if (!machine.isLaneActivityAllowed(lane, "container-start"))
            return "start-held"
          machine.noteRunStarted(lane)
          await start()
          return "started"
        }
      }
      machine.noteRunStarted(lane)
      const held = new AbortController()
      waiting.set(lane, held)
      return async start => {
        const allowed = await machine
          .waitUntilAllowed(lane, "container-start", held.signal)
          .then(
            () => true,
            (error: unknown) => {
              if (held.signal.aborted || error instanceof KeeperClosed)
                return false
              throw error
            },
          )
          .finally(() => {
            if (waiting.get(lane) === held) waiting.delete(lane)
          })
        if (!allowed) return "start-held"
        await start()
        return "started"
      }
    },
    abandon(lane) {
      waiting.get(lane)?.abort()
      waiting.delete(lane)
    },
    close() {
      for (const held of waiting.values()) held.abort()
      waiting.clear()
    },
  }
}
