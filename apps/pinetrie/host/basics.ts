// host/basics — what nearly every module of the host's shell takes, and how
// it reports a failure.

import { errorText, type RootId, type ThreadId } from "@pinetrie/core"
import { type Keeper, KeeperClosed, type SlowStep } from "@pinetrie/keeper"
import { readThreadName } from "@pinetrie/reads"
import type {
  LiveDocHandle,
  PlacesDocHandle,
  SessionDocHandle,
} from "@pinetrie/schema"
import type { HostDocuments } from "./docs.ts"

export interface Basics {
  /** The session's records, the directory of roots among them. */
  readonly session: SessionDocHandle
  /** What is streaming now: which lanes run, and their streams. */
  readonly live: LiveDocHandle
  /** Every document, each root's among them (`docs.ts`). */
  readonly docs: HostDocuments
  /**
   * Where every card is: what is queued for each lane. Written only in a
   * change of the writer of the places (`places.ts`).
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
export type HostKey = `drain:${ThreadId}` | `root:${RootId}` | "compact"

/** The documents' keeper: every command, drain and write of the host's. */
export type HostKeeper = Keeper<HostKey>

/**
 * A `.catch` handler that logs `[host] <thread>: <what> failed: <error>`,
 * or `[host] <what> failed: <error>` with no lane. A step a closed
 * keeper refused is not logged: shutdown refuses them on purpose.
 */
export function failed(
  basics: Pick<Basics, "session" | "log">,
  what: string,
  lane?: ThreadId,
): (error: unknown) => void {
  return error => {
    if (error instanceof KeeperClosed) return
    basics.log(
      lane === undefined
        ? `[host] ${what} failed: ${errorText(error)}`
        : `[host] ${readThreadName(basics.session, lane)}: ${what} failed: ${errorText(error)}`,
    )
  }
}

/**
 * An `onSlow` handler that logs `[host] <where>: a step (<key>) waited <n> ms
 * and ran <n> ms`, with no `<where>: ` for the documents' keeper.
 */
export function slow(
  basics: Pick<Basics, "log">,
  where?: string,
): (step: SlowStep) => void {
  return s =>
    basics.log(
      `[host] ${where === undefined ? "" : `${where}: `}a step${s.key === null ? "" : ` (${s.key})`} waited ${Math.round(s.waited)} ms and ran ${Math.round(s.ran)} ms`,
    )
}
