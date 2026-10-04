// host/work/turns — each turn of a lane of its own, recorded (ADR-0032): its
// revision committed on the lane's queue, its disk snapshotted, its history
// fetched into your repo.

import {
  type EntryId,
  firstLine,
  type LaneName,
  messageText,
  promptOf,
  type RevisionRecord,
  snapshotId,
  type TreeIndex,
  toolLabel,
  turnEntry,
} from "@pineta/core"
import type { Keeper } from "@pineta/keeper"
import {
  bookmarkOf,
  changedPaths,
  commitTurn,
  conflictedFilesAt,
} from "@pineta/lanes"
import { planTurnRecord, REVISION, setRecord } from "@pineta/marginalia"
import type { Agent, LaneHooks } from "@pineta/pi"
import { readTreeIndex } from "@pineta/reads"
import { type Basics, failed } from "../basics.ts"
import { snapshotOnQueue } from "./disk.ts"
import type { Fetches } from "./fetch.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"

/** A revision's title: a message's first line, cut. */
const TITLE_LENGTH = 72

/** The tool calls of the message at `entry`, in order. */
function toolCallsOf(
  index: TreeIndex,
  entry: EntryId,
): { readonly name: string; readonly arguments: unknown }[] {
  const message = index.entries[entry]?.message
  const content = Array.isArray(message?.content) ? message.content : []
  return content.flatMap(p =>
    p?.type === "toolCall" && typeof p.name === "string"
      ? [{ name: p.name, arguments: p.arguments }]
      : [],
  )
}

/** The title a revision is described with: the message's first line, or its first tool. */
export function titleOf(index: TreeIndex, entry: EntryId): string {
  const text = firstLine(
    messageText(index.entries[entry]?.message),
    TITLE_LENGTH,
  )
  if (text !== "") return text
  const call = toolCallsOf(index, entry)[0]
  return call === undefined ? "turn" : toolLabel(call.name, call.arguments)
}

export interface Turns {
  /** pi's hook when a turn ends: its revision, its snapshot, its fetch. */
  turnDone: LaneHooks["turnDone"]
  /**
   * Settles when every turn record being written now has. A fork waits for
   * it, so a branch taken at a turn whose snapshot is still running gets that
   * turn's disk, not the one before.
   */
  pendingRecords(): Promise<void>
  writeRevision(record: RevisionRecord): Promise<void>
}

export function createTurns(deps: {
  readonly basics: Basics
  readonly setup: Pick<Setup, "paths">
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly agent: () => Agent
  readonly fetchLane: Fetches["fetchLane"]
}): Turns {
  const { basics, setup, registry, keeper } = deps
  const { docs } = basics
  const recording = new Set<Promise<unknown>>()

  /** A revision, in the root its lane works in (ADR-0063). */
  const writeRevision = async (record: RevisionRecord) => {
    const root = docs.rootOfLane(record.lane)
    if (root === null) throw new Error(`${record.lane} is in no root`)
    await deps.agent().writeValues([setRecord(REVISION, record, root)])
  }

  return {
    writeRevision,
    pendingRecords: async () => {
      await Promise.all([...recording])
    },
    async turnDone(lane: LaneName, tip: EntryId) {
      try {
        const record = registry.recordOf(lane)
        if (record === undefined) return
        const doc = await docs.root(record.root)
        const index = readTreeIndex(doc)
        const entry = turnEntry(index, tip)
        const isPrompt = promptOf(index, entry) === entry
        const toolCalls = toolCallsOf(index, entry).length > 0
        const paths = setup.paths
        if (!registry.isOwn(lane) || paths === null) {
          const revision = planTurnRecord({
            entry,
            lane,
            isPrompt,
            toolCalls,
            own: false,
            committed: null,
            newest: null,
            snapshot: null,
            paths: [],
            conflicts: [],
          })
          if (revision !== null) await writeRevision(revision)
          return
        }
        const handle = registry.handleOf(lane)
        const jj = registry.laneJjOf(lane)
        // The commit is queued, so it never overlaps the last turn's
        // snapshot, and awaited, so the next request sees it.
        const {
          committed,
          newest,
          paths: changed,
          conflicts,
        } = await handle.queue.enqueue(async () => {
          const before = await bookmarkOf(jj, lane)
          const made = await commitTurn(jj, {
            title: titleOf(readTreeIndex(doc), entry),
            entry,
            lane,
            bookmark: before,
          })
          // An adopted turn may be several of the agent's commits: its
          // paths run from the bookmark before it.
          const changed =
            made.commit === null
              ? []
              : await changedPaths(jj, before, made.commit)
          // The files conflicted in the commit its record names: its own,
          // else the bookmark's, which a branch from it clones (ADR-0072).
          const named = made.commit ?? before
          const conflicts =
            made.conflicted && named !== null
              ? await conflictedFilesAt(jj, named)
              : []
          return {
            committed: made.commit,
            newest: before,
            paths: changed,
            conflicts,
          }
        })
        const planned = planTurnRecord({
          entry,
          lane,
          isPrompt,
          toolCalls,
          own: true,
          committed,
          newest,
          snapshot: snapshotId(entry),
          paths: changed,
          conflicts,
        })
        if (planned === null) return
        // The snapshot is queued and not awaited: the next tool call waits
        // for it, the next request does not.
        const recorded = keeper.track(
          snapshotOnQueue(handle, paths, entry)
            .catch(error => {
              failed(basics, "the turn's snapshot", lane)(error)
              return false
            })
            .then(async snapped => {
              await writeRevision({
                ...planned,
                snapshot: snapped ? planned.snapshot : null,
              })
            })
            .catch(failed(basics, "recording a turn", lane)),
        )
        recording.add(recorded)
        void recorded.finally(() => recording.delete(recorded))
        // Queued now, straight after the snapshot, while the lane runs.
        if (committed !== null) void deps.fetchLane(lane, [newest])
      } catch (error) {
        // A missing revision only coarsens branching: the run goes on.
        failed(basics, "recording a turn", lane)(error)
      }
    },
  }
}
