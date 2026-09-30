// host/basics — what nearly every module of the host's shell takes, and how
// it reports a failure.

import type { LaneName } from "@pineta/core"
import { readThreadName } from "@pineta/reads"
import type { SessionDocHandle } from "@pineta/schema"

export interface Basics {
  readonly doc: SessionDocHandle
  readonly log: (message: string) => void
  readonly newId: () => string
  readonly now: () => number
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * A `.catch` handler that logs `[host] <thread>: <what> failed: <message>`,
 * or `[host] <what> failed: <message>` with no lane.
 */
export function failed(
  basics: Pick<Basics, "doc" | "log">,
  what: string,
  lane?: LaneName,
): (error: unknown) => void {
  return error =>
    basics.log(
      lane === undefined
        ? `[host] ${what} failed: ${messageOf(error)}`
        : `[host] ${readThreadName(basics.doc, lane)}: ${what} failed: ${messageOf(error)}`,
    )
}
