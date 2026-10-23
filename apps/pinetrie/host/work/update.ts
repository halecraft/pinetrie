// host/work/update — a thread's base, or the thread it branched from, merged
// into its lane, when the host pops a queued card with a command or its agent
// calls `catch_up`, and whether its agent may ask about a conflict. One step on
// the lane's queue (`withHistory`) gathers, plans and merges; then
// `planSettle` decides what the thread gets, and `applySettle` writes it and
// fires what the merge's adapter does after it (`MergeDone.follow`).

import {
  type EntryId,
  errorText,
  type OwnLane,
  type PointId,
  snapshotId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  type Edits,
  executeOrThrow,
  type Follow,
  type LaneHistory,
  planSnapshot,
} from "@pinetrie/lanes"
import type { SnapshotTaking } from "@pinetrie/machine"
import { LAND_BUDGET, type PiSetup, type ThreadLaneHandle } from "@pinetrie/pi"
import {
  readAccepted,
  readBases,
  readNames,
  readRevisions,
  readRunAuthor,
  readRunning,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  getLatestRefusal,
  type LandMessage,
  type LatestInRunDone,
  type ParentNow,
  parentNow,
  planConflictAsk,
  planGetLatest,
  planLatestInRun,
  planLatestInRunAnswer,
  planParentUpdate,
  planSettle,
  planUpdateFrom,
  type Resolution,
  type Settle,
  type SettleFacts,
  type ToolAnswer,
  updateRefusal,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import { type GetLatestCommand, indexTree, turnEntry } from "@pinetrie/threads"
import { failed, type LeaseBasics, notWritten } from "../basics.ts"
import type { Records } from "../records.ts"
import type { Containers } from "./containers.ts"
import type { Destination } from "./destination.ts"
import { removeStaleOutputs } from "./disk.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import { type TakenSnapshot, takeIndexedSnapshot } from "./snapshot-taking.ts"
import type { Turns } from "./turns.ts"

/**
 * What popping an update's card comes to: the update written in the thread, a
 * resolution run's prompt, nothing new, or why not.
 */
export type Prepared =
  | { readonly kind: "clean" }
  | { readonly kind: "conflicted"; readonly message: LandMessage }
  | { readonly kind: "nothing" }
  | { readonly kind: "refused"; readonly reason: string }

const refused = (reason: string) => ({ kind: "refused", reason }) as const

/**
 * What follows an update: a run whatever it comes to, as after a quiet catch-up
 * before a person's message; or the card's text, whose send may start no run,
 * so the lane stops unless a resolution runs.
 */
export type UpdateFollows = "run" | "send"

/**
 * Start the lane, run `update`, and stop the lane again unless a run
 * follows: the one `follows` names, or the resolution of a conflicted merge.
 * That run's end stops it. A throw is a refusal saying why.
 */
export async function withLaneStarted(
  ports: { readonly beforeRun: () => void; readonly runEnded: () => void },
  follows: UpdateFollows,
  update: () => Promise<Prepared>,
): Promise<Prepared> {
  const prepared = await (async () => {
    ports.beforeRun()
    return update()
  })().catch((error: unknown) => refused(errorText(error)))
  if (follows === "send" && prepared.kind !== "conflicted") ports.runEnded()
  return prepared
}

/**
 * A settle's writes, in order: a clean update as a fact in the thread, then
 * its revision (so a branch below it starts with the merged files, and its
 * snapshot step is queued); then what follows the merge (`follow`), for jj
 * the fetch into your repo, which so runs after the snapshot.
 */
export async function applySettle(
  ports: {
    readonly append: ThreadLaneHandle["append"]
    readonly recordUpdate: (entry: EntryId, merge: PointId) => Promise<void>
  },
  settle: Settle,
  follow: Follow,
): Promise<Prepared> {
  if (settle.kind === "clean") {
    const appended = await ports.append(settle.message)
    if (appended.kind === "appended")
      await ports.recordUpdate(appended.id, settle.merge)
  }
  follow?.()
  switch (settle.kind) {
    case "clean":
      return { kind: "clean" }
    case "nothing":
      return { kind: "nothing" }
    case "conflicted":
      return { kind: "conflicted", message: settle.message }
  }
}

export interface Updates {
  /**
   * Merge what `command` names into the lane `handle` names, whose handle the
   * caller holds: the thread's base, accepted work's commit or a fresh copy of
   * its WIP; with `continue-on-accepted`, accepted work, moving the thread
   * there; with `get-latest-from-parent`, the newest commit of the thread it
   * branched from. Clean: the update is appended to the thread, through
   * `handle`. Conflicted: the land message for the resolution run, with
   * `intent` (the card's text) after the conflicts. Nothing new: nothing to do
   * but what the merge's adapter does after a move to accepted work. Refused, with the lane untouched,
   * when even the smallest resolution prompt would not fit. The lane is stopped
   * after, unless a run follows (`follows`).
   */
  prepareUpdate(
    handle: Pick<ThreadLaneHandle, "name" | "append">,
    by: WriterId,
    intent: string,
    command: GetLatestCommand,
    follows: UpdateFollows,
  ): Promise<Prepared>
  /**
   * pi's hook: the lane's agent called `catch_up`. Merged during its run, on
   * the lane's queue, with no start or stop of the lane, and nothing appended:
   * the tool's answer is the update. Refused unless the call is the only one in
   * its turn and there is something new.
   */
  getLatestInRun(lane: ThreadId, from: "base" | "parent"): Promise<ToolAnswer>
  /**
   * pi's hook: the lane's agent asked about a conflict. Taken while its history
   * finds a conflict in the lane's copy, in any run: read on the lane's queue, never
   * from a revision record, which can be late. A lane with no copy of its own
   * has nothing to ask about.
   */
  askedAboutConflict(lane: ThreadId): Promise<boolean>
}

export function createUpdates(deps: {
  readonly basics: LeaseBasics
  readonly setup: Pick<Setup, "ready">
  readonly destination: Pick<Destination, "baseNow">
  readonly registry: LaneRegistry
  readonly piSetup: Pick<PiSetup, "skill">
  readonly containers: Pick<Containers, "beforeRun" | "runEnded">
  readonly records: Pick<Records, "writeValues">
  readonly writeRevision: Turns["writeRevision"]
  readonly snapshots: SnapshotTaking
  /** The merge's snapshot skipped, its index row unwritten. */
  readonly snapshotSkipped: () => void
}): Updates {
  const { basics, setup, registry, containers, destination } = deps
  const { docs } = basics

  /**
   * The update's entry recorded as a revision, the merge its commit, with a
   * snapshot, so a branch below it starts with the merged files.
   */
  async function recordUpdate(
    lane: ThreadId,
    entry: EntryId,
    merge: PointId,
  ): Promise<void> {
    const handle = registry.handleOf(lane)
    const snapshot = snapshotId(entry)
    const taken: TakenSnapshot = await handle.queue
      .enqueue(() =>
        takeIndexedSnapshot({
          taking: deps.snapshots,
          // The update belongs to no ask: it changed no path of its own.
          row: { snapshot, lane, changed: 0 },
          take: () =>
            executeOrThrow(planSnapshot({ lane, snapshot }), handle.runners),
          skipped: deps.snapshotSkipped,
        }),
      )
      .catch(error => ({ kind: "failed", error }))
    if (taken.kind === "failed")
      failed(basics, "the snapshot", lane)(taken.error)
    if (taken.kind === "unindexed")
      failed(basics, "indexing the merge's snapshot", lane)(taken.error)
    await deps.writeRevision({
      entry,
      lane,
      point: merge,
      snapshot: taken.kind === "taken" ? taken.snapshot : null,
      // The update belongs to no ask, so its files count toward none.
      paths: [],
      // A clean merge.
      conflicts: [],
      disk: null,
    })
  }

  /**
   * What anything edited in the lane since its last run is committed as: a
   * turn of the lane's tip, read from its own root's document.
   */
  async function editsOf(lane: ThreadId): Promise<Edits | null> {
    await using held = basics.leases.lane(lane)
    const doc = held === null ? null : await held.ready
    const tip = doc === null ? null : readLaneTip(doc, lane)
    if (doc === null || tip === null) return null
    return {
      title: "edits between runs",
      entry: turnEntry(readTreeIndex(doc), tip),
    }
  }

  /**
   * The thread `lane` branched from, as its root's document says it now
   * (`parentNow`), and whether its agent runs.
   */
  async function parentOf(
    lane: ThreadId,
  ): Promise<{ readonly now: ParentNow | null; readonly running: boolean }> {
    await using held = basics.leases.lane(lane)
    const doc = held === null ? null : await held.ready
    if (doc === null) return { now: null, running: false }
    const now = parentNow({
      index: readTreeIndex(doc),
      revisions: readRevisions(doc),
      lane,
      tip: readLaneTip(doc, lane),
      tipOf: other => readLaneTip(doc, other),
      names: readNames(docs.session),
    })
    return {
      now,
      running: now !== null && readRunning(docs.live, now.lane),
    }
  }

  /**
   * One step on the lane's queue, so nothing changes the lane between what
   * is read and what is merged: what the command merges (the lane's base
   * from its own history, accepted work and the WIP from the destination; or
   * the parent, from the document), the plan with the floor its
   * resolution's prompt must fit (`planGetLatest`), and, unless it is refused
   * or has nothing to merge, the edits committed and the merge.
   */
  const updateOnQueue = (
    lane: ThreadId,
    command: GetLatestCommand,
    resolution: Resolution,
  ) =>
    registry.withHistory(
      lane,
      async (
        h,
        handle,
        record,
      ): Promise<
        | Exclude<LatestInRunDone, { readonly kind: "merged" }>
        | (Extract<LatestInRunDone, { readonly kind: "merged" }> & {
            readonly follow: Follow
          })
      > => {
        const ready = await h.readyToMerge()
        if (typeof ready === "string") return { kind: "copy", why: ready }
        const from =
          command === "get-latest-from-parent"
            ? await parentOf(lane).then(p => planParentUpdate(p.now, p.running))
            : await baseUpdate(record, h, command === "continue-on-accepted")
        if (typeof from === "string") return refused(updateRefusal(from))
        if (from.kind === "nothing") return { kind: "nothing" }
        const getLatest = planGetLatest(from, resolution)
        if (getLatest.kind === "refused") return refused(getLatest.reason)
        const { follow, ...merged } = await h.merge(
          ready,
          getLatest.from,
          await editsOf(lane),
        )
        if (merged.kind === "refused") return refused(merged.reason)
        // The merge may have changed what a recipe read: its outputs go
        // before anything snapshots the disk, a catch_up's turn included,
        // and what went is kept for the message. A failed removal tells
        // nothing.
        const removed =
          (await removeStaleOutputs(handle, setup.ready.image).catch(
            failed(basics, "removing stale outputs", lane),
          )) ?? []
        // A conflict's prompt fits the floor settled before the merge.
        const facts: SettleFacts =
          merged.kind === "conflicted"
            ? { ...merged, floor: getLatest.floor, removed }
            : { ...merged, removed }
        return { kind: "merged", from, facts, follow }
      },
    )

  /** What catching up with the base merges (`planUpdateFrom`). */
  async function baseUpdate(
    record: OwnLane,
    h: LaneHistory,
    toAccepted: boolean,
  ) {
    const base = await h.base()
    const now = await destination.baseNow(record, base)
    return planUpdateFrom({
      base,
      state: now.state,
      toAccepted,
      acceptedPoint: now.acceptedPoint,
      unfinishedNow: now.unfinishedNow,
    })
  }

  /** What a resolution's prompt must fit, read before a merge. */
  const resolutionOf = async (intent: string): Promise<Resolution> => ({
    budget: LAND_BUDGET,
    skill: await deps.piSetup.skill("pinetrie:skill:resolve-conflicts"),
    intent,
  })

  return {
    async askedAboutConflict(lane) {
      if (!registry.isOwn(lane)) return false
      const conflicts = await registry.withHistory(lane, h => h.conflicts())
      const plan = planConflictAsk(lane, conflicts, basics.now())
      await deps.records.writeValues(plan.writes)
      return plan.asked
    },

    async getLatestInRun(lane, from) {
      await using held = basics.leases.lane(lane)
      const doc = held === null ? null : await held.ready
      const call = planLatestInRun({
        lane,
        from,
        own: registry.isOwn(lane),
        index: doc === null ? null : readTreeIndex(doc),
        tip: doc === null ? null : readLaneTip(doc, lane),
        by: doc === null ? null : readRunAuthor(doc, docs.session, lane),
        base: readBases(docs.session).get(lane),
        accepted: readAccepted(docs.session),
        ...(from === "parent"
          ? await parentOf(lane).then(p => ({
              parent: p.now,
              parentRunning: p.running,
            }))
          : { parent: null, parentRunning: false }),
      })
      if (call.kind === "answer") return call.answer
      const done = await updateOnQueue(
        lane,
        call.command,
        await resolutionOf(""),
      )
      if (done.kind === "merged") done.follow?.()
      return planLatestInRunAnswer(call, done, {
        index: doc === null ? indexTree({}) : readTreeIndex(doc),
        now: basics.now(),
      })
    },

    async prepareUpdate(handle, by, intent, command, follows) {
      const lane = handle.name
      if (!registry.isOwn(lane))
        return refused("the lane has no copy of its own")
      return withLaneStarted(
        {
          beforeRun: () => containers.beforeRun(lane),
          runEnded: () => containers.runEnded(lane),
        },
        follows,
        async () => {
          // Read before the merge: the floor its prompt must fit needs it.
          const done = await updateOnQueue(
            lane,
            command,
            await resolutionOf(intent),
          )
          if (done.kind === "copy") return refused(getLatestRefusal(done.why))
          if (done.kind !== "merged") return done
          const { from, facts, follow } = done
          await using held = basics.leases.lane(lane)
          const doc = held === null ? null : await held.ready
          const settle = planSettle(facts, {
            lane,
            by,
            from,
            index: doc === null ? indexTree({}) : readTreeIndex(doc),
            now: basics.now(),
          })
          return applySettle(
            {
              append: async message => {
                const appended = await handle.append(message)
                notWritten(basics, "an update", lane)(appended)
                return appended
              },
              recordUpdate: (entry, merge) => recordUpdate(lane, entry, merge),
            },
            settle,
            follow,
          )
        },
      )
    },
  }
}
