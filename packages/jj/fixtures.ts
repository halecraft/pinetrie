// jj/fixtures — what jj's tests share: a lane's record proven jj, as the
// adapter proves one (`proveJjLane`); and a lane's work reaching your repo,
// offered and accepted, by the steps the host runs.

import {
  type CommitBase,
  type CommitId,
  type OfferSource,
  type RepoConfig,
  rootIdFor,
  type ThreadId,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import { executeOrThrow, type LaneRunners, type Runner } from "@pinetrie/lanes"
import { laneBase } from "./lane/base.ts"
import { bookmarkName, offerBookmark, revsetName } from "./lane/names.ts"
import { planBundle } from "./lane/plan.ts"
import { type JjLane, proveJjLane } from "./lane/points.ts"
import { commitsOf } from "./lane/revisions.ts"
import { laneTipIn, readOffer, startOfOffer } from "./offer.ts"
import {
  markSteps,
  planImport,
  planOffer,
  planOfferAcceptanceSteps,
} from "./plan.ts"
import { executeRepo, hostOps } from "./run.ts"

/** `lane`'s record, keeping a jj history, proven. */
export function jjLaneFor(lane: ThreadId): JjLane {
  const proved = proveJjLane({
    lane,
    root: rootIdFor("test"),
    history: "jj",
    by: writerId("probe@example.com"),
    createdAt: 0,
  })
  if (proved.kind !== "jj") throw new Error("a jj lane's record is not jj")
  return proved.lane
}

/**
 * A lane's commits into your repo at `yours`, as after a turn: bundled in
 * the lane (`planBundle`), then imported by the host (`planImport`).
 */
export async function fetchLane(
  runners: LaneRunners,
  yours: string,
  input: {
    readonly lane: ThreadId
    readonly have: readonly CommitId[]
    readonly bundle: string
  },
): Promise<void> {
  await executeOrThrow(
    [
      planBundle({
        bookmark: bookmarkName(input.lane),
        have: input.have,
        to: input.bundle,
      }),
    ],
    runners,
  )
  await executeRepo(
    yours,
    planImport({ lane: input.lane, bundle: input.bundle, stack: false }),
  )
}

/** Accepted work's commit in your repo now. */
export async function acceptedIn(
  ops: Runner,
  repoConfig: RepoConfig,
): Promise<CommitId> {
  const [c] = await commitsOf(
    ops,
    `present(${revsetName(repoConfig.acceptedBookmark)})`,
  )
  if (c === undefined) throw new Error("no accepted work")
  return c
}

/** Where `lane`'s offer starts, as commits; throws on an untraced start. */
export async function knownStart(
  jj: Runner,
  input: {
    readonly tip: CommitId
    readonly base: CommitBase
    readonly repoConfig: RepoConfig
    readonly lane: ThreadId
  },
): Promise<readonly CommitId[]> {
  const read = await startOfOffer(jj, input)
  if (read.kind !== "known") throw new Error("an untraced start")
  return read.start
}

/**
 * `lane`'s offer of `sources`, built on accepted work in your repo at
 * `yours` as the host builds it, then found there as the host finds it,
 * with nothing kept. The lane's tip must be fetched already.
 */
export async function buildOffer(
  yours: string,
  input: {
    readonly lane: ThreadId
    readonly name: ThreadName
    readonly sources: readonly OfferSource[]
    readonly repoConfig: RepoConfig
  },
) {
  const { lane, name, repoConfig } = input
  const ops = hostOps(yours)
  const tip = await laneTipIn(ops, lane)
  if (tip === null) throw new Error("no tip")
  const base = await laneBase(ops, tip, repoConfig)
  if (base === null) throw new Error("no base")
  const target = await acceptedIn(ops, repoConfig)
  await executeRepo(yours, [
    ...planOffer({
      name,
      start: await knownStart(ops, { tip, base, repoConfig, lane }),
      sources: input.sources,
      target,
      nonce: `n-${Math.random().toString(36).slice(2)}`,
    }),
    ...markSteps(offerBookmark(name)),
  ])
  const read = await readOffer(ops, { name, target })
  if (read?.kind !== "offer") throw new Error("no offer read")
  return {
    read,
    commits: read.revisions.map(r => r.commit),
    changes: read.revisions.map(r => r.change),
  }
}

/**
 * `lane`'s offer of its tip as one revision, its ledger naming the tip, as
 * `buildOffer` builds it. The lane's tip must be fetched already.
 */
export async function offerTip(
  yours: string,
  input: {
    readonly lane: ThreadId
    readonly name: ThreadName
    readonly repoConfig: RepoConfig
  },
) {
  const tip = await laneTipIn(hostOps(yours), input.lane)
  if (tip === null) throw new Error("no tip")
  return buildOffer(yours, {
    ...input,
    sources: [{ commit: tip, description: `WIP\n\nPinetrie-Source: ${tip}\n` }],
  })
}

/**
 * `name`'s offer, whose top change is `top`, accepted into accepted work in
 * your repo at `yours`: accepted work's bookmark moved forward to it, as
 * the host accepts one.
 */
export async function acceptOffer(
  yours: string,
  input: {
    readonly name: ThreadName
    readonly top: string
    readonly repoConfig: RepoConfig
  },
): Promise<void> {
  await executeRepo(
    yours,
    planOfferAcceptanceSteps({
      bookmark: offerBookmark(input.name),
      top: input.top,
      destination: input.repoConfig.acceptedBookmark,
    }),
  )
}
