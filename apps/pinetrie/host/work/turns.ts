// host/work/turns — each turn of a lane of its own, recorded: its revision
// committed on the lane's queue (`LaneHistory.recordTurn`), its disk classed
// and snapshotted (`disk.ts`), then what its adapter does after a turn
// (`TurnMade.follow`).

import {
  type EntryId,
  firstLine,
  NO_SHARED,
  type PointId,
  type RevisionRecord,
  type SnapshotId,
  type ThreadId,
} from "@pinetrie/core"
import { callPurpose } from "@pinetrie/interface"
import type { Keeper } from "@pinetrie/keeper"
import { executeOrThrow, type Follow, planSnapshot } from "@pinetrie/lanes"
import type { LaneHooks } from "@pinetrie/pi"
import { readRevisions, readTreeIndex } from "@pinetrie/reads"
import {
  type OutputSplitRecord,
  outputSplitWrite,
  planTurn,
  planTurnRevision,
  REVISION,
  setRecord,
} from "@pinetrie/rules"
import {
  messageText,
  messageToolCalls,
  nearestRevision,
  type TreeIndex,
} from "@pinetrie/threads"
import { failed, type LeaseBasics } from "../basics.ts"
import type { Records } from "../records.ts"
import { classifyWritesOnQueue, diskOfTurn } from "./disk.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { SharedLineages } from "./shared.ts"

/** A revision's title: a message's first line, cut. */
const TITLE_LENGTH = 72

/** The title a revision is described with: the message's first line, or what its first call is for (`callPurpose`). */
export function revisionTitle(index: TreeIndex, entry: EntryId): string {
  const text = firstLine(
    messageText(index.entries[entry]?.message),
    TITLE_LENGTH,
  )
  if (text !== "") return text
  const call = messageToolCalls(index.entries[entry]?.message)[0]
  return call === undefined ? "turn" : callPurpose(call)
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
  /** pi's hook when a `bash` call's split verified: its record, in the lane's root. */
  storeOutputSplit: LaneHooks["storeOutputSplit"]
  /**
   * Settles when every turn record being written now has. A fork waits for
   * it, so a branch taken at a turn whose snapshot is still running gets that
   * turn's disk, not the one before.
   */
  pendingRecords(): Promise<void>
  writeRevision(record: RevisionRecord): Promise<void>
}

/** A lane's disk at a revision: its snapshot, and the state with it. */
interface Disk {
  readonly snapshot: SnapshotId
  readonly point: PointId | null
}

export function createTurns(deps: {
  readonly basics: LeaseBasics
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
      : { snapshot: above.snapshot, point: above.point }
  }

  /** A revision, in the root its lane works in. */
  const writeRevision = async (record: RevisionRecord) => {
    const root = docs.rootOfLane(record.lane)
    if (root === null) throw new Error(`${record.lane} is in no root`)
    await using held = basics.leases.root(root)
    await held.ready
    await held.records.writeValues([setRecord(REVISION, record, root)])
  }

  return {
    writeRevision,
    async storeOutputSplit(lane: ThreadId, record: OutputSplitRecord) {
      const root = docs.rootOfLane(lane)
      if (root === null) return
      await using held = basics.leases.root(root)
      await held.ready
      await held.records.writeValues([outputSplitWrite(record, root)])
    },
    pendingRecords: async () => {
      await Promise.all([...recording])
    },
    async turnDone(lane: ThreadId, tip: EntryId) {
      try {
        const record = registry.recordOf(lane)
        if (record === undefined) return
        await using held = basics.leases.root(record.root)
        const doc = await held.ready
        const index = readTreeIndex(doc)
        const turn = planTurn({ index, tip, lane, own: registry.isOwn(lane) })
        if (turn.kind === "none") return
        if (turn.kind === "record") {
          await writeRevision(turn.revision)
          return
        }
        const { entry } = turn
        const handle = registry.handleOf(lane)
        // The commit is queued, so it never overlaps the last turn's
        // snapshot, and awaited, so the next request sees it.
        const { follow, ...made } = await registry.withHistory(lane, h =>
          h.recordTurn({ title: revisionTitle(index, entry), entry }),
        )
        const changed = made.paths
        const { newest } = made
        const planned = planTurnRevision(turn, made)
        if (planned === null) return
        const previous = turn.isPrompt
          ? null
          : (last.get(lane) ?? nearestBefore(index, doc, entry))
        if (planned.snapshot !== null)
          last.set(lane, {
            snapshot: planned.snapshot,
            point: planned.point ?? newest,
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
                  image: deps.setup.ready.image,
                }).catch(error => {
                  failed(basics, "classing the turn's writes", lane)(error)
                  return null
                })
                await executeOrThrow(
                  planSnapshot({ lane, snapshot: turn.snapshot }),
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
                                turn.snapshot,
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
