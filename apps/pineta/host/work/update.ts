// host/work/update — a thread's base merged into its lane, when the host
// takes a card whose command is `bring-up-to-date` or `continue-on-line`
// (ADR-0055, ADR-0060), and the resolution run's outcome when it conflicts
// (ADR-0033). One step on the lane's queue gathers, plans and merges; then
// `planSettle` decides what the thread gets, and `applySettle` writes it.

import {
  type BaseMerge,
  type CommitId,
  type EntryId,
  ERR,
  firstLine,
  indexTree,
  type LaneName,
  messageText,
  snapshotId,
  type TreeIndex,
  turnEntry,
  type WriterId,
} from "@pineta/core"
import {
  beginFacts,
  bookmarkName,
  bookmarkOf,
  bookmarkRevset,
  commitTurn,
  conflictsIn,
  DEFAULT_LINE,
  entryOfMessage,
  hostJj,
  laneBase,
  type Merged,
  mergeUpdate,
  planMerge,
  type Runner,
  type TouchedRevision,
  wipFacts,
} from "@pineta/lanes"
import {
  decodeLand,
  encodeUpdate,
  LANDING,
  type LandMessage,
  landingRecord,
  planResolution,
  planUpdateFrom,
  setRecord,
  type UpdateMessage,
  type UpdateRefusal,
  wipState,
} from "@pineta/marginalia"
import type { Agent, ThreadLaneHandle } from "@pineta/pi"
import { readLatestPrompt, readTreeIndex } from "@pineta/reads"
import { readEntryMessage, readLaneTip } from "@pineta/schema"
import { type Basics, failed, messageOf } from "../basics.ts"
import type { Containers } from "./containers.ts"
import { snapshotOnQueue } from "./disk.ts"
import type { Fetches } from "./fetch.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { Turns } from "./turns.ts"

/** Why an update was refused, worded once (ADR-0060). */
function updateRefusal(code: UpdateRefusal): string {
  return code === ERR.NO_LINE
    ? "set up the line first"
    : "this thread's WIP bookmark is gone: continue it on the line"
}

/** How long a resolution prompt's reasons may run before the oldest go (ADR-0033). */
const RESOLUTION_BUDGET = 60_000

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
 * What taking an update's card comes to (ADR-0055): the update written in
 * the thread, a resolution run's prompt, nothing new, or why not.
 */
export type Prepared =
  | { readonly kind: "clean" }
  | { readonly kind: "conflicted"; readonly message: LandMessage }
  | { readonly kind: "nothing" }
  | { readonly kind: "refused"; readonly reason: string }

const refused = (reason: string): Prepared => ({ kind: "refused", reason })

/**
 * Start the lane, run `update`, and stop the lane again unless a resolution
 * run is to start: that run's end stops it. A throw is a refusal saying why.
 */
export async function withLaneStarted(
  ports: { readonly beforeRun: () => void; readonly runEnded: () => void },
  update: () => Promise<Prepared>,
): Promise<Prepared> {
  const prepared = await (async () => {
    ports.beforeRun()
    return update()
  })().catch((error: unknown) => refused(messageOf(error)))
  if (prepared.kind !== "conflicted") ports.runEnded()
  return prepared
}

/** What a merge found, with what a resolution's prompt needs when it conflicted. */
export type SettleFacts =
  | Exclude<Merged, { readonly kind: "conflicted" }>
  | (Extract<Merged, { readonly kind: "conflicted" }> & {
      readonly skill: Parameters<typeof planResolution>[0]["skill"]
      /** The resolution's id. */
      readonly landing: string
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
 * What a merge comes to (ADR-0060, ADR-0033). Clean: the update, written in
 * the thread, and the merge fetched. Nothing: a mark naming the line, when
 * one was made, fetched. Conflicted: the resolution's prompt, each file with
 * why each side changed it, and the card's text (`intent`) after; nothing is
 * fetched: the resolution's turns fetch the lane as they commit. Pure.
 */
export function planSettle(
  facts: SettleFacts,
  ctx: {
    readonly lane: LaneName
    readonly by: WriterId
    readonly intent: string
    readonly from: BaseMerge
    readonly index: TreeIndex
    readonly now: number
  },
): Settle {
  const { lane, by, from } = ctx
  const bookmark = from.kind === "line" ? from.onto : from.bookmark
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
            base: { kind: from.kind, bookmark },
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
          skill: facts.skill,
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
              who: bookmark,
              reasons: touching(facts.theirs, path).map(d => firstLine(d, 200)),
            },
          })),
          budget: RESOLUTION_BUDGET,
          details: { landing: facts.landing, lane, yours: [facts.from], by },
          intent: ctx.intent,
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
   * Merge the thread's base into the lane (ADR-0060): the line's commit, or a
   * fresh copy of its WIP; with `toLine`, the line, moving the thread there.
   * Clean: the update is appended to the thread. Conflicted: the land
   * message for the resolution run, with `intent` (the card's text) after
   * the conflicts. Nothing new: nothing to do, but a move to the line is
   * fetched. The lane is stopped after, unless a resolution runs.
   */
  prepareUpdate(
    lane: LaneName,
    by: WriterId,
    intent: string,
    toLine: boolean,
  ): Promise<Prepared>
  /** A resolution run ended: its outcome, from the repository. */
  landingEnded(lane: LaneName, prompt: EntryId): Promise<void>
  /**
   * pi's hook: the lane's agent asked for guidance. Taken only while the
   * lane's run is a resolution, its prompt a land message; every lane has
   * the tool (S85), so another run's call is answered that nothing is asked.
   */
  askedForGuidance(lane: LaneName): boolean
}

