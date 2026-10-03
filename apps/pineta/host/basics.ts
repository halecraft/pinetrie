// host/basics — what nearly every module of the host's shell takes, and how
// it reports a failure.

import type { LaneName, RootId } from "@pineta/core"
import { type Keeper, KeeperClosed } from "@pineta/keeper"
import { readThreadName } from "@pineta/reads"
import type {
  LiveDocHandle,
  PlacesDocHandle,
  SessionDocHandle,
} from "@pineta/schema"
import type { HostDocuments } from "./docs.ts"

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

/**
 * What the documents' keeper merges by: a lane's drain, a root's directory
 * record, and the compaction.
 */
export type HostKey = `drain:${LaneName}` | `root:${RootId}` | "compact"

/** The documents' keeper: every command, drain and write of the host's. */
export type HostKeeper = Keeper<HostKey>

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * A `.catch` handler that logs `[host] <thread>: <what> failed: <message>`,
 * or `[host] <what> failed: <message>` with no lane. A step a closed
 * keeper refused is not logged: shutdown refuses them on purpose.
 */
export function failed(
  basics: Pick<Basics, "session" | "log">,
  what: string,
  lane?: LaneName,
): (error: unknown) => void {
  return error => {
    if (error instanceof KeeperClosed) return
    basics.log(
      lane === undefined
        ? `[host] ${what} failed: ${messageOf(error)}`
        : `[host] ${readThreadName(basics.session, lane)}: ${what} failed: ${messageOf(error)}`,
    )
  }
}
