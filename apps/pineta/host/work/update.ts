// host/work/update — a thread's base merged into its lane, when the host
// takes a card whose command is `bring-up-to-date` or `continue-on-line`
// (ADR-0055, ADR-0060), and the resolution run's outcome when it conflicts
// (ADR-0033).

import {
  type CommitId,
  type EntryId,
  ERR,
  type ErrCode,
  firstLine,
  type LaneName,
  messageText,
  snapshotId,
  type TreeIndex,
  turnEntry,
  type WriterId,
} from "@pineta/core"
import {
  baseMessage,
  beginFacts,
  bookmarkName,
  bookmarkOf,
  changedPaths,
  commitsOf,
  commitTurn,
  conflictContent,
  conflictsIn,
  DEFAULT_LINE,
  entryOfMessage,
  executeOrThrow,
  fetchById,
  hostJj,
  type LaneHandle,
  markBase,
  mergeBase,
  newestBase,
  planWipCopy,
  type Runner,
  revsetName,
  sideHistory,
  wipFacts,
} from "@pineta/lanes"
import {
  type ConflictFile,
  decodeLand,
  encodeUpdate,
  LANDING,
  type LandMessage,
  landingOutcome,
  planResolution,
  planUpdateFrom,
  setRecord,
  type UpdateDetails,
  type UpdateFrom,
  wipState,
} from "@pineta/marginalia"
import type { Agent, LaneChannel, ThreadLaneHandle } from "@pineta/pi"
import { readTreeIndex } from "@pineta/reads"
import { readEntryMessage, readLaneTip } from "@pineta/schema"
import { type Basics, failed, messageOf } from "../basics.ts"
import type { Containers } from "./containers.ts"
import { snapshotOnQueue } from "./disk.ts"
import type { Fetches } from "./fetch.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { Turns } from "./turns.ts"

