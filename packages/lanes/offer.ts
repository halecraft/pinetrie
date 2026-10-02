// lanes/offer — what the host reads of an offer in your repo (ADR-0038).
//
// Reads only, each a query over `hostOps` returning values: the facts a
// trigger plans from (`offerFacts`, `startOfOffer`, `laneTipIn`), your edits
// (`yourEditsIn`), what a review shows of a commit (`revisionRead`,
// `fileDiff`), and which of a divergent revision's commits the host made
// (`hostCommitIn`, from `evologOf`). What the host then does is planned in `plan.ts`
// (`planOffer`, `planTakeOffer`, `planRepair`) and decided in
// `@pineta/marginalia`'s `offer.ts`.

import type {
  CommitId,
  DiffSpan,
  HaveRecord,
  LaneName,
  RevisionFacts,
} from "@pineta/core"
import {
  anyHave,
  EVOLOG_ENTRY,
  type EvologEntry,
  laneTipName,
  offerStart,
  parseEvolog,
  startHaves,
  walkSince,
} from "./plan.ts"
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
 * and which hold the tip (read), how `startHaves` counts each of them (pure),
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
  /** Per revision, bottom first: whether it is still as the host wrote it, and if not, who changed it. */
  readonly revisions: readonly RevisionFacts[]
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
 * An offer's revisions' commits now, from their change ids, bottom first. A
 * revision divergent or gone is left out of `commits`. Enough for a read
 * that needs only the commits, such as one after the host's own steps.
 */
export async function offerCommits(
  jj: Runner,
  changes: readonly string[],
): Promise<{
  readonly commits: readonly CommitId[]
  readonly divergent: boolean
  readonly present: boolean
}> {
  const now: CommitId[][] = []
  for (const change of changes)
    now.push(await commitsOf(jj, `present(change_id(${change}))`))
  return {
    commits: now.flatMap(c => (c.length === 1 && c[0] ? [c[0]] : [])),
    divergent: now.some(c => c.length > 1),
    present: now.every(c => c.length === 1),
  }
}

/** Whether `to` has `from`'s description, and `jj interdiff` between them is empty. */
export async function sameAs(
  jj: Runner,
  from: CommitId,
  to: CommitId,
): Promise<{
  readonly sameDescription: boolean
  readonly sameChange: boolean
}> {
  const [was, is, inter] = await Promise.all([
    query(jj, ["log", "--no-graph", "-r", from, "-T", "description"]),
    query(jj, ["log", "--no-graph", "-r", to, "-T", "description"]),
    query(jj, ["interdiff", "--from", from, "--to", to, "--summary"]),
  ])
  return { sameDescription: was === is, sameChange: lines(inter).length === 0 }
}

/** A commit's versions in `jj evolog`, newest first; `limit` keeps the newest only. */
export async function evologOf(
  jj: Runner,
  commit: CommitId,
  limit?: number,
): Promise<EvologEntry[]> {
  return parseEvolog(
    await query(jj, [
      "evolog",
      "--no-graph",
      "-r",
      commit,
      ...(limit === undefined ? [] : ["-n", String(limit)]),
      "-T",
      EVOLOG_ENTRY,
    ]),
  )
}

/**
 * One revision against the commit the host last wrote for it: the two
 * tests, and, only when one fails, the evolog since (`walkSince`), with the
 * two tests again for each version of yours on the way.
 */
async function revisionFacts(
  jj: Runner,
  wrote: CommitId,
  commit: CommitId,
): Promise<RevisionFacts> {
  const same = await sameAs(jj, wrote, commit)
  if (same.sameDescription && same.sameChange) return { ...same, since: null }
  const walk = walkSince(await evologOf(jj, commit), commit, wrote)
  let yoursChanged = false
  for (const v of walk.yours) {
    const step = await sameAs(jj, v.from, v.to)
    if (!step.sameDescription || !step.sameChange) yoursChanged = true
  }
  return { ...same, since: { reached: walk.reached, yoursChanged } }
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
  const { commits, divergent, present } = await offerCommits(jj, input.changes)
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
  const revisions: RevisionFacts[] = []
  for (const [i, commit] of commits.entries()) {
    const wrote = input.wrote[i]
    revisions.push(
      wrote === undefined
        ? { sameDescription: false, sameChange: false, since: null }
        : await revisionFacts(jj, wrote, commit),
    )
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
 * A range's files, each as one JSON object per line: a `TreeDiffEntry` has
 * a path, how it is shown and its status, but no line counts (S70), which
 * `spanRead` takes from the range's git diff. A change to it bumps
 * `OFFER_WIRE`.
 */
export const RANGE_FILES =
  '"{\\"path\\":" ++ json(path) ++ ",\\"shown\\":" ++ json(display_diff_path) ++ ' +
  '",\\"change\\":" ++ json(status) ++ "}\\n"'

/**
 * Lines added and removed in each file's section of a git diff, in order.
 * Before a section's first `@@`, `--- a/x` and `+++ b/x` are headers.
 */
export function gitDiffCounts(
  text: string,
): readonly { readonly added: number; readonly removed: number }[] {
  const out: { added: number; removed: number }[] = []
  let header = true
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      out.push({ added: 0, removed: 0 })
      header = true
      continue
    }
    const at = out.at(-1)
    if (at === undefined) continue
    if (line.startsWith("@@")) header = false
    else if (header) continue
    else if (line.startsWith("+")) at.added += 1
    else if (line.startsWith("-")) at.removed += 1
  }
  return out
}

/**
 * A span's review as jj prints it, parsed but unchecked: the host decodes
 * it (`answerReview`). A revision is one `REVISION_READ`, its description
 * and stats together. A range has no description: its files from
 * `RANGE_FILES`, and their counts from its git diff, which lists them in
 * the same order (S70). Null when jj fails, prints no JSON, or the two
 * listings disagree.
 */
export async function revisionRead(
  jj: Runner,
  span: DiffSpan,
): Promise<unknown> {
  if (span.kind === "revision") {
    const ran = await jj([
      "log",
      "--no-graph",
      "-r",
      span.commit,
      "-T",
      REVISION_READ,
    ])
    if (!ran.ok) return null
    try {
      return JSON.parse(ran.stdout) as unknown
    } catch {
      return null
    }
  }
  const range = ["diff", "--from", span.from, "--to", span.to]
  const files = await jj([...range, "-T", RANGE_FILES])
  const git = await jj([...range, "--git"])
  if (!files.ok || !git.ok) return null
  try {
    const listed = lines(files.stdout).map(l => JSON.parse(l) as object)
    const counts = gitDiffCounts(git.stdout)
    if (counts.length !== listed.length) return null
    return {
      description: "",
      files: listed.map((f, i) => ({ ...f, ...counts[i] })),
    }
  } catch {
    return null
  }
}

/**
 * One file's git diff in a span; null when jj fails. `root-file:` names
 * the file from the repo's root, and exactly it: a bare path is read from the
 * process's directory, and `root:` matches every file under a directory of
 * that name (S57). A change to the flags bumps `OFFER_WIRE`.
 */
export async function fileDiff(
  jj: Runner,
  span: DiffSpan,
  path: string,
): Promise<string | null> {
  const ran = await jj([
    "diff",
    "--git",
    ...(span.kind === "revision"
      ? ["-r", span.commit]
      : ["--from", span.from, "--to", span.to]),
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
    const [newest] = await evologOf(jj, c, 1)
    if (newest?.byHost === true) byHost.push(c)
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
