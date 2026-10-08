// host/work/update — a thread's base, or the thread it branched from,
// merged into its lane, when the host pops a queued card with a command
// (ADR-0108, ADR-0104, ADR-0072) or its agent calls `catch_up`, and whether
// its agent may ask about a conflict (ADR-0080). One step on the lane's
// queue gathers, plans and merges; then `planSettle` decides what the thread
// gets, and `applySettle` writes it.

import {
  type BaseMerge,
  type CatchUpCommand,
  type CommitId,
  type EntryId,
  ERR,
  entryOfMessage,
  errorText,
  firstLine,
  indexTree,
  type LaneName,
  messageText,
  snapshotId,
  type TreeIndex,
  toolCallsOf,
  turnEntry,
  type WriterId,
} from "@pinetrie/core"
import {
  bookmarkName,
  bookmarkOf,
  bookmarkRevset,
  commitTurn,
  conflictsIn,
  copyFacts,
  DEFAULT_REPO,
  laneBase,
  type Merged,
  type MergePlan,
  mergeUpdate,
  planMerge,
  type Runner,
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
import { beginFacts, type RepoOwner, readWipState } from "@pinetrie/repo"
import {
  catchUpAnswer,
  catchUpName,
  catchUpOf,
  catchUpRefusal,
  encodeUpdate,
  type Floor,
  type LandMessage,
  type LandSkill,
  mergedFrom,
  type ParentNow,
  type PromptBudget,
  parentNow,
  planCatchUpCall,
  planCopyReady,
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
import type { Basics } from "../basics.ts"
import type { Containers } from "./containers.ts"
import { snapshotOnQueue } from "./disk.ts"
import type { Fetches } from "./fetch.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { Turns } from "./turns.ts"

/** Why an update was refused, worded once (ADR-0104). */
function updateRefusal(code: UpdateRefusal): string {
  switch (code) {
    case ERR.NOT_SET_UP:
      return "set up accepted work first"
    case ERR.BASE_GONE:
      return "this thread's WIP bookmark is gone: continue it on accepted work"
    case ERR.NO_PARENT:
      return "this thread did not branch from another thread's copy"
    case ERR.PARENT_RUNNING:
      return "the thread this one branched from is working: catch up when its run ends"
  }
}

/**
 * Why a catch-up was refused before it merged: the smallest resolution
 * prompt for it would not fit what a run keeps when pi compacts (ADR-0084).
 */
export function unfittableWords(tokens: number, budget: number): string {
  return `a resolution's prompt would need ${tokens} tokens, over the ${budget} a run keeps: shorten the card's text or the resolve-conflicts skill`
}

/** Whose work a catch-up brings in, as a resolution's prompt says it to the model. */
export function incomingOf(from: BaseMerge): string {
  const caughtUp = mergedFrom(from)
  return caughtUp.kind === "parent"
    ? `The work of the thread this one branched from (${caughtUp.name})`
    : caughtUp.kind === "accepted"
      ? "Accepted work"
      : `The work on ${caughtUp.bookmark}`
}

/**
 * What a catch-up may do once its base is known (ADR-0084): merge, with the
 * floor its resolution's prompt will fit, or refuse with the lane untouched,
 * when even the smallest prompt would not fit. Decided before the merge,
 * since a merge left without a prompt is one no later catch-up merges again.
 * Pure.
 */
export function planCatchUp(
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
      readonly plan: MergePlan
      readonly floor: Floor
    } {
  const found = resolutionFloor({ ...resolution, incoming: incomingOf(from) })
  if (found.kind === "too-large")
    return {
      kind: "refused",
      reason: unfittableWords(found.tokens, found.budget),
    }
  return { kind: "merge", plan: planMerge(from), floor: found.floor }
}

/**
 * Why one side changed a file: the message a revision's trailer names,
 * attributed, else the description's first line.
 */
export function reasonOf(index: TreeIndex, description: string): string {
  const entry = entryOfMessage(description)
  const message = entry === null ? undefined : index.entries[entry]?.message
  if (message === undefined) return firstLine(description, 200)
  const who =
    message.role === "chat" ? `${message.author ?? "someone"}: ` : "agent: "
  return `${who}${firstLine(messageText(message), 400)}`
}

/**
 * What popping an update's card comes to (ADR-0108): the update written in
 * the thread, a resolution run's prompt, nothing new, or why not.
 */
export type Prepared =
  | { readonly kind: "clean" }
  | { readonly kind: "conflicted"; readonly message: LandMessage }
  | { readonly kind: "nothing" }
  | { readonly kind: "refused"; readonly reason: string }

const refused = (reason: string): Prepared => ({ kind: "refused", reason })

/**
 * What follows an update (ADR-0080): a run whatever it comes to, as after a
 * quiet catch-up before a person's message; or the card's text, whose send
 * may start no run, so the lane stops unless a resolution runs.
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
export type SettleFacts =
  | Exclude<Merged, { readonly kind: "conflicted" }>
  | (Extract<Merged, { readonly kind: "conflicted" }> & {
      /** What the prompt must fit, settled before the merge (`planCatchUp`). */
      readonly floor: Floor
    })

