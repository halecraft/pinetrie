// host/work/update — a thread's base, or the thread it branched from, merged
// into its lane, when the host pops a queued card with a command or its agent
// calls `catch_up`, and whether its agent may ask about a conflict. One step on
// the lane's queue (`withHistory`) gathers, plans and merges; then
// `planSettle` decides what the thread gets, and `applySettle` writes it and
// fires what the merge's adapter does after it (`MergeDone.follow`).

import {
  type BaseMerge,
  type CopyRefusal,
  type EntryId,
  ERR,
  entryOfMessage,
  errorText,
  firstLine,
  type GetLatestCommand,
  indexTree,
  messageText,
  messageToolCalls,
  type OwnLane,
  type PointId,
  snapshotId,
  type ThreadId,
  type TreeIndex,
  turnEntry,
  type WriterId,
} from "@pinetrie/core"
import {
  type Edits,
  executeOrThrow,
  type Follow,
  type LaneHistory,
  type Merged,
  planSnapshot,
  type TouchedRevision,
} from "@pinetrie/lanes"
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
  encodeUpdate,
  type Floor,
  getLatestAnswer,
  getLatestRefusal,
  type LandMessage,
  type LandSkill,
  latestNow,
  latestSourceName,
  latestWords,
  mergedFrom,
  type ParentNow,
  type PromptBudget,
  parentNow,
  planGetLatestCall,
  planParentUpdate,
  planResolution,
  planUpdateFrom,
  refusedAnswer,
  resolutionFloor,
  type ToolAnswer,
  type UpdateMessage,
  type UpdateRefusal,
} from "@pinetrie/rules"
import { readLaneTip } from "@pinetrie/schema"
import { failed, type LeaseBasics } from "../basics.ts"
import type { Containers } from "./containers.ts"
import type { Destination } from "./destination.ts"
import { removeStaleOutputs } from "./disk.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { Turns } from "./turns.ts"

/** Why an update was refused, worded once. */
function updateRefusal(code: UpdateRefusal): string {
  switch (code) {
    case ERR.NOT_SET_UP:
      return "set up accepted work first"
    case ERR.BASE_GONE:
      return "this thread's WIP bookmark is gone: continue it on accepted work"
    case ERR.NO_PARENT:
      return "this thread did not branch from another thread's copy"
    case ERR.PARENT_RUNNING:
      return "the thread this one branched from is working: get its latest when its run ends"
  }
}

/**
 * Why a catch-up was refused before it merged: the smallest resolution prompt
 * for it would not fit what a run keeps when pi compacts.
 */
function unfittableWords(tokens: number, budget: number): string {
  return `a resolution's prompt would need ${tokens} tokens, over the ${budget} a run keeps: shorten the card's text or the resolve-conflicts skill`
}

/**
 * What a catch-up may do once its base is known: merge, with the floor its
 * resolution's prompt will fit, or refuse with the lane untouched, when even
 * the smallest prompt would not fit. Decided before the merge, since a merge
 * left without a prompt is one no later catch-up merges again.
 */
export function planGetLatest(
  from: BaseMerge,
  resolution: {
    readonly budget: PromptBudget
    readonly skill: LandSkill | null
    readonly intent: string
  },
):
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "merge"
      readonly from: BaseMerge
      readonly floor: Floor
    } {
  const found = resolutionFloor({
    ...resolution,
    latest: latestWords(mergedFrom(from)),
  })
  if (found.kind === "too-large")
    return {
      kind: "refused",
      reason: unfittableWords(found.tokens, found.budget),
    }
  return { kind: "merge", from, floor: found.floor }
}

/**
 * Why one side changed a file: the message a revision's trailer names,
 * attributed, else the description's first line.
 */
export function changeReason(index: TreeIndex, description: string): string {
  const entry = entryOfMessage(description)
  const message = entry === null ? undefined : index.entries[entry]?.message
  if (message === undefined) return firstLine(description, 200)
  const who =
    message.role === "person" ? `${message.author ?? "someone"}: ` : "agent: "
  return `${who}${firstLine(messageText(message), 400)}`
}

/**
 * What popping an update's card comes to: the update written in the thread, a
 * resolution run's prompt, nothing new, or why not.
 */
export type Prepared =
  | { readonly kind: "clean" }
  | { readonly kind: "conflicted"; readonly message: LandMessage }
  | { readonly kind: "nothing" }
  | { readonly kind: "refused"; readonly reason: string }

const refused = (reason: string): Prepared => ({ kind: "refused", reason })

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

/** What a merge found, with what a resolution's prompt needs when it conflicted. */
type SettleFacts =
  | Exclude<Merged, { readonly kind: "conflicted" | "refused" }>
  | (Extract<Merged, { readonly kind: "conflicted" }> & {
      /** What the prompt must fit, settled before the merge (`planGetLatest`). */
      readonly floor: Floor
    })

/** What the thread gets after a merge. */
export type Settle =
  | {
      readonly kind: "clean"
      readonly message: UpdateMessage
      readonly merge: PointId
    }
  | { readonly kind: "nothing" }
  | { readonly kind: "conflicted"; readonly message: LandMessage }

const touching = (revisions: readonly TouchedRevision[], path: string) =>
  revisions.filter(r => r.paths.includes(path)).map(r => r.description)

