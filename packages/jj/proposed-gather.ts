// Every read a step on proposed changes plans from, in core's types. The host
// passes in what only the documents know (`ProposedChangesInput`). Nothing here
// writes. A refresh of a lane on the line reads it in one `jj log`
// (`gatherLane`), every other gather the separate reads: `repo.test.ts` holds
// them to the same values.

import type {
  AcceptanceFacts,
  CommitBase,
  CommitId,
  FilesTouched,
  GetLatestRead,
  JjBaseRecord,
  ProposedChangesGather,
  ProposedChangesInRepo,
  ProposedChangesPlace,
  ProposedSource,
  RefreshFacts,
  RepoConfig,
  StackFacts,
  StartRead,
  ThreadId,
  ThreadName,
} from "@pinetrie/core"
import { lines, type Runner } from "@pinetrie/lanes"
import { readUnfinishedState } from "./accepted.ts"
import { type GetLatestTarget, readGetLatest } from "./get-latest.ts"
import { laneBase } from "./lane/base.ts"
import { proposedBookmark, revsetName } from "./lane/names.ts"
import { readCommits, readTitles } from "./lane/revisions.ts"
import { gatherLane } from "./lane-read.ts"
import type { RepoOps, RepoReads } from "./owner.ts"
import {
  filesTouched,
  laneTipIn,
  query,
  readHostVersion,
  readProposedChanges,
  startOfProposed,
} from "./proposed.ts"

/** What the documents say of a lane, read by the host before it gathers. */
export interface ProposedChangesInput {
  readonly lane: ThreadId
  /** The thread's name: proposed changes are found by it. Undefined before it is named. */
  readonly name: ThreadName | undefined
  readonly repoConfig: RepoConfig
  /** What catching up would change, as the page's base record last said: kept at the same tip and base commit (`readGetLatest`). */
  readonly known: GetLatestRead | null
}

/** A split's stack, after its run: where it starts and ends, and its bookmark's commit. */
interface StackSpan {
  readonly start: readonly CommitId[]
  readonly tip: CommitId
  /** The stack's bookmark's commit; null when the run never set it. */
  readonly top: CommitId | null
}

/** What a refresh plans from (`planRefresh`), and the lane's base record. */
type RefreshGather =
  /** No name yet, a lane not placed here: nothing moves. */
  | { readonly kind: "none" }
  /** A WIP gone without landing: nothing moves, and the page is told. */
  | { readonly kind: "gone"; readonly base: JjBaseRecord }
  | {
      readonly kind: "plan"
      readonly name: ThreadName
      /** Null for an archived thread, whose lane's history left your repo. */
      readonly base: JjBaseRecord | null
      readonly facts: RefreshFacts
    }

/** The lane's base record, as the repo says it now. */
const baseRecord = (
  lane: ThreadId,
  input: {
    readonly base: CommitBase
    readonly state: JjBaseRecord["state"]
    readonly start: StartRead
    readonly getLatest: GetLatestRead | null
    readonly work: FilesTouched
  },
): JjBaseRecord => ({
  kind: "jj",
  lane,
  base: input.base.base,
  start: input.base.start,
  state: input.state,
  getLatest: input.getLatest,
  untraced:
    input.start.kind === "untraced" ? input.start.acceptedThreadCommits : [],
  work: input.work,
})

/** A place with a target: untraced, or placed when its start is known. */
type Sited = Exclude<ProposedChangesPlace, { readonly kind: "gone" }>

/** Where a place with a target sits, decided once. */
const sited = (input: {
  readonly tip: CommitId
  readonly base: CommitBase
  readonly state: "ok" | "landed"
  readonly target: CommitId
  readonly start: StartRead
}): Sited => {
  const { tip, base, state, target, start } = input
  return start.kind === "untraced"
    ? { kind: "untraced", tip, base, state, target }
    : { kind: "placed", tip, base, state, target, start: start.start }
}

/** Where a place sits, from what was read: gone without a target. */
const placeFrom = (input: {
  readonly tip: CommitId
  readonly base: CommitBase
  readonly state: JjBaseRecord["state"]
  readonly target: CommitId | null
  readonly start: StartRead
}): ProposedChangesPlace => {
  const { state, target } = input
  return state === "gone" || target === null
    ? { kind: "gone", tip: input.tip, base: input.base }
    : sited({ ...input, state, target })
}

const commitOf = async (jj: Runner, bookmark: string) =>
  (await readCommits(jj, `present(${revsetName(bookmark)})`))[0] ?? null