/**
 * What the thread gets after a merge. `fetch`, when not null, fetches the
 * lane into your repo, excluding those of its commits your repo may have.
 */
export type Settle =
  | {
      readonly kind: "clean"
      readonly message: UpdateMessage
      readonly merge: CommitId
      readonly fetch: readonly CommitId[] | null
    }
  | { readonly kind: "nothing"; readonly fetch: readonly CommitId[] | null }
  | {
      readonly kind: "conflicted"
      readonly message: LandMessage
      readonly fetch: readonly CommitId[] | null
    }

const touching = (revisions: readonly TouchedRevision[], path: string) =>
  revisions.filter(r => r.paths.includes(path)).map(r => r.description)

/**
 * What a merge comes to (ADR-0104, ADR-0033). Clean: the update, written in
 * the thread, and the merge fetched. Nothing: a mark naming accepted work, when
 * one was made, fetched. Conflicted: the resolution's prompt, within the
 * floor's budget, each file with why each side changed it, and the card's
 * text after; nothing is fetched: the resolution's turns fetch the lane as
 * they commit. Pure.
 */
export function planSettle(
  facts: SettleFacts,
  ctx: {
    readonly lane: LaneName
    readonly by: WriterId
    readonly from: BaseMerge
    readonly index: TreeIndex
    readonly now: number
  },
): Settle {
  const { lane, by, from } = ctx
  const caughtUp = mergedFrom(from)
  switch (facts.kind) {
    case "nothing":
      return {
        kind: "nothing",
        fetch: facts.mark === null ? null : [facts.ours],
      }
    case "clean":
      return {
        kind: "clean",
        message: encodeUpdate(
          {
            lane,
            from: caughtUp,
            merged: facts.from,
            files: facts.files,
            commits: facts.commits,
            by,
          },
          ctx.now,
        ),
        merge: facts.merge,
        fetch: [facts.ours, facts.from],
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
                reasonOf(ctx.index, d),
              ),
            },
            theirs: {
              label: "theirs",
              who:
                caughtUp.kind === "parent"
                  ? `the thread ${catchUpName(caughtUp)}`
                  : catchUpName(caughtUp),
              reasons: touching(facts.theirs, path).map(d => firstLine(d, 200)),
            },
          })),
          details: { lane, yours: [facts.from], by },
          timestamp: ctx.now,
        }),
        fetch: null,
      }
  }
}

/**
 * A settle's writes, in order: a clean update as a fact in the thread, then
 * its revision (so a branch below it starts with the merged files); then the
 * fetch into your repo.
 */
