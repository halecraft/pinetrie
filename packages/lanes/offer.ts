// lanes/offer — what the host reads of an offer in your repo (ADR-0038).
//
// Reads only, each a query over `hostOps` returning values: the facts a
// trigger plans from (`offerFacts`, `startOfOffer`, `laneTipIn`), your edits
// (`yourEditsIn`), what a review shows of a commit (`revisionRead`,
// `fileDiff`), and which of a divergent revision's commits the host made
// (`hostCommitIn`). What the host then does is planned in `plan.ts`
// (`planOffer`, `planTakeOffer`, `planRepair`) and decided in
// `@pineta/marginalia`'s `offer.ts`.

import {
  type CommitId,
  type HaveRecord,
  HOST_OPERATOR,
  type LaneName,
} from "@pineta/core"
import { anyHave, laneTipName, offerStart, startHaves } from "./plan.ts"
import { commitsOf } from "./revisions.ts"
import { describeFailure, lines, type Runner } from "./run.ts"

async function query(jj: Runner, args: readonly string[]): Promise<string> {
  const ran = await jj(args)
  if (!ran.ok) throw new Error(describeFailure(`jj ${args[0]}`, ran))
  return ran.stdout
}

/** The lane's tip in your repo, its remote bookmark; null before its first fetch. */
export async function laneTipIn(
  jj: Runner,
  lane: LaneName,
): Promise<CommitId | null> {
  const [tip] = await commitsOf(jj, `present(${laneTipName(lane)})`)
  return tip ?? null
}

/**
 * Where an offer starts, as commits: which haves the lane tip's history holds,
 * and which hold the tip (read), the ones `startHaves` keeps of them (pure),
 * then `offerStart`'s revset (read). The host's every start comes from here, so an offer is
 * built, followed and split from one start.
 */
export async function startOfOffer(
  jj: Runner,
  input: {
    readonly tip: CommitId
    readonly target: string
    readonly haves: readonly HaveRecord[]
  },
): Promise<CommitId[]> {
  const any = anyHave(input.haves)
  const inTip =
    any === null ? [] : await commitsOf(jj, `::${input.tip} & (${any})`)
  const holdTip =
    any === null ? [] : await commitsOf(jj, `${input.tip}:: & (${any})`)
  const haves = startHaves(input.haves, new Set(inTip), new Set(holdTip))
  return commitsOf(jj, offerStart({ ...input, haves }))
}

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
 * A revision's description and per-file stats, printed as the JSON of
 * `RevisionReview` (`@pineta/core`): `json()` quotes every string (S57). A
 * change to it bumps `OFFER_WIRE` (`@pineta/marginalia`).
 */
export const REVISION_READ =
  '"{\\"description\\":" ++ json(description) ++ ",\\"files\\":[" ++ ' +
  'self.diff().stat().files().map(|f| "{\\"path\\":" ++ json(f.path()) ++ ' +
  '",\\"shown\\":" ++ json(f.display_diff_path()) ++ ",\\"change\\":" ++ json(f.status()) ++ ' +
  '",\\"added\\":" ++ f.lines_added() ++ ",\\"removed\\":" ++ f.lines_removed() ++ "}").join(",") ++ ' +
  '"]}"'

/**
 * A revision's review as jj prints it, parsed but unchecked: the host decodes
 * it (`answerReview`). Null when jj fails or prints no JSON.
 */
export async function revisionRead(
  jj: Runner,
  commit: CommitId,
): Promise<unknown> {
  const ran = await jj(["log", "--no-graph", "-r", commit, "-T", REVISION_READ])
  if (!ran.ok) return null
  try {
    return JSON.parse(ran.stdout) as unknown
  } catch {
    return null
  }
}

/**
 * One file's git diff in a revision; null when jj fails. `root-file:` names
 * the file from the repo's root, and exactly it: a bare path is read from the
 * process's directory, and `root:` matches every file under a directory of
 * that name (S57). A change to the flags bumps `OFFER_WIRE`.
 */
export async function fileDiff(
  jj: Runner,
  commit: CommitId,
  path: string,
): Promise<string | null> {
  const ran = await jj([
    "diff",
    "--git",
    "-r",
    commit,
    "--",
    `root-file:${JSON.stringify(path)}`,
  ])
  return ran.ok ? ran.stdout : null
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
