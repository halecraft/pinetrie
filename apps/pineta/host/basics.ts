// host/basics — what nearly every module of the host's shell takes, and how
// it reports a failure.

import type { LaneName } from "@pineta/core"
import { readThreadName } from "@pineta/reads"
import type {
  LiveDocHandle,
  PlacesDocHandle,
  SessionDocHandle,
} from "@pineta/schema"
import type { HostDocuments } from "./docs.ts"
import { SerialClosed } from "./queue.ts"

export interface Basics {
  /** The session's records, the directory of roots among them (ADR-0063). */
  readonly session: SessionDocHandle
  /** What is streaming now (ADR-0063): which lanes run, and their streams. */
  readonly live: LiveDocHandle
  /** Every document, each root's among them (`docs.ts`). */
  readonly docs: HostDocuments
  /**
   * Where every card is (ADR-0059): what is queued for each lane. Written
   * only through `applyPlaceStep` (`places.ts`).
   */
  readonly places: PlacesDocHandle
  readonly log: (message: string) => void
  readonly newId: () => string
  readonly now: () => number
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * A `.catch` handler that logs `[host] <thread>: <what> failed: <message>`,
 * or `[host] <what> failed: <message>` with no lane. A step a closed
 * `Serial` refused is not logged: shutdown refuses them on purpose.
 */
export function failed(
  basics: Pick<Basics, "session" | "log">,
  what: string,
  lane?: LaneName,
): (error: unknown) => void {
  return error => {
    if (error instanceof SerialClosed) return
    basics.log(
      lane === undefined
        ? `[host] ${what} failed: ${messageOf(error)}`
        : `[host] ${readThreadName(basics.session, lane)}: ${what} failed: ${messageOf(error)}`,
    )
  }
}
