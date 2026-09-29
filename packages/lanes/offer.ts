// lanes/offer — what the host reads of an offer in your repo (ADR-0038).
//
// Reads only, each a query over `hostOps` returning values: the facts a
// trigger plans from (`offerFacts`, `startOf`, `laneTipIn`), your edits
// (`yourEditsIn`), and which of a divergent revision's commits the host made
// (`hostCommitIn`). What the host then does is planned in `plan.ts`
// (`planOffer`, `planTakeOffer`, `planRepair`) and decided in
// `@pineta/marginalia`'s `offer.ts`.

import {
  type CommitId,
  commitId,
  HOST_OPERATOR,
  type LaneName,
} from "@pineta/core"
import { laneTipName } from "./plan.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

async function query(jj: Runner, args: readonly string[]): Promise<string> {
  const ran = await jj(args)
  if (!ran.ok) throw new Error(describeFailure(`jj ${args[0]}`, ran))
  return ran.stdout
}

const commitsOf = async (jj: Runner, revset: string): Promise<CommitId[]> =>
  lines(
    await query(jj, [
      "log",
      "--no-graph",
      "-r",
      revset,
      "-T",
      'commit_id ++ "\\n"',
    ]),
  ).map(commitId)

/** The lane's tip in your repo, its remote bookmark; null before its first fetch. */
export async function laneTipIn(
  jj: Runner,
  lane: LaneName,
): Promise<CommitId | null> {
  const [tip] = await commitsOf(jj, `present(${laneTipName(lane)})`)
  return tip ?? null
}

/** The commits a revset names: where an offer starts (`offerStart`). */
export const startOf = (jj: Runner, revset: string): Promise<CommitId[]> =>
  commitsOf(jj, revset)

/** Whether a bookmark exists in your repo. */
export async function hasBookmark(jj: Runner, name: string): Promise<boolean> {
  return (await commitsOf(jj, `present(bookmarks(exact:"${name}"))`)).length > 0
}

/** What the host found of an offer, against what it last wrote. */
export interface OfferFacts {
  /** Per revision, bottom first: its description and change as the host wrote them. */
  readonly revisions: readonly {
    readonly sameDescription: boolean
    readonly sameChange: boolean
  }[]
  /** The bottom's parent is an ancestor of the target (S48 item 7). */
  readonly placed: boolean
  /** The bottom's parents are exactly the target. */
  readonly onTarget: boolean
  /** A revision's change id names two visible commits (S48 item 8). */
  readonly divergent: boolean
  /** Every revision still exists in your repo. */
  readonly present: boolean
  readonly files: readonly string[]
  /** Files conflicting in its top: with your committed work (S48 item 3). */
  readonly conflicts: readonly string[]
  /** Each revision's commit now, bottom first. */
  readonly commits: readonly CommitId[]
}

/**
 * An offer's facts: `changes` are its revisions' change ids, `wrote` the
 * commits the host last wrote for them, bottom first. A change id is used
 * only to find the revision's commit now; every later read names that
 * commit, so no read acts on a hidden one (S48 item 2).
 */
export async function offerFacts(
  jj: Runner,
  input: {
    readonly changes: readonly string[]
    readonly wrote: readonly CommitId[]
    readonly target: string
  },
): Promise<OfferFacts> {
  const now: CommitId[][] = []
  for (const change of input.changes)
    now.push(await commitsOf(jj, `present(change_id(${change}))`))
  const divergent = now.some(c => c.length > 1)
  const present = now.every(c => c.length === 1)
  const commits = now.flatMap(c => (c.length === 1 && c[0] ? [c[0]] : []))
  const empty: OfferFacts = {
    revisions: [],
    placed: false,
    onTarget: false,
    divergent,
    present,
    files: [],
    conflicts: [],
    commits,
  }
  const bottom = commits[0]
  const top = commits.at(-1)
  if (divergent || !present || bottom === undefined || top === undefined)
    return empty
  const revisions = []
  for (const [i, commit] of commits.entries()) {
    const wrote = input.wrote[i]
    if (wrote === undefined) {
      revisions.push({ sameDescription: false, sameChange: false })
      continue
    }
    const [was, is] = await Promise.all([
      query(jj, ["log", "--no-graph", "-r", wrote, "-T", "description"]),
      query(jj, ["log", "--no-graph", "-r", commit, "-T", "description"]),
    ])
    const inter = await query(jj, [
      "interdiff",
      "--from",
      wrote,
      "--to",
      commit,
      "--summary",
    ])
    revisions.push({
      sameDescription: was === is,
      sameChange: lines(inter).length === 0,
    })
  }
  const parents = await commitsOf(jj, `parents(${bottom})`)
  const placed =
    (await commitsOf(jj, `parents(${bottom}) & ::(${input.target})`)).length ===
    parents.length
  const target = await commitsOf(jj, input.target)
  const onTarget =
    parents.length === target.length && parents.every(p => target.includes(p))
  const files = lines(
    await query(jj, [
      "diff",
      "--from",
      `parents(${bottom})`,
      "--to",
      top,
      "--name-only",
    ]),
  )
  const conflicts = lines(
    await query(jj, [
      "file",
      "list",
      "-r",
      top,
      "-T",
      'if(conflict, path ++ "\\n")',
    ]),
  )
  return {
    revisions,
    placed,
    onTarget,
    divergent,
    present,
    files,
    conflicts,
    commits,
  }
}

/** Of `files`, those you are editing: changed in `@` as jj last saw it. */
export async function yourEditsIn(
  jj: Runner,
  files: readonly string[],
): Promise<string[]> {
  const yours = new Set(
    lines(await query(jj, ["diff", "-r", "@", "--name-only"])),
  )
  return files.filter(f => yours.has(f))
}

/**
 * A divergent revision's commits, split into the one the host's own
 * operation made and yours: the newest evolog entry of each names the
 * operation's user (S48 item 8). Null unless exactly one is the host's.
 */
export async function hostCommitIn(
  jj: Runner,
  change: string,
): Promise<{ readonly hosts: CommitId; readonly yours: CommitId } | null> {
  const commits = await commitsOf(jj, `present(change_id(${change}))`)
  const byHost: CommitId[] = []
  const byYou: CommitId[] = []
  for (const c of commits) {
    const user = await query(jj, [
      "evolog",
      "--no-graph",
      "-r",
      c,
      "-n",
      "1",
      "-T",
      "operation.user()",
    ])
    if (user.trim().startsWith(`${HOST_OPERATOR}@`)) byHost.push(c)
    else byYou.push(c)
  }
  const [hosts] = byHost
  const [yours] = byYou
  return byHost.length === 1 && byYou.length === 1 && hosts && yours
    ? { hosts, yours }
    : null
}

/** A revision's change id, for the offer record. */
export async function changeOf(jj: Runner, commit: string): Promise<string> {
  return (
    await query(jj, ["log", "--no-graph", "-r", commit, "-T", "change_id"])
  ).trim()
}

/** The commits an offer's bookmark and its revisions below it name, bottom first. */
export async function offerRevisions(
  jj: Runner,
  bookmark: string,
  size: number,
): Promise<CommitId[]> {
  const revs = await commitsOf(
    jj,
    `ancestors(present(bookmarks(exact:"${bookmark}")), ${size})`,
  )
  return revs.toReversed()
}
