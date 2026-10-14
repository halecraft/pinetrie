// Every read an offer step plans from, in core's types. The host passes in
// what only the documents know (`OfferInput`). Nothing here writes. A refresh
// of a lane on the line reads it in one `jj log` (`gatherLane`), every other
// gather the separate reads: `repo.test.ts` holds them to the same values.

import type {
  BaseRecord,
  CatchUpRead,
  CommitId,
  LaneBase,
  OfferAcceptanceFacts,
  OfferGather,
  OfferInRepo,
  OfferPlace,
  OfferSource,
  RefreshFacts,
  RepoConfig,
  StackFacts,
  StartRead,
  ThreadId,
  ThreadName,
  WorkChanges,
} from "@pinetrie/core"
import { lines, type Runner } from "@pinetrie/lanes"
import { readWipState } from "./accepted.ts"
import { type CatchUpTarget, readCatchUp } from "./catch-up.ts"
import { laneBase } from "./lane/base.ts"
import { revsetName } from "./lane/names.ts"
import { commitsOf, titlesOf } from "./lane/revisions.ts"
import { gatherLane } from "./lane-read.ts"
import {
  laneTipIn,
  query,
  readOffer,
  startOfOffer,
  workChanges,
} from "./offer.ts"
import type { RepoOps, RepoReads } from "./owner.ts"

/** What the documents say of a lane, read by the host before it gathers. */
export interface OfferInput {
  readonly lane: ThreadId
  /** The thread's name: an offer is found by it. Undefined before it is named. */
  readonly name: ThreadName | undefined
  readonly repoConfig: RepoConfig
  /** What catching up would change, as the page's base record last said: kept at the same tip and base commit (`readCatchUp`). */
  readonly known: CatchUpRead | null
}

/** A split's stack, after its run: where it starts and ends, and its bookmark's commit. */
export interface StackSpan {
  readonly start: readonly CommitId[]
  readonly tip: CommitId
  /** The stack's bookmark's commit; null when the run never set it. */
  readonly top: CommitId | null
}

/** What a refresh plans from (`planRefresh`), and the lane's base record. */
export type RefreshGather =
  /** No name yet, a lane not placed here: nothing moves. */
  | { readonly kind: "none" }
  /** A WIP gone without landing: nothing moves, and the page is told. */
  | { readonly kind: "gone"; readonly base: BaseRecord }
  | {
      readonly kind: "plan"
      readonly name: ThreadName
      /** Null for an archived thread, whose lane's history left your repo. */
      readonly base: BaseRecord | null
      readonly facts: RefreshFacts
    }

/** The lane's base record, as the repo says it now. */
const baseRecord = (
  lane: ThreadId,
  input: {
    readonly base: LaneBase
    readonly state: BaseRecord["state"]
    readonly start: StartRead
    readonly catchUp: CatchUpRead | null
    readonly work: WorkChanges
  },
): BaseRecord => ({
  lane,
  base: input.base.base,
  start: input.base.start,
  state: input.state,
  catchUp: input.catchUp,
  untraced:
    input.start.kind === "untraced" ? input.start.acceptedOfferCommits : [],
  work: input.work,
})

/** A place with a target: untraced, or placed when its start is known. */
type Sited = Exclude<OfferPlace, { readonly kind: "gone" }>

/** Where a place with a target sits, decided once. */
const sited = (input: {
  readonly tip: CommitId
  readonly base: LaneBase
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
  readonly base: LaneBase
  readonly state: BaseRecord["state"]
  readonly target: CommitId | null
  readonly start: StartRead
}): OfferPlace => {
  const { state, target } = input
  return state === "gone" || target === null
    ? { kind: "gone", tip: input.tip, base: input.base }
    : sited({ ...input, state, target })
}

const commitOf = async (jj: Runner, bookmark: string) =>
  (await commitsOf(jj, `present(${revsetName(bookmark)})`))[0] ?? null

/** A target of `kind` at `commit`; null when the bookmark names none. */
const targetOf = (
  kind: CatchUpTarget["kind"],
  commit: CommitId | null,
): CatchUpTarget | null => (commit === null ? null : { kind, commit })

/**
 * Where a lane's offer sits and starts, and its base record, by the separate
 * reads: its base from the lane's newest `Pinetrie-Base`, its target accepted work's
 * commit or the WIP's, its start `startOfOffer`. Null before the lane has a
 * tip here, or a accepted commit in its history.
 */
async function placeOf(
  jj: Runner,
  input: OfferInput,
): Promise<{
  readonly place: OfferPlace
  readonly base: BaseRecord
  readonly work: WorkChanges
} | null> {
  const { repoConfig, lane } = input
  const tip = await laneTipIn(jj, lane)
  if (tip === null) return null
  const base = await laneBase(jj, tip, repoConfig)
  if (base === null) return null
  const state = await readWipState(jj, repoConfig, base)
  // A WIP still above accepted work is the target, and its update a copy of
  // it; a landed WIP's update merges accepted work (`planUpdateFrom`).
  const target =
    base.base.kind === "wip" && state === "ok"
      ? targetOf("wip", await commitOf(jj, base.base.bookmark))
      : state === "gone"
        ? null
        : targetOf("accepted", await commitOf(jj, repoConfig.acceptedBookmark))
  const start = await startOfOffer(jj, { tip, base, repoConfig, lane })
  const catchUp =
    target === null
      ? null
      : await readCatchUp(jj, { base, start, target, tip, known: input.known })
  // An untraced start reads nothing: its work is unknown, which builds no offer.
  const work = await workChanges(jj, { start, tip })
  return {
    place: placeFrom({
      tip,
      base,
      state,
      target: target?.commit ?? null,
      start,
    }),
    base: baseRecord(lane, { base, state, start, catchUp, work }),
    work,
  }
}