/** A target of `kind` at `commit`; null when the bookmark names none. */
const targetOf = (
  kind: GetLatestTarget["kind"],
  commit: CommitId | null,
): GetLatestTarget | null => (commit === null ? null : { kind, commit })

/**
 * Where a lane's proposed changes sit and start, and its base record, by the
 * separate reads: its base from the lane's newest `Pinetrie-Base`, its target
 * accepted work's commit or the WIP's, its start `startOfProposed`. Null before
 * the lane has a tip here, or a accepted commit in its history.
 */
async function placeOf(
  jj: Runner,
  input: ProposedChangesInput,
): Promise<{
  readonly place: ProposedChangesPlace
  readonly base: JjBaseRecord
  readonly work: FilesTouched
} | null> {
  const { repoConfig, lane } = input
  const tip = await laneTipIn(jj, lane)
  if (tip === null) return null
  const base = await laneBase(jj, tip, repoConfig)
  if (base === null) return null
  const state = await readUnfinishedState(jj, repoConfig, base)
  // A WIP still above accepted work is the target, and its update a copy of
  // it; a landed WIP's update merges accepted work (`planUpdateFrom`).
  const target =
    base.base.kind === "unfinished" && state === "ok"
      ? targetOf("unfinished", await commitOf(jj, base.base.bookmark))
      : state === "gone"
        ? null
        : targetOf("accepted", await commitOf(jj, repoConfig.acceptedBookmark))
  const start = await startOfProposed(jj, { tip, base, repoConfig, lane })
  const getLatest =
    target === null
      ? null
      : await readGetLatest(jj, {
          base,
          start,
          target,
          tip,
          known: input.known,
        })
  // An untraced start reads nothing: its work is unknown, which builds no
  // proposed changes.
  const work = await filesTouched(jj, { start, tip })
  return {
    place: placeFrom({
      tip,
      base,
      state,
      target: target?.commit ?? null,
      start,
    }),
    base: baseRecord(lane, { base, state, start, getLatest, work }),
    work,
  }
}

/** Where a lane's proposed changes sit and start, with no read of the proposed changes itself: a split's span. */
export const gatherPlace = (
  ops: Pick<RepoOps, "jj">,
  input: ProposedChangesInput,
): Promise<ProposedChangesPlace | null> =>
  placeOf(ops.jj, input).then(read => read?.place ?? null)

/**
 * The one gather an acceptance, a squash, a description and a split plan from:
 * where the lane's proposed changes sit, and the proposed changes as your repo
 * holds it there. Null proposed changes with no name yet, or a WIP gone. Null
 * before the lane has a tip here. Writes nothing, so it runs in a step or
 * pinned.
 */
export async function gatherProposedChanges(
  ops: Pick<RepoOps, "jj">,
  input: ProposedChangesInput,
): Promise<ProposedChangesGather | null> {
  const read = await placeOf(ops.jj, input)
  if (read === null) return null
  const { place, base } = read
  const { name } = input
  const proposed =
    name === undefined || place.kind === "gone"
      ? null
      : await readProposedChanges(ops.jj, { name, target: place.target })
  return { place, name, proposed, base }
}

/**
 * The proposed changes under `name`'s bookmark at `target`, and whether the
 * host's version is left with no proposed changes beside it: read only when
 * there is none.
 */
async function readProposedAndHost(
  jj: Runner,
  name: ThreadName,
  target: string,
): Promise<{
  readonly proposed: ProposedChangesInRepo | null
  readonly hostLeft: boolean
}> {
  const proposed = await readProposedChanges(jj, { name, target })
  return {
    proposed,
    hostLeft:
      proposed === null &&
      (await readHostVersion(jj, proposedBookmark(name))) !== null,
  }
}

/**
 * What a refresh plans from. An archived thread's proposed changes are read
 * against the line: its lane's history is gone, and with it its base, and the
 * thread's trailer leaves a WIP's own commits out of the proposed changes. A
 * lane on accepted work is read in one `jj log` with the shared facts; a lane
 * on a WIP the separate way, since its target and state need more of your repo.
 */
