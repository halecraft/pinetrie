// jj/fixtures — what jj's tests share: a lane's record proven jj, as the
// adapter proves one (`proveJjLane`); and a lane's work reaching your repo,
// proposed and accepted, by the steps the host runs.

import {
  type CommitBase,
  type CommitId,
  type ProposedSource,
  type RepoConfig,
  rootIdFor,
  type ThreadId,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import { executeOrThrow, type LaneRunners, type Runner } from "@pinetrie/lanes"
import { laneBase } from "./lane/base.ts"
import { bookmarkName, proposedBookmark, revsetName } from "./lane/names.ts"
import { planBundle } from "./lane/plan.ts"
import { type JjLane, proveJjLane } from "./lane/points.ts"
import { readCommits } from "./lane/revisions.ts"
import {
  markSteps,
  planAcceptanceSteps,
  planImport,
  planProposedChanges,
} from "./plan.ts"
import { laneTipIn, readProposedChanges, startOfProposed } from "./proposed.ts"
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
  const [c] = await readCommits(
    ops,
    `present(${revsetName(repoConfig.acceptedBookmark)})`,
  )
  if (c === undefined) throw new Error("no accepted work")
  return c
}

/** Where `lane`'s proposed changes start, as commits; throws on an untraced start. */
export async function knownStart(
  jj: Runner,
  input: {
    readonly tip: CommitId
    readonly base: CommitBase
    readonly repoConfig: RepoConfig
    readonly lane: ThreadId
  },
): Promise<readonly CommitId[]> {
  const read = await startOfProposed(jj, input)
  if (read.kind !== "known") throw new Error("an untraced start")
  return read.start
}

/**
 * `lane`'s proposed changes of `sources`, built on accepted work in your repo
 * at `yours` as the host builds it, then found there as the host finds it, with
 * nothing kept. The lane's tip must be fetched already.
 */
export async function buildProposedChanges(
  yours: string,
  input: {
    readonly lane: ThreadId
    readonly name: ThreadName
    readonly sources: readonly ProposedSource[]
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
    ...planProposedChanges({
      name,
      start: await knownStart(ops, { tip, base, repoConfig, lane }),
      sources: input.sources,
      target,
      nonce: `n-${Math.random().toString(36).slice(2)}`,
    }),
    ...markSteps(proposedBookmark(name)),
  ])
  const read = await readProposedChanges(ops, { name, target })
  if (read?.kind !== "present") throw new Error("no proposed changes read")
  return {
    read,
    commits: read.revisions.map(r => r.commit),
    changeIds: read.revisions.map(r => r.changeId),
  }
}

/**
 * `lane`'s proposed changes of its tip as one revision, its ledger naming the
 * tip, as `buildProposedChanges` builds it. The lane's tip must be fetched
 * already.
 */
export async function proposedTip(
  yours: string,
  input: {
    readonly lane: ThreadId
    readonly name: ThreadName
    readonly repoConfig: RepoConfig
  },
) {
  const tip = await laneTipIn(hostOps(yours), input.lane)
  if (tip === null) throw new Error("no tip")
  return buildProposedChanges(yours, {
    ...input,
    sources: [{ commit: tip, description: `WIP\n\nPinetrie-Source: ${tip}\n` }],
  })
}

/**
 * `name`'s proposed changes, whose top change is `top`, accepted into accepted
 * work in your repo at `yours`: accepted work's bookmark moved forward to it,
 * as the host accepts one.
 */
export async function acceptProposedChanges(
  yours: string,
  input: {
    readonly name: ThreadName
    readonly top: string
    readonly repoConfig: RepoConfig
  },
): Promise<void> {
  await executeRepo(
    yours,
    planAcceptanceSteps({
      bookmark: proposedBookmark(input.name),
      top: input.top,
      destination: input.repoConfig.acceptedBookmark,
    }),
  )
}
