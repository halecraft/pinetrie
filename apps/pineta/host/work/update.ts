// host/work/update — your work merged into a lane (ADR-0038), and the
// resolution run's outcome when it conflicts (ADR-0033).

import {
  type CommitId,
  type EntryId,
  firstLine,
  type LaneName,
  messageText,
  snapshotId,
  type TreeIndex,
  turnEntry,
  WORKSPACE_ROOT,
  type WriterId,
} from "@pineta/core"
import {
  bookmarkOf,
  COPY_MESSAGE,
  commitsOf,
  commitTurn,
  conflictContent,
  conflictsIn,
  entryOfMessage,
  executeOrThrow,
  hostJj,
  type LaneHandle,
  lines,
  mergeYours,
  planYourCopy,
  type Runner,
  sideHistory,
  yoursAt,
} from "@pineta/lanes"
import {
  type ConflictFile,
  decodeLand,
  encodeUpdate,
  type LandMessage,
  landingOutcome,
  planResolution,
  type UpdateDetails,
  updatePrefill,
} from "@pineta/marginalia"
import type { Agent, LaneChannel, ThreadLaneHandle } from "@pineta/pi"
import { readTreeIndex } from "@pineta/reads"
import { readEntryMessage, readLaneTip } from "@pineta/schema"
import { type Basics, failed, messageOf } from "../basics.ts"
import type { Containers } from "./containers.ts"
import { writeCopy } from "./create.ts"
import { snapshotOnQueue } from "./disk.ts"
import type { Fetches } from "./fetch.ts"
import type { LaneRegistry } from "./registry.ts"
import type { Setup } from "./setup.ts"
import type { Turns } from "./turns.ts"

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
 * lane stopped as after a run. Returns the composer's prefill.
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
): Promise<string> {
  const appended = await ports.append(encodeUpdate(clean.details, clean.now))
  if (appended.kind === "appended")
    await ports.recordUpdate(appended.id, clean.merge)
  ports.runEnded()
  return updatePrefill(clean.details)
}

export type Prepared =
  | { readonly kind: "clean"; readonly prefill: string }
  | { readonly kind: "conflicted"; readonly message: LandMessage }
  | { readonly kind: "nothing" }
  | { readonly refused: string }

export interface Updates {
  /**
   * Merge a copy of your `@` into the lane (ADR-0038). Clean: the update is
   * appended to the thread, and its prefill returned. Conflicted: the land
   * message for the resolution run. Nothing new: nothing to do.
   */
  prepareUpdate(lane: LaneName, by: WriterId): Promise<Prepared>
  /** A resolution run ended: its outcome, from the repository. */
  landingEnded(lane: LaneName, prompt: EntryId): Promise<void>
  /** pi's hook: the resolution run's agent asked for guidance. */
  askedForGuidance(lane: LaneName): void
}

export function createUpdates(deps: {
  readonly basics: Basics
  readonly setup: Pick<Setup, "root" | "paths">
  readonly registry: LaneRegistry
  readonly agent: () => Agent
  readonly containers: Pick<Containers, "beforeRun" | "runEnded">
  readonly fetchLane: Fetches["fetchLane"]
  readonly writeRevision: Turns["writeRevision"]
}): Updates {
  const { basics, setup, registry, containers } = deps
  const { doc } = basics
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
    })
    void deps.fetchLane(lane, [merge])
  }

  /**
   * On the lane's queue: anything edited since the last run committed, a
   * copy of your `@` made, and merged in.
   */
  const mergeYourCopy = (
    lane: LaneName,
    handle: LaneHandle<LaneChannel>,
    jj: Runner,
    yours: Awaited<ReturnType<typeof yoursAt>>,
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
      await executeOrThrow(planYourCopy(yours), handle.runners)
      const [copy] = await commitsOf(jj, "@-")
      if (copy === undefined) throw new Error("the copy of your @ is missing")
      return { copy, ...(await mergeYours(jj, lane, [copy])) }
    })

  /** What changed under the agent, and your commits that came in. */
  async function gatherClean(
    handle: LaneHandle<LaneChannel>,
    jj: Runner,
    merged: {
      readonly copy: CommitId
      readonly ours: CommitId
      readonly merge: CommitId
    },
  ) {
    const { copy, ours, merge } = merged
    const files = lines(
      (
        await handle.runners.lane([
          "git",
          "-C",
          WORKSPACE_ROOT,
          "diff",
          "--name-only",
          ours,
          merge,
        ])
      ).stdout,
    )
    const commits = (
      await commitsOf(jj, `fork_point(${ours} | ${copy})..${copy}`)
    ).filter(c => c !== copy)
    const titles: string[] = []
    for (const c of commits) {
      const ran = await jj([
        "log",
        "--ignore-working-copy",
        "--no-graph",
        "-r",
        c,
        "-T",
        "description.first_line()",
      ])
      if (ran.ok && ran.stdout.trim() !== COPY_MESSAGE)
        titles.push(ran.stdout.trim())
    }
    return { files, commits: titles }
  }

  /** Each conflicted file, and why each side changed it. */
  async function gatherConflicts(
    jj: Runner,
    conflicted: readonly string[],
    merged: { readonly copy: CommitId; readonly ours: CommitId },
  ): Promise<ConflictFile[]> {
    const { copy, ours } = merged
    const files: ConflictFile[] = []
    for (const file of conflicted) {
      const reasons = async (side: readonly CommitId[], asMessages: boolean) =>
        (await sideHistory(jj, { ours, theirs: [copy] }, side, file)).map(
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
          who: "your working copy",
          reasons: await reasons([copy], false),
        },
      })
    }
    return files
  }

  return {
    askedForGuidance(lane) {
      asked.add(lane)
    },

    async prepareUpdate(lane, by) {
      const { root } = setup
      if (!registry.isOwn(lane) || root === null)
        return { refused: "the lane has no copy of its own" }
      try {
        containers.beforeRun(lane)
        const handle = registry.handleOf(lane)
        const jj = registry.laneJjOf(lane)
        const yours = await yoursAt(hostJj(root))
        // execute: anything edited since the last run, a copy of your @, the merge
        const merged = await mergeYourCopy(lane, handle, jj, yours)
        const { copy, ours, merge } = merged
        await writeCopy(deps.agent(), lane, copy, basics.now())
        if (merge === null) return { kind: "nothing" }
        const conflicted = await conflictsIn(jj)
        if (conflicted.length === 0) {
          const gathered = await gatherClean(handle, jj, { copy, ours, merge })
          const prefill = await applyClean(
            {
              append: message => deps.agent().lane(lane).append(message),
              recordUpdate: (entry, at) => recordUpdate(lane, entry, at),
              runEnded: () => containers.runEnded(lane),
            },
            {
              details: { lane, copy, ...gathered, by },
              merge,
              now: basics.now(),
            },
          )
          return { kind: "clean", prefill }
        }
        const files = await gatherConflicts(jj, conflicted, { copy, ours })
        const skill = await deps.agent().skill("pineta:skill:resolve-conflicts")
        // plan
        return {
          kind: "conflicted",
          message: planResolution({
            skill,
            files,
            budget: RESOLUTION_BUDGET,
            details: { landing: basics.newId(), lane, yours: [copy], by },
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
        await deps.agent().setWorkRecord({
          kind: "landing",
          record: {
            id: details.landing,
            lane,
            prompt,
            state: landingOutcome({
              askedForGuidance: wasAsked,
              conflictsLeft: left.length,
            }),
            by: details.by,
            at: basics.now(),
          },
        })
      } catch (error) {
        failed(basics, "the resolution's outcome", lane)(error)
      }
    },
  }
}