export async function gatherRefresh(
  ops: RepoOps,
  input: ProposedChangesInput & { readonly archived: boolean },
): Promise<RefreshGather> {
  const { jj } = ops
  const { lane, name, repoConfig } = input
  if (name === undefined) return { kind: "none" }
  if (input.archived) {
    const target = `present(${revsetName(repoConfig.acceptedBookmark)})`
    const { proposed, hostLeft } = await readProposedAndHost(jj, name, target)
    return {
      kind: "plan",
      name,
      base: null,
      facts: { kind: "archived", proposed, hostLeft },
    }
  }
  const gathered = await gatherLane(jj, {
    lane,
    name,
    repoConfig,
    shared: await ops.shared(),
    known: input.known,
  })
  if (gathered === "none") return { kind: "none" }
  if (gathered !== "unfinished") {
    const { tip, base, target, start, proposed, hostLeft, work, getLatest } =
      gathered
    return {
      kind: "plan",
      name,
      base: baseRecord(lane, { base, state: "ok", start, getLatest, work }),
      facts: factsOf(sited({ tip, base, state: "ok", target, start }), {
        work,
        proposed,
        hostLeft,
      }),
    }
  }
  const read = await placeOf(jj, input)
  if (read === null) return { kind: "none" }
  const { place, base, work } = read
  if (place.kind === "gone") return { kind: "gone", base }
  const { proposed, hostLeft } = await readProposedAndHost(
    jj,
    name,
    place.target,
  )
  return {
    kind: "plan",
    name,
    base,
    facts: factsOf(place, { work, proposed, hostLeft }),
  }
}

/** A refresh's facts at a place that is not gone. */
const factsOf = (
  place: Sited,
  read: {
    readonly work: FilesTouched
    readonly proposed: ProposedChangesInRepo | null
    readonly hostLeft: boolean
  },
): RefreshFacts =>
  place.kind === "placed"
    ? {
        kind: "placed",
        place,
        work: read.work,
        proposed: read.proposed,
        hostLeft: read.hostLeft,
      }
    : { kind: "untraced", proposed: read.proposed, hostLeft: read.hostLeft }

/**
 * What an acceptance reads besides its gather: how many of the WIP's commits
 * land with it on accepted work, and which of accepted work's and the WIP's
 * bookmarks sit at or below the proposed changes' bottom's parent, so a move to
 * one is forward. Null without proposed changes to accept: none, divergent, or
 * a WIP gone.
 */
export async function gatherAcceptance(
  ops: Pick<RepoOps, "jj">,
  gathered: ProposedChangesGather,
  repoConfig: RepoConfig,
): Promise<AcceptanceFacts | null> {
  const { jj } = ops
  const { place, proposed } = gathered
  if (place.kind === "gone" || proposed?.kind !== "present") return null
  const [bottom] = proposed.revisions
  if (bottom === undefined) return null
  const { base } = place.base
  const unfinishedAhead =
    base.kind === "unfinished"
      ? (
          await readCommits(
            jj,
            `::present(${revsetName(base.bookmark)}) ~ ::present(${revsetName(repoConfig.acceptedBookmark)})`,
          )
        ).length
      : 0
  const below = new Set<string>()
  for (const bookmark of [
    ...(base.kind === "unfinished" ? [base.bookmark] : []),
    repoConfig.acceptedBookmark,
  ])
    if (
      (
        await readCommits(
          jj,
          `present(${revsetName(bookmark)}) & ::parents(${bottom.commit})`,
        )
      ).length > 0
    )
      below.add(bookmark)
  return { unfinishedAhead, below }
}

/**
 * A split's stack as its run left it: its revisions, bottom first, each with
 * its message, and the files its top differs from the lane's tip in.
 * "no-top" when the run never set the stack's bookmark.
 */
export async function gatherStack(
  ops: Pick<RepoOps, "jj">,
  stack: StackSpan,
): Promise<StackFacts | "no-top"> {
  const { jj } = ops
  if (stack.top === null) return "no-top"
  const commits = await readCommits(
    jj,
    `(${stack.start.join(" | ")})..${stack.top}`,
  )
  const differing = lines(
    await query(jj, [
      "diff",
      "--from",
      stack.tip,
      "--to",
      stack.top,
      "--name-only",
    ]),
  )
  const revisions: ProposedSource[] = []
  for (const commit of commits.toReversed())
    revisions.push({
      commit,
      description: await query(jj, [
        "log",
        "--no-graph",
        "-r",
        commit,
        "-T",
        "description",
      ]),
    })
  return { revisions, differing }
}

/**
 * What a commit message is asked from, read pinned: the revision's git diff
 * and your repo's recent titles. Either is empty when jj cannot read it.
 */
export async function gatherDescribe(
  reads: Pick<RepoReads, "jj">,
  commit: CommitId,
): Promise<{ readonly diff: string; readonly recent: readonly string[] }> {
  const diff = (
    await reads.jj(["diff", "-r", commit, "--git"]).catch(() => null)
  )?.stdout
  const recent = await readTitles(reads.jj, "ancestors(@-, 20)").catch(() => [])
  return { diff: diff ?? "", recent }
}