/** Where a lane's offer sits and starts, with no read of the offer itself: a split's span. */
export const gatherPlace = (
  ops: Pick<RepoOps, "jj">,
  input: OfferInput,
): Promise<OfferPlace | null> =>
  placeOf(ops.jj, input).then(read => read?.place ?? null)

/**
 * The one gather an acceptance, a squash, a description and a split plan from:
 * where the lane's offer sits, and the offer as your repo holds it there.
 * Null offer with no name yet, or a WIP gone. Null before the lane has a tip
 * here. Writes nothing, so it runs in a step or pinned.
 */
export async function gatherOffer(
  ops: Pick<RepoOps, "jj">,
  input: OfferInput,
): Promise<OfferGather | null> {
  const read = await placeOf(ops.jj, input)
  if (read === null) return null
  const { place, base } = read
  const { name } = input
  const offer =
    name === undefined || place.kind === "gone"
      ? null
      : await readOffer(ops.jj, { name, target: place.target })
  return { place, name, offer, base }
}

/**
 * What a refresh plans from. An archived thread's offer is read against the
 * line: its lane's history is gone, and with it its base, and the thread's
 * trailer leaves a WIP's own commits out of the offer. A lane on accepted work is
 * read in one `jj log` with the shared facts; a lane on a WIP the
 * separate way, since its target and state need more of your repo.
 */
export async function gatherRefresh(
  ops: RepoOps,
  input: OfferInput & { readonly archived: boolean },
): Promise<RefreshGather> {
  const { jj } = ops
  const { lane, name, repoConfig } = input
  if (name === undefined) return { kind: "none" }
  if (input.archived) {
    const target = `present(${revsetName(repoConfig.acceptedBookmark)})`
    const offer = await readOffer(jj, { name, target })
    return {
      kind: "plan",
      name,
      base: null,
      facts: { kind: "archived", offer },
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
  if (gathered !== "wip") {
    const { tip, base, target, start, offer, work, catchUp } = gathered
    return {
      kind: "plan",
      name,
      base: baseRecord(lane, { base, state: "ok", start, catchUp, work }),
      facts: factsOf(sited({ tip, base, state: "ok", target, start }), {
        work,
        offer,
      }),
    }
  }
  const read = await placeOf(jj, input)
  if (read === null) return { kind: "none" }
  const { place, base, work } = read
  if (place.kind === "gone") return { kind: "gone", base }
  const offer = await readOffer(jj, { name, target: place.target })
  return { kind: "plan", name, base, facts: factsOf(place, { work, offer }) }
}

/** A refresh's facts at a place that is not gone. */
const factsOf = (
  place: Sited,
  read: { readonly work: WorkChanges; readonly offer: OfferInRepo | null },
): RefreshFacts =>
  place.kind === "placed"
    ? { kind: "placed", place, work: read.work, offer: read.offer }
    : { kind: "untraced", offer: read.offer }

/**
 * What an acceptance reads besides its gather: how many of the WIP's commits land
 * with it on accepted work, and which of accepted work's and the WIP's bookmarks sit
 * at or below the offer's bottom's parent, so a move to one is forward. Null
 * without an offer to accept: none, divergent, or a WIP gone.
 */
export async function gatherOfferAcceptance(
  ops: Pick<RepoOps, "jj">,
  gathered: OfferGather,
  repoConfig: RepoConfig,
): Promise<OfferAcceptanceFacts | null> {
  const { jj } = ops
  const { place, offer } = gathered
  if (place.kind === "gone" || offer?.kind !== "offer") return null
  const [bottom] = offer.revisions
  if (bottom === undefined) return null
  const { base } = place.base
  const wipAhead =
    base.kind === "wip"
      ? (
          await commitsOf(
            jj,
            `::present(${revsetName(base.bookmark)}) ~ ::present(${revsetName(repoConfig.acceptedBookmark)})`,
          )
        ).length
      : 0
  const below = new Set<string>()
  for (const bookmark of [
    ...(base.kind === "wip" ? [base.bookmark] : []),
    repoConfig.acceptedBookmark,
  ])
    if (
      (
        await commitsOf(
          jj,
          `present(${revsetName(bookmark)}) & ::parents(${bottom.commit})`,
        )
      ).length > 0
    )
      below.add(bookmark)
  return { wipAhead, below }
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
  const commits = await commitsOf(
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
  const revisions: OfferSource[] = []
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
  const recent = await titlesOf(reads.jj, "ancestors(@-, 20)").catch(() => [])
  return { diff: diff ?? "", recent }
}