export async function applySettle(
  ports: {
    readonly append: ThreadLaneHandle["append"]
    readonly recordUpdate: (entry: EntryId, merge: CommitId) => Promise<void>
    readonly fetchLane: (have: readonly CommitId[]) => void
  },
  settle: Settle,
): Promise<Prepared> {
  if (settle.kind === "clean") {
    const appended = await ports.append(settle.message)
    if (appended.kind === "appended")
      await ports.recordUpdate(appended.id, settle.merge)
  }
  if (settle.fetch !== null) ports.fetchLane(settle.fetch)
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
   * caller holds: the thread's base (ADR-0104),
   * accepted work's commit or a fresh copy of its WIP; with `continue-on-accepted`,
   * accepted work, moving the thread there; with `catch-up-with-parent`, the
   * newest commit of the thread it branched from (ADR-0072).
   * Clean: the update is appended to the thread, through `handle`. Conflicted: the land
   * message for the resolution run, with `intent` (the card's text) after
   * the conflicts. Nothing new: nothing to do, but a move to accepted work is
   * fetched. Refused, with the lane untouched, when even the smallest
   * resolution prompt would not fit (ADR-0084). The lane is stopped after,
   * unless a run follows (`follows`).
   */
  prepareUpdate(
    handle: Pick<ThreadLaneHandle, "name" | "append">,
    by: WriterId,
    intent: string,
    command: CatchUpCommand,
    follows: UpdateFollows,
  ): Promise<Prepared>
  /**
   * pi's hook: the lane's agent called `catch_up` (ADR-0080, S103). Merged
   * during its run, on the lane's queue, with no start or stop of the lane,
   * and nothing appended: the tool's answer is the update. Refused unless
   * the call is the only one in its turn and there is something new.
   */
  catchUpInRun(lane: LaneName, from: "base" | "parent"): Promise<ToolAnswer>
  /**
   * pi's hook: the lane's agent asked about a conflict. Taken while jj finds
   * a conflict in the lane's copy, in any run (ADR-0080, S104): read on the
   * lane's queue, never from a revision record, which can be late. A lane
   * that works directly has no copy to ask about.
   */
  askedAboutConflict(lane: LaneName): Promise<boolean>
}

export function createUpdates(deps: {
  readonly basics: Basics
  readonly setup: Pick<Setup, "root" | "owner" | "lanes">
  readonly registry: LaneRegistry
  readonly piSetup: Pick<PiSetup, "skill">
  readonly containers: Pick<Containers, "beforeRun" | "runEnded">
  readonly fetchLane: Fetches["fetchLane"]
  readonly writeRevision: Turns["writeRevision"]
}): Updates {
  const { basics, setup, registry, containers } = deps
  const { docs } = basics
  const repoConfig = setup.lanes?.repoConfig ?? DEFAULT_REPO

  /**
   * The update's entry recorded as a revision, the merge its commit, with a
   * snapshot, so a branch below it starts with the merged files.
   */
  async function recordUpdate(
    lane: LaneName,
    entry: EntryId,
    merge: CommitId,
  ): Promise<void> {
    const handle = registry.handleOf(lane)
    const snapped = await snapshotOnQueue(handle, lane, entry).catch(
      () => false,
    )
    await deps.writeRevision({
      entry,
      lane,
      commit: merge,
      snapshot: snapped ? snapshotId(entry) : null,
      // The update belongs to no ask, so its files count toward none.
      paths: [],
      // A clean merge.
      conflicts: [],
    })
  }

  /** Anything edited in the lane since its last run, committed as a turn. */
  async function commitEdits(lane: LaneName, jj: Runner): Promise<void> {
    // The lane's own root's document (ADR-0063).
    const doc = await docs.laneDoc(lane)
    const tip = doc === null ? null : readLaneTip(doc, lane)
    if (doc === null || tip === null) return
    await commitTurn(jj, {
      title: "edits between runs",
      entry: turnEntry(readTreeIndex(doc), tip),
      lane,
      bookmark: await bookmarkOf(jj, lane),
    })
  }

  /**
   * The thread `lane` branched from, as its root's document says it now
   * (`parentNow`), and whether its agent runs (ADR-0072).
   */
  async function parentOf(
    lane: LaneName,
  ): Promise<{ readonly now: ParentNow | null; readonly running: boolean }> {
    const doc = await docs.laneDoc(lane)
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
   * from its own history, accepted work and the WIP from your repo, a pinned
   * read; or the parent, from the document), the plan with the floor its
   * resolution's prompt must fit (`planCatchUp`), and, unless it is refused
   * or has nothing to merge, the edits committed and the merge.
   */
  const updateOnQueue = (
    lane: LaneName,
    owner: RepoOwner,
    command: CatchUpCommand,
    resolution: Parameters<typeof planCatchUp>[1],
  ) => {
    const handle = registry.handleOf(lane)
    const jj = registry.laneJjOf(lane)
    return handle.queue.enqueue(
      async (): Promise<
        | Prepared
        | {
            readonly kind: "merged"
            readonly from: BaseMerge
            readonly facts: SettleFacts
          }
        | {
            /** The copy cannot take a merge: each caller words it its own way. */
            readonly kind: "copy"
            readonly why: Exclude<ReturnType<typeof planCopyReady>, "ready">
          }
      > => {
        // A merge lands at the lane's bookmark: a working copy off its line
        // (a split's stack) would be left beside it (ADR-0080).
        const ready = planCopyReady(await copyFacts(jj, lane))
        if (ready !== "ready") return { kind: "copy", why: ready }
        const from =
          command === "catch-up-with-parent"
            ? await parentOf(lane).then(p => planParentUpdate(p.now, p.running))
            : await baseUpdate(command === "continue-on-accepted")
        if (typeof from === "string") return refused(updateRefusal(from))
        if (from.kind === "nothing") return { kind: "nothing" }
        const catchUp = planCatchUp(from, resolution)
        if (catchUp.kind === "refused") return refused(catchUp.reason)
        await commitEdits(lane, jj)
        const merged = await mergeUpdate(jj, handle.runners, lane, catchUp.plan)
        // A conflict's prompt fits the floor settled before the merge.
        const facts: SettleFacts =
          merged.kind === "conflicted"
            ? { ...merged, floor: catchUp.floor }
            : merged
        return { kind: "merged", from, facts }
      },
    )

    /** What catching up with the base merges (`planUpdateFrom`). */
    async function baseUpdate(toAccepted: boolean) {
      const base = await laneBase(
        jj,
        bookmarkRevset(bookmarkName(lane)),
        repoConfig,
      )
      // Your repo, pinned to the head its owner last observed.
      const { state, begin } = await owner.read(async ({ jj: yours }) => ({
        state: await readWipState(yours, repoConfig, base),
        begin: await beginFacts(
          yours,
          repoConfig,
          base?.base.kind === "wip" ? base.base.bookmark : null,
        ),
      }))
      return planUpdateFrom({
        base,
        state,
        toAccepted,
        acceptedCommit: begin.acceptedCommit,
        wipNow: begin.wip,
      })
    }
  }

  /** What a resolution's prompt must fit (ADR-0084), read before a merge. */
  const resolutionOf = async (
    intent: string,
  ): Promise<Parameters<typeof planCatchUp>[1]> => ({
    budget: LAND_BUDGET,
    skill: await deps.piSetup.skill("pinetrie:skill:resolve-conflicts"),
    intent,
  })

  return {
    async askedAboutConflict(lane) {
      if (!registry.isOwn(lane)) return false
      const jj = registry.laneJjOf(lane)
      const conflicts = await registry
        .handleOf(lane)
        .queue.enqueue(() => conflictsIn(jj))
      return conflicts.length > 0
    },

    async catchUpInRun(lane, from) {
      const { owner } = setup
      const doc = await docs.laneDoc(lane)
      // Who the update is by: the person behind the run.
      const by = doc === null ? null : readRunAuthor(doc, docs.session, lane)
      if (
        !registry.isOwn(lane) ||
        owner === null ||
        doc === null ||
        by === null
      )
        return refusedAnswer("no-copy")
      // gather
      const index = readTreeIndex(doc)
      const tip = readLaneTip(doc, lane)
      const parent = from === "parent" ? await parentOf(lane) : null
      // plan
      const call = planCatchUpCall({
        from,
        own: true,
        calls:
          tip === null
            ? 0
            : toolCallsOf(index.entries[turnEntry(index, tip)]?.message).length,
        base: catchUpOf(
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
        owner,
        call.command,
        await resolutionOf(""),
      )
      if (done.kind === "copy") return refusedAnswer(done.why)
      if (done.kind === "refused") return refusedAnswer({ reason: done.reason })
      if (done.kind !== "merged") return catchUpAnswer({ kind: "nothing" })
      const settle = planSettle(done.facts, {
        lane,
        by,
        from: done.from,
        index: readTreeIndex(doc),
        now: basics.now(),
      })
      if (settle.fetch !== null) void deps.fetchLane(lane, settle.fetch)
      return catchUpAnswer(
        settle.kind === "clean"
          ? { kind: "clean", message: settle.message, merged: settle.merge }
          : settle,
      )
    },

    async prepareUpdate(handle, by, intent, command, follows) {
      const lane = handle.name
      const { owner } = setup
      if (!registry.isOwn(lane) || owner === null)
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
            owner,
            command,
            await resolutionOf(intent),
          )
          if (done.kind === "copy") return refused(catchUpRefusal(done.why))
          if (done.kind !== "merged") return done
          const { from, facts } = done
          const doc = await docs.laneDoc(lane)
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
              fetchLane: have => void deps.fetchLane(lane, have),
            },
            settle,
          )
        },
      )
    },
  }
}
