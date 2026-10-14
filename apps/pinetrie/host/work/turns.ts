// host/work/turns — each turn of a lane of its own, recorded: its revision
// committed on the lane's queue (`LaneHistory.recordTurn`), its disk classed
// and snapshotted (`disk.ts`), then what its adapter does after a turn
// (`TurnMade.follow`).

import {
  type CommitId,
  type EntryId,
  firstLine,
  messageText,
  NO_SHARED,
  nearestRevision,
  promptOf,
  type RevisionRecord,
  type SnapshotId,
  snapshotId,
  type ThreadId,
  type TreeIndex,
  toolCallsOf,
  turnEntry,
  turnMerged,
} from "@pinetrie/core"
import { callLabel } from "@pinetrie/interface"
import type { Keeper } from "@pinetrie/keeper"
import { executeOrThrow, type Follow, planSnapshot } from "@pinetrie/lanes"
import type { LaneHooks } from "@pinetrie/pi"
import { readRevisions, readTreeIndex } from "@pinetrie/reads"
import { planTurnRecord, REVISION, setRecord } from "@pinetrie/rules"
import { type Basics, failed } from "../basics.ts"
import type { Records } from "../records.ts"
import { classifyWritesOnQueue, diskOfTurn } from "./disk.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { SharedLineages } from "./shared.ts"

/** A revision's title: a message's first line, cut. */
const TITLE_LENGTH = 72

/** The title a revision is described with: the message's first line, or its first call in words (`callLabel`). */
export function titleOf(index: TreeIndex, entry: EntryId): string {
  const text = firstLine(
    messageText(index.entries[entry]?.message),
    TITLE_LENGTH,
  )
  if (text !== "") return text
  const call = toolCallsOf(index.entries[entry]?.message)[0]
  return call === undefined ? "turn" : callLabel(call, "cut")
}

/**
 * A turn's end, queued: its snapshot step, then what follows its commit,
 * fired once the step is queued, so the work behind it (for jj, the fetch
 * into your repo) runs after the snapshot, never before it on the lane's
 * queue.
 */
export function queueTurnEnd<T>(queueSnapshot: () => T, follow: Follow): T {
  const ended = queueSnapshot()
  follow?.()
  return ended
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

/** A lane's disk at a revision: its snapshot, and the commit with it. */
interface Disk {
  readonly snapshot: SnapshotId
  readonly commit: CommitId | null
}

export function createTurns(deps: {
  readonly basics: Basics
  readonly setup: Pick<Setup, "configs" | "ready">
  readonly registry: LaneRegistry
  /** Work nobody awaits: `quiet` waits for it. */
  readonly keeper: Keeper
  readonly records: Pick<Records, "writeValues">
  readonly shared: SharedLineages
}): Turns {
  const { basics, registry, keeper } = deps
  const { docs } = basics
  const recording = new Set<Promise<unknown>>()
  /** Each lane's newest snapshot this host planned, and the commit with it: the next turn's diff starts there. */
  const last = new Map<ThreadId, Disk>()

  /** With none planned since the host started: the nearest snapshot above the turn. */
  const nearestBefore = (
    index: TreeIndex,
    doc: Parameters<typeof readRevisions>[0],
    entry: EntryId,
  ): Disk | null => {
    const above = nearestRevision(index, readRevisions(doc), {
      kind: "entry",
      id: entry,
    })
    return above.snapshot === null
      ? null
      : { snapshot: above.snapshot, commit: above.commit }
  }

  /** A revision, in the root its lane works in. */
  const writeRevision = async (record: RevisionRecord) => {
    const root = docs.rootOfLane(record.lane)
    if (root === null) throw new Error(`${record.lane} is in no root`)
    await deps.records.writeValues([setRecord(REVISION, record, root)])
  }

  return {
    writeRevision,
    pendingRecords: async () => {
      await Promise.all([...recording])
    },
    async turnDone(lane: ThreadId, tip: EntryId) {
      try {
        const record = registry.recordOf(lane)
        if (record === undefined) return
        const doc = await docs.root(record.root)
        const index = readTreeIndex(doc)
        const entry = turnEntry(index, tip)
        const isPrompt = promptOf(index, entry) === entry
        const toolCalls = toolCallsOf(index.entries[entry]?.message).length > 0
        // A `catch_up` in the turn moved the bookmark: read from the tree, so a
        // restart before this record changes nothing.
        const merged = turnMerged(index, tip)
        if (!registry.isOwn(lane)) {
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
            merged: false,
          })
          if (revision !== null) await writeRevision(revision)
          return
        }
        const handle = registry.handleOf(lane)
        // The commit is queued, so it never overlaps the last turn's
        // snapshot, and awaited, so the next request sees it.
        const {
          committed,
          newest,
          paths: changed,
          conflicts,
          follow,
        } = await registry.withHistory(lane, h =>
          h.recordTurn({ title: titleOf(readTreeIndex(doc), entry), entry }),
        )
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
          merged,
        })
        if (planned === null) return
        const previous = isPrompt
          ? null
          : (last.get(lane) ?? nearestBefore(index, doc, entry))
        if (planned.snapshot !== null)
          last.set(lane, {
            snapshot: planned.snapshot,
            commit: planned.commit ?? newest,
          })
        const shared = deps.setup.configs.laneShared(lane).map(d => d.path)
        // One queued step, so the next tool call waits for all of it and the
        // next request does not: the turn's classes and the registry they
        // leave, the snapshot, then its diff, read while the container
        // still runs.
        const ended = queueTurnEnd(
          () =>
            handle.queue
              .enqueue(async () => {
                const classed = await classifyWritesOnQueue({
                  handle,
                  changed,
                  shared,
                  image: (await deps.setup.ready).image,
                }).catch(error => {
                  failed(basics, "classing the turn's writes", lane)(error)
                  return null
                })
                await executeOrThrow(
                  planSnapshot({ lane, snapshot: snapshotId(entry) }),
                  handle.runners,
                )
                const disk =
                  classed === null
                    ? null
                    : await diskOfTurn({
                        handle,
                        writes: classed.writes,
                        diff:
                          previous === null
                            ? null
                            : await handle.runners.runtime.diff(
                                previous.snapshot,
                                snapshotId(entry),
                              ),
                        shared,
                      }).catch(error => {
                        failed(basics, "the turn's diff", lane)(error)
                        return null
                      })
                return {
                  snapped: true,
                  disk,
                  touched: classed?.touched ?? null,
                }
              })
              .catch(error => {
                failed(basics, "the snapshot", lane)(error)
                last.delete(lane)
                return { snapped: false, disk: null, touched: null }
              }),
          follow,
        )
        const recorded = keeper.track(
          ended
            .then(async ({ snapped, disk, touched }) => {
              // Off the lane's queue: the lineages are every lane's.
              const shared =
                touched === null
                  ? NO_SHARED
                  : await deps.shared
                      .record(lane, entry, touched)
                      .catch(error => {
                        failed(
                          basics,
                          "the shared files' versions",
                          lane,
                        )(error)
                        return NO_SHARED
                      })
              await writeRevision({
                ...planned,
                snapshot: snapped ? planned.snapshot : null,
                disk: disk === null ? null : { ...disk, shared },
              })
            })
            .catch(failed(basics, "recording a turn", lane)),
        )
        recording.add(recorded)
        void recorded.finally(() => recording.delete(recorded))
      } catch (error) {
        // A missing revision only coarsens branching: the run goes on.
        failed(basics, "recording a turn", lane)(error)
      }
    },
  }
}
