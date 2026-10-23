// host/machine/shell-calls — each lane's `bash` calls as the host's shell
// sees them, from the lane access's two hooks: the program in flight, for
// the memory rungs' plan, and each call's duration, timed on the host after
// its gate, for the measurements. The lane's helper is not asked.

import type { ThreadId } from "@pinetrie/core"
import { commandProgram } from "@pinetrie/machine"

/** A `bash` call that ended, as the measurements keep it. */
export interface ShellCallEnded {
  readonly lane: ThreadId
  readonly program: string | null
  /** When it started, by the host's clock, in ms. */
  readonly startedAt: number
  readonly durationMs: number
  readonly outcome: string
}

export interface ShellCalls {
  /**
   * A call on `lane` past its gate; returns what its end calls, with how it
   * ended (`ShellEnd`'s kind).
   */
  shellStarted(lane: ThreadId, command: string): (outcome: string) => void
  /** The program of `lane`'s latest call still running; null between calls. */
  programInFlight(lane: ThreadId): string | null
}

export function createShellCalls(deps: {
  readonly now: () => number
  readonly ended: (call: ShellCallEnded) => void
}): ShellCalls {
  /** Each lane's calls in flight, in the order they started. */
  const inFlight = new Map<ThreadId, { readonly program: string | null }[]>()
  return {
    shellStarted(lane, command) {
      const call = { program: commandProgram(command) }
      const startedAt = deps.now()
      inFlight.set(lane, [...(inFlight.get(lane) ?? []), call])
      let ended = false
      return outcome => {
        if (ended) return
        ended = true
        const left = (inFlight.get(lane) ?? []).filter(c => c !== call)
        if (left.length === 0) inFlight.delete(lane)
        else inFlight.set(lane, left)
        deps.ended({
          lane,
          program: call.program,
          startedAt,
          durationMs: deps.now() - startedAt,
          outcome,
        })
      }
    },
    programInFlight: lane => inFlight.get(lane)?.at(-1)?.program ?? null,
  }
}