/** Why an update was refused, worded once (ADR-0060). */
export function updateRefusal(code: ErrCode): string {
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
 * A clean update's writes, in order: the update as a fact in the thread, its
 * revision (so a branch below it starts with the merged files), then the
 * lane stopped as after a run.
 */
export async function applyClean(
  ports: {
    readonly append: ThreadLaneHandle["append"]
    readonly recordUpdate: (entry: EntryId, merge: CommitId) => Promise<void>
    readonly runEnded: () => void
  },
  clean: {
    readonly details: UpdateDetails
    readonly merge: CommitId
    readonly now: number
  },
): Promise<void> {
  const appended = await ports.append(encodeUpdate(clean.details, clean.now))
  if (appended.kind === "appended")
    await ports.recordUpdate(appended.id, clean.merge)
  ports.runEnded()
}

export type Prepared =
  | { readonly kind: "clean" }
  | { readonly kind: "conflicted"; readonly message: LandMessage }
  | { readonly kind: "nothing" }
  | { readonly refused: string }

export interface Updates {
  /**
   * Merge the thread's base into the lane (ADR-0060): the line's commit, or a
   * fresh copy of its WIP; with `toLine`, the line, moving the thread there.
   * Clean: the update is appended to the thread. Conflicted: the land
   * message for the resolution run, with `intent` (the card's text) after
   * the conflicts. Nothing new: nothing to do.
   */
  prepareUpdate(
    lane: LaneName,
    by: WriterId,
    intent: string,
    toLine: boolean,
  ): Promise<Prepared>
  /** A resolution run ended: its outcome, from the repository. */
  landingEnded(lane: LaneName, prompt: EntryId): Promise<void>
  /** pi's hook: the resolution run's agent asked for guidance. */
  askedForGuidance(lane: LaneName): void
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
  const { doc } = basics
  const line = setup.lanes?.line ?? DEFAULT_LINE
  /** Resolution runs whose agent called `ask_for_guidance`. */
  const asked = new Set<LaneName>()

  /**
   * The update's entry recorded as a revision, the merge its commit, with a
   * snapshot, so a branch below it starts with the merged files. Your repo
   * then fetches the merge, and the offer follows.
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
      // An update is in no ask, so no ask counts its files.
      paths: [],
    })
    void deps.fetchLane(lane, [merge])
  }

  /**
   * On the lane's queue: anything edited since the last run committed, then
   * the base merged in: the line's commit, fetched, with its `Pineta-Base`
   * on the merge; or a fresh copy of the WIP, which carries it, made on the
   * lane's last copy (`after`), so the merge brings in only what the WIP
   * changed since, never conflicts the lane already resolved. A thread moved
   * to the line with nothing to merge gets a commit that says so.
   */
  const mergeOnQueue = (
    lane: LaneName,
    handle: LaneHandle<LaneChannel>,
    jj: Runner,
    from: Exclude<UpdateFrom, { kind: "nothing" }>,
    moving: boolean,
    after: CommitId | null,
  ) =>
    handle.queue.enqueue(async () => {
      const tip = readLaneTip(doc, lane)
      if (tip !== null)
        await commitTurn(jj, {
          title: "edits between runs",
          entry: turnEntry(readTreeIndex(doc), tip),
          lane,
          bookmark: await bookmarkOf(jj, lane),
        })
      if (from.kind === "line") {
        const message = baseMessage(`update: ${from.onto}`, {
          bookmark: from.onto,
          commit: from.commit,
        })
        await executeOrThrow([fetchById([from.commit])], handle.runners)
        const merged = await mergeBase(jj, lane, from.commit, message)
        if (merged.merge === null && moving) await markBase(jj, lane, message)
        return { from: from.commit, ...merged }
      }
      await executeOrThrow(
        planWipCopy({ ...from, under: after ?? from.under }),
        handle.runners,
      )
      const [copy] = await commitsOf(jj, "@-")
      if (copy === undefined) throw new Error("the WIP's copy is missing")
      const merged = await mergeBase(jj, lane, copy, `update: ${from.bookmark}`)
      return { from: copy, ...merged }
    })

  /** What changed under the agent, and the commits that came in. */
  async function gatherClean(
    handle: LaneHandle<LaneChannel>,
    jj: Runner,
    merged: {
      readonly from: CommitId
      readonly ours: CommitId
      readonly merge: CommitId
    },
    came: string,
  ) {
    const { ours, merge } = merged
    const files = await changedPaths(handle.runners.lane, ours, merge)
    const titles: string[] = []
    for (const c of await commitsOf(jj, came)) {
      const ran = await jj([
        "log",
        "--ignore-working-copy",
        "--no-graph",
        "-r",
        c,
        "-T",
        "description.first_line()",
      ])
      if (ran.ok && ran.stdout.trim() !== "") titles.push(ran.stdout.trim())
    }
    return { files, commits: titles }
  }

  /** Each conflicted file, and why each side changed it. */
  async function gatherConflicts(
    jj: Runner,
    conflicted: readonly string[],
    merged: { readonly from: CommitId; readonly ours: CommitId },
    base: string,
  ): Promise<ConflictFile[]> {
    const { from, ours } = merged
    const files: ConflictFile[] = []
    for (const file of conflicted) {
      const reasons = async (side: readonly CommitId[], asMessages: boolean) =>
        (await sideHistory(jj, { ours, theirs: [from] }, side, file)).map(
          description =>
            asMessages
              ? reasonOf(readTreeIndex(doc), description)
              : firstLine(description, 200),
        )
      files.push({
        path: file,
        content: await conflictContent(jj, file),
        ours: {
          label: "ours",
          who: "this thread",
          reasons: await reasons([ours], true),
        },
        theirs: {
          label: "theirs",
          who: base,
          reasons: await reasons([from], false),
        },
      })
    }
    return files
  }

  return {
    askedForGuidance(lane) {
      asked.add(lane)
    },

    async prepareUpdate(lane, by, intent, toLine) {
      const { root } = setup
      if (!registry.isOwn(lane) || root === null)
        return { refused: "the lane has no copy of its own" }
      try {
        containers.beforeRun(lane)
        const handle = registry.handleOf(lane)
        const jj = registry.laneJjOf(lane)
        const yours = hostJj(root)
        // gather: the lane's base, from its history; the line and the WIP, from your repo
        const newest = await handle.queue.enqueue(() =>
          newestBase(jj, `bookmarks(exact:${revsetName(bookmarkName(lane))})`),
        )
        const [lineCommit] = await commitsOf(
          yours,
          `present(${revsetName(line.onto)})`,
        )
        const onWip = newest !== null && newest.bookmark !== line.onto
        const wip = onWip
          ? {
              state: wipState(
                await wipFacts(yours, line, newest.bookmark, newest.commit),
              ),
              now: (await beginFacts(yours, line, newest.bookmark)).wip,
            }
          : null
        // plan
        const from = planUpdateFrom({
          onto: line.onto,
          newest,
          toLine,
          line: lineCommit ?? null,
          wip,
        })
        if (typeof from === "string") return { refused: updateRefusal(from) }
        if (from.kind === "nothing") return { kind: "nothing" }
        const base = from.kind === "line" ? from.onto : from.bookmark
        const moving = toLine && onWip
        // execute: anything edited since the last run, the base, the merge
        const merged = await mergeOnQueue(
          lane,
          handle,
          jj,
          from,
          moving,
          onWip ? newest.at : null,
        )
        const { ours, merge } = merged
        if (merge === null) return { kind: "nothing" }
        const conflicted = await conflictsIn(jj)
        if (conflicted.length === 0) {
          const came =
            from.kind === "line"
              ? `fork_point(${ours} | ${from.commit})..${from.commit}`
              : `${from.under}..${from.commit}`
          const gathered = await gatherClean(
            handle,
            jj,
            { ...merged, merge },
            came,
          )
          await applyClean(
            {
              append: message => deps.agent().lane(lane).append(message),
              recordUpdate: (entry, at) => recordUpdate(lane, entry, at),
              runEnded: () => containers.runEnded(lane),
            },
            {
              details: {
                lane,
                base: { kind: from.kind, bookmark: base },
                merged: merged.from,
                ...gathered,
                by,
              },
              merge,
              now: basics.now(),
            },
          )
          return { kind: "clean" }
        }
        const files = await gatherConflicts(jj, conflicted, merged, base)
        const skill = await deps.agent().skill("pineta:skill:resolve-conflicts")
        // plan
        return {
          kind: "conflicted",
          message: planResolution({
            skill,
            files,
            budget: RESOLUTION_BUDGET,
            details: {
              landing: basics.newId(),
              lane,
              yours: [merged.from],
              by,
            },
            intent,
            timestamp: basics.now(),
          }),
        }
      } catch (error) {
        return { refused: messageOf(error) }
      }
    },

    async landingEnded(lane, prompt) {
      const stored = readEntryMessage(doc, prompt)
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
          setRecord(LANDING, {
            id: details.landing,
            lane,
            prompt,
            state: landingOutcome({
              askedForGuidance: wasAsked,
              conflictsLeft: left.length,
            }),
            by: details.by,
            at: basics.now(),
          }),
        ])
      } catch (error) {
        failed(basics, "the resolution's outcome", lane)(error)
      }
    },
  }
}
