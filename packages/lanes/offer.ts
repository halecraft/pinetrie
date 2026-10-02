// lanes/offer — what the host reads of an offer in your repo (ADR-0038).
//
// Reads only, each a query over `hostOps` returning values: the facts a
// trigger plans from (`readOffer`, `startOfOffer`, `laneTipIn`), your edits
// (`yourEditsIn`), what a review shows of a commit (`revisionRead`,
// `fileDiff`), and which of a divergent revision's commits the host made
// (`hostCommitIn`, from `evologOf`). What the host then does is planned in `plan.ts`
// (`planOffer`, `planTakeOffer`, `planRepair`) and decided in
// `@pineta/marginalia`'s `offer.ts`.

import {
  type CommitId,
  commitId,
  type DiffSpan,
  type LaneName,
  type OfferInRepo,
  type OfferRevision,
  offerLedger,
  type RevisionFacts,
  type ThreadBase,
  type ThreadName,
  TRAILERS,
  trailerValues,
} from "@pineta/core"
import { newestBase } from "./merge.ts"
import {
  EVOLOG_ENTRY,
  type EvologEntry,
  type LineConfig,
  laneTipName,
  offerBookmark,
  offerStart,
  parseEvolog,
  revsetName,
  walkToHost,
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

/** A lane's base, read from its history in your repo (ADR-0060). */
export interface LaneBase {
  readonly base: ThreadBase
  /**
   * Where the lane's own work begins: the line commit its base names, or the
   * WIP's copy; for a lane with no `Pineta-Base`, the newest line commit in
   * its history.
   */
  readonly start: CommitId
  /** The commit its `Pineta-Base` names (the WIP's, for a WIP); null with none. */
  readonly source: CommitId | null
}

/**
 * A lane's base, from the newest `Pineta-Base` in the history of its tip in
 * your repo; a lane with none (one from before the line) is on the line.
 * Null when no line commit is in its history either.
 */
export async function laneBase(
  jj: Runner,
  tip: CommitId,
  line: LineConfig,
): Promise<LaneBase | null> {
  const newest = await newestBase(jj, tip)
  if (newest === null) {
    const [start] = await commitsOf(
      jj,
      `latest(heads(::${tip} & ::present(${revsetName(line.onto)})))`,
    )
    return start === undefined
      ? null
      : { base: { kind: "line" }, start, source: null }
  }
  return newest.bookmark === line.onto
    ? { base: { kind: "line" }, start: newest.commit, source: newest.commit }
    : {
        base: { kind: "wip", bookmark: newest.bookmark },
        start: newest.at,
        source: newest.commit,
      }
}

/**
 * The lane commits taken offers name, from their `Pineta-Source` trailers in
 * `::onto`, and in `::<wip>` for a lane on a WIP: what you already have of
 * lanes. Read from every paragraph of each message (S77 item 6).
 */
export async function takenSources(
  jj: Runner,
  line: LineConfig,
  base: ThreadBase,
): Promise<CommitId[]> {
  const heads = [
    `present(${revsetName(line.onto)})`,
    ...(base.kind === "wip" ? [`present(${revsetName(base.bookmark)})`] : []),
  ].join(" | ")
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    `::(${heads}) & description(regex:"(?m)^${TRAILERS.source}: ")`,
    "-T",
    'description ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return [...new Set(trailerValues(ran.stdout, TRAILERS.source))].map(commitId)
}

/**
 * Where an offer starts, as commits: the lane's base and the taken offers'
 * sources (read), then `offerStart`'s revset (read). The host's every start
 * comes from here, so an offer is built, followed and split from one start.
 */
export async function startOfOffer(
  jj: Runner,
  input: {
    readonly tip: CommitId
    readonly base: LaneBase
    readonly line: LineConfig
  },
): Promise<CommitId[]> {
  const sources = await takenSources(jj, input.line, input.base.base)
  return commitsOf(
    jj,
    offerStart({ tip: input.tip, start: input.base.start, sources }),
  )
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
 * One revision's facts since the host's newest version of it: the evolog
 * walked back to it (`walkToHost`), then each version of yours on the way
 * against the one before it (`sameAs`).
 */
async function sinceHost(jj: Runner, commit: CommitId): Promise<RevisionFacts> {
  const walk = walkToHost(await evologOf(jj, commit), commit)
  let yoursChanged = false
  for (const v of walk.yours) {
    const step = await sameAs(jj, v.from, v.to)
    if (!step.sameDescription || !step.sameChange) yoursChanged = true
  }
  return { reached: walk.reached, yoursChanged }
}

/**
 * An offer's revisions in your repo, bottom first, each with its change id:
 * what is under its bookmark and not already under its target, and carries
 * its thread's trailer. A taken offer below carries a ledger too, but is
 * under the target; your commits carry no thread trailer. The bookmark's own
 * commit is always the top, so an offer built before the trailer was
 * written there is still found. Empty with no bookmark.
 */
export async function offerRevisions(
  jj: Runner,
  input: { readonly name: ThreadName; readonly target: string },
): Promise<{ readonly commit: CommitId; readonly change: string }[]> {
  const bookmark = `bookmarks(exact:${revsetName(offerBookmark(input.name))})`
  const thread = `description(regex:"(?m)^${TRAILERS.thread}: ${input.name}$")`
  const ran = await jj([
    "log",
    "--no-graph",
    "-r",
    `(::${bookmark} ~ ::(${input.target})) & (${thread} | ${bookmark})`,
    "-T",
    'commit_id ++ "\\t" ++ change_id ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return lines(ran.stdout)
    .map(line => {
      const [commit = "", change = ""] = line.split("\t")
      return { commit: commitId(commit), change }
    })
    .toReversed()
}

/**
 * An offer as your repo holds it now (`OfferInRepo`): its revisions and
 * what each one's evolog says since the host's newest version, its ledger
 * and first line, where it sits, its files and conflicts. Null when its
 * bookmark is gone (you abandoned it, or took it by hand). Divergent when
 * the bookmark is conflicted or a change id names two commits (S48 item 8):
 * then only its change ids. Every read after the first names commits, so no
 * read acts on a hidden one (S48 item 2).
 */
export async function readOffer(
  jj: Runner,
  input: { readonly name: ThreadName; readonly target: string },
): Promise<OfferInRepo | null> {
  const heads = await commitsOf(
    jj,
    `present(bookmarks(exact:${revsetName(offerBookmark(input.name))}))`,
  )
  const found = await offerRevisions(jj, input)
  const [top] = heads
  const [bottom] = found
  if (top === undefined || bottom === undefined) return null
  const changes = [...new Set(found.map(r => r.change))]
  const visible = await commitsOf(
    jj,
    changes.map(c => `change_id(${c})`).join(" | "),
  )
  if (heads.length > 1 || visible.length > changes.length)
    return { kind: "divergent", changes }
  const revisions: OfferRevision[] = []
  for (const r of found)
    revisions.push({ ...r, since: await sinceHost(jj, r.commit) })
  const chained =
    found.at(-1)?.commit === top &&
    (
      await Promise.all(
        found.slice(1).map(async (r, i) => {
          const parents = await commitsOf(jj, `parents(${r.commit})`)
          return parents.length === 1 && parents[0] === found[i]?.commit
        }),
      )
    ).every(Boolean)
  const parents = await commitsOf(jj, `parents(${bottom.commit})`)
  const placed =
    (await commitsOf(jj, `parents(${bottom.commit}) & ::(${input.target})`))
      .length === parents.length
  const target = await commitsOf(jj, input.target)
  const onTarget =
    parents.length === target.length && parents.every(p => target.includes(p))
  const files = lines(
    await query(jj, [
      "diff",
      "--from",
      `parents(${bottom.commit})`,
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
  const message = await query(jj, [
    "log",
    "--no-graph",
    "-r",
    top,
    "-T",
    "description",
  ])
  return {
    kind: "offer",
    revisions,
    chained,
    ledger: offerLedger(message),
    firstLine: message.split("\n")[0] ?? "",
    placed,
    onTarget,
    files,
    conflicts,
  }
}

/** The thread names whose offer bookmark is in your repo. */
export async function offerNames(jj: Runner): Promise<ThreadName[]> {
  const prefix = offerBookmark("" as ThreadName)
  const ran = await jj([
    "log",
    "--no-graph",
    "-r",
    `bookmarks(glob:${revsetName(`${prefix}*`)})`,
    "-T",
    'local_bookmarks.map(|b| b.name()).join("\\n") ++ "\\n"',
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return lines(ran.stdout)
    .filter(b => b.startsWith(prefix))
    .map(b => b.slice(prefix.length) as ThreadName)
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

/** A commit's change id. */
export async function changeOf(jj: Runner, commit: string): Promise<string> {
  return (
    await query(jj, ["log", "--no-graph", "-r", commit, "-T", "change_id"])
  ).trim()
}