export function createUpdates(deps: {
  readonly basics: Basics
  readonly setup: Pick<Setup, "root" | "paths" | "lanes">
  readonly registry: LaneRegistry
  readonly agent: () => Agent
  readonly containers: Pick<Containers, "beforeRun" | "runEnded">
  readonly fetchLane: Fetches["fetchLane"]
  readonly writeRevision: Turns["writeRevision"]
}): Updates {
  const { basics, setup, registry, containers } = deps
  const { docs } = basics
  const line = setup.lanes?.line ?? DEFAULT_LINE
  /** Resolution runs whose agent called `ask_for_guidance`. */
  const asked = new Set<LaneName>()

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
    const snapped =
      setup.paths === null
        ? false
        : await snapshotOnQueue(handle, setup.paths, entry).catch(() => false)
    await deps.writeRevision({
      entry,
      lane,
      commit: merge,
      snapshot: snapped ? snapshotId(entry) : null,
      // The update belongs to no ask, so its files count toward none.
      paths: [],
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
   * One step on the lane's queue, so nothing changes the lane between what
   * is read and what is merged: the lane's base from its own history, the
   * line and the WIP from your repo, the plan, and, unless it is refused or
   * has nothing to merge, the edits committed and the base merged.
   */
  const updateOnQueue = (lane: LaneName, root: string, toLine: boolean) => {
    const handle = registry.handleOf(lane)
    const jj = registry.laneJjOf(lane)
    const yours = hostJj(root)
    return handle.queue.enqueue(
      async (): Promise<
        | Prepared
        | {
            readonly kind: "merged"
            readonly from: BaseMerge
            readonly merged: Merged
          }
      > => {
        const base = await laneBase(
          jj,
          bookmarkRevset(bookmarkName(lane)),
          line,
        )
        const state = wipState(await wipFacts(yours, line, base))
        const begin = await beginFacts(
          yours,
          line,
          base?.base.kind === "wip" ? base.base.bookmark : null,
        )
        const from = planUpdateFrom({
          onto: line.onto,
          base,
          state,
          toLine,
          line: begin.line,
          wipNow: begin.wip,
        })
        if (typeof from === "string") return refused(updateRefusal(from))
        if (from.kind === "nothing") return { kind: "nothing" }
        await commitEdits(lane, jj)
        const merged = await mergeUpdate(
          jj,
          handle.runners,
          lane,
          planMerge(from),
        )
        return { kind: "merged", from, merged }
      },
    )
  }

  return {
    askedForGuidance(lane) {
      const doc = docs.docOfLane(lane)
      if (doc === null || readLatestPrompt(doc, lane)?.role !== "land")
        return false
      asked.add(lane)
      return true
    },

    async prepareUpdate(lane, by, intent, toLine) {
      const { root } = setup
      if (!registry.isOwn(lane) || root === null)
        return refused("the lane has no copy of its own")
      return withLaneStarted(
        {
          beforeRun: () => containers.beforeRun(lane),
          runEnded: () => containers.runEnded(lane),
        },
        async () => {
          const done = await updateOnQueue(lane, root, toLine)
          if (done.kind !== "merged") return done
          const { from, merged } = done
          const facts: SettleFacts =
            merged.kind === "conflicted"
              ? {
                  ...merged,
                  skill: await deps
                    .agent()
                    .skill("pineta:skill:resolve-conflicts"),
                  landing: basics.newId(),
                }
              : merged
          const doc = await docs.laneDoc(lane)
          const settle = planSettle(facts, {
            lane,
            by,
            intent,
            from,
            index: doc === null ? indexTree({}) : readTreeIndex(doc),
            now: basics.now(),
          })
          return applySettle(
            {
              append: message => deps.agent().lane(lane).append(message),
              recordUpdate: (entry, merge) => recordUpdate(lane, entry, merge),
              fetchLane: have => void deps.fetchLane(lane, have),
            },
            settle,
          )
        },
      )
    },

    async landingEnded(lane, prompt) {
      const doc = await docs.laneDoc(lane)
      const stored =
        doc === null
          ? { present: false as const }
          : readEntryMessage(doc, prompt)
      const details = stored.present ? decodeLand(stored.message) : undefined
      const wasAsked = asked.delete(lane)
      if (!registry.isOwn(lane) || setup.root === null || details === undefined)
        return
      try {
        // The run recorded its last turn already, as every run does.
        const jj = registry.laneJjOf(lane)
        const left = await registry
          .handleOf(lane)
          .queue.enqueue(() => conflictsIn(jj))
        await deps.agent().writeValues([
          setRecord(
            LANDING,
            landingRecord({
              details,
              lane,
              prompt,
              askedForGuidance: wasAsked,
              conflictsLeft: left.length,
              now: basics.now(),
            }),
          ),
        ])
      } catch (error) {
        failed(basics, "the resolution's outcome", lane)(error)
      }
    },
  }
}