/**
 * What a merge comes to. Clean: the update, written in the thread. Nothing:
 * nothing for the thread. Conflicted: the resolution's prompt, within the
 * floor's budget, each file with why each side changed it, and the card's
 * text after. What the merge's adapter does after it is its own
 * (`MergeDone.follow`).
 */
export function planSettle(
  facts: SettleFacts,
  ctx: {
    readonly lane: ThreadId
    readonly by: WriterId
    readonly from: BaseMerge
    readonly index: TreeIndex
    readonly now: number
  },
): Settle {
  const { lane, by, from } = ctx
  const upToDate = mergedFrom(from)
  switch (facts.kind) {
    case "nothing":
      return { kind: "nothing" }
    case "clean":
      return {
        kind: "clean",
        message: encodeUpdate(
          {
            lane,
            from: upToDate,
            merged: facts.from,
            files: facts.files,
            commits: facts.commits,
            by,
          },
          ctx.now,
        ),
        merge: facts.merge,
      }
    case "conflicted":
      return {
        kind: "conflicted",
        message: planResolution({
          floor: facts.floor,
          files: facts.contents.map(({ path, content }) => ({
            path,
            content,
            ours: {
              label: "ours",
              who: "this thread",
              reasons: touching(facts.ours, path).map(d =>
                changeReason(ctx.index, d),
              ),
            },
            theirs: {
              label: "theirs",
              who:
                upToDate.kind === "parent"
                  ? `the thread ${latestSourceName(upToDate)}`
                  : latestSourceName(upToDate),
              reasons: touching(facts.theirs, path).map(d => firstLine(d, 200)),
            },
          })),
          details: { lane, merged: [facts.from], by },
          timestamp: ctx.now,
        }),
      }
  }
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
  readonly writeRevision: Turns["writeRevision"]
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
    const snapped = await handle.queue
      .enqueue(async () => {
        await executeOrThrow(
          planSnapshot({ lane, snapshot: snapshotId(entry) }),
          handle.runners,
        )
        return true
      })
      .catch(error => {
        failed(basics, "the snapshot", lane)(error)
        return false
      })
    await deps.writeRevision({
      entry,
      lane,
      point: merge,
      snapshot: snapped ? snapshotId(entry) : null,
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
    resolution: Parameters<typeof planGetLatest>[1],
  ) =>
    registry.withHistory(
      lane,
      async (
        h,
        handle,
        record,
      ): Promise<
        | Prepared
        | {
            readonly kind: "merged"
            readonly from: BaseMerge
            readonly facts: SettleFacts
            readonly follow: Follow
          }
        | {
            /** The copy cannot take a merge: each caller words it its own way. */
            readonly kind: "copy"
            readonly why: CopyRefusal
          }
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
        // before anything snapshots the disk, a catch_up's turn included.
        await removeStaleOutputs(handle, (await setup.ready).image).catch(
          failed(basics, "removing stale outputs", lane),
        )
        // A conflict's prompt fits the floor settled before the merge.
        const facts: SettleFacts =
          merged.kind === "conflicted"
            ? { ...merged, floor: getLatest.floor }
            : merged
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
      wipNow: now.wipNow,
    })
  }

  /** What a resolution's prompt must fit, read before a merge. */
  const resolutionOf = async (
    intent: string,
  ): Promise<Parameters<typeof planGetLatest>[1]> => ({
    budget: LAND_BUDGET,
    skill: await deps.piSetup.skill("pinetrie:skill:resolve-conflicts"),
    intent,
  })

  return {
    async askedAboutConflict(lane) {
      if (!registry.isOwn(lane)) return false
      const conflicts = await registry.withHistory(lane, h => h.conflicts())
      return conflicts.length > 0
    },

    async getLatestInRun(lane, from) {
      await using held = basics.leases.lane(lane)
      const doc = held === null ? null : await held.ready
      // Who the update is by: the person behind the run.
      const by = doc === null ? null : readRunAuthor(doc, docs.session, lane)
      if (!registry.isOwn(lane) || doc === null || by === null)
        return refusedAnswer("no-copy")
      // gather
      const index = readTreeIndex(doc)
      const tip = readLaneTip(doc, lane)
      const parent = from === "parent" ? await parentOf(lane) : null
      // plan
      const call = planGetLatestCall({
        from,
        own: true,
        calls:
          tip === null
            ? 0
            : messageToolCalls(index.entries[turnEntry(index, tip)]?.message)
                .length,
        base: latestNow(
          readBases(docs.session).get(lane),
          readAccepted(docs.session),
        ),
        parent: parent?.now ?? null,
        parentRunning: parent?.running ?? false,
      })
      if (call.kind === "refused") return refusedAnswer(call.why)
      // execute
      const done = await updateOnQueue(
        lane,
        call.command,
        await resolutionOf(""),
      )
      if (done.kind === "copy") return refusedAnswer(done.why)
      if (done.kind === "refused") return refusedAnswer({ reason: done.reason })
      if (done.kind !== "merged") return getLatestAnswer({ kind: "nothing" })
      const settle = planSettle(done.facts, {
        lane,
        by,
        from: done.from,
        index: readTreeIndex(doc),
        now: basics.now(),
      })
      done.follow?.()
      return getLatestAnswer(
        settle.kind === "clean"
          ? { kind: "clean", message: settle.message, merged: settle.merge }
          : settle,
      )
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
              append: message => handle.append(message),
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
