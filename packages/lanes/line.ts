// lanes/line — the integration line in your repo (ADR-0060): what it is now,
// read as values for the host to plan from, and what updating your files
// from it would do (ADR-0061, S80). Reads only; the host's steps that set it
// up, move it and rebase your work onto it are `planLineSetup`, `planLand`
// and `planFollow` (`plan.ts`).

import { type CommitId, commitId } from "@pineta/core"
import { changeOf } from "./offer.ts"
import { type LineConfig, revsetName } from "./plan.ts"
import { commitsOf } from "./revisions.ts"
import { lines, type Runner } from "./run.ts"

/** What the host reads of the line, each time it looks. */
export interface LineFacts {
  /** The line's commit; null before it is set up. */
  readonly commit: CommitId | null
  /** Your repo's `immutable_heads()`, as jj resolves it; null for the builtin. */
  readonly heads: string | null
  /** Your repo's `revsets.log`, as jj resolves it; null for the default. */
  readonly log: string | null
  /**
   * The WIP bookmarks above the line's ancestry, each with its commit, how
   * many line commits it lacks, and how many of its own are not on the line.
   */
  readonly wips: readonly {
    readonly bookmark: string
    readonly commit: CommitId
    readonly behind: number
    readonly ahead: number
  }[]
  /**
   * Your `@-` against the line: the line commits it lacks, and, when it
   * descends from the line, the commits of yours above it (else null); what
   * updating your files would do (null when it cannot or need not); and the
   * conflicts jj records in your work above the line.
   */
  readonly yours: {
    readonly behind: number
    readonly ahead: number | null
    readonly follow: FollowPreview | null
    readonly conflicts: YourConflicts
  }
}

/**
 * What `planFollow`'s rebase would do to your files (S80), read without
 * writing anything jj or jjui shows: `git merge-tree` of the line and `@`
 * as last snapshotted, from their fork point.
 */
export interface FollowPreview {
  /** Files your working copy would see change. */
  readonly files: readonly string[]
  /** Of those, the ones that would conflict. */
  readonly conflicts: readonly string[]
  /** Heads of yours besides `@` that move with it: `-b @` takes them. */
  readonly heads: number
}

/** Your conflicted commits above the line, and the conflicted files in `@`. */
export interface YourConflicts {
  readonly commits: number
  readonly files: readonly string[]
}

const count = async (jj: Runner, revset: string): Promise<number> =>
  (await commitsOf(jj, revset)).length

/**
 * Read the line's facts from your repo (`jj` as the host reads it, `git` on
 * the same repo, for the preview).
 */
export async function lineFacts(
  jj: Runner,
  git: Runner,
  line: LineConfig,
): Promise<LineFacts> {
  const onto = revsetName(line.onto)
  const [commit] = await commitsOf(jj, `present(${onto})`)
  const heads = await jj([
    "config",
    "get",
    'revset-aliases."immutable_heads()"',
  ])
  const logged = await jj(["config", "get", "revsets.log"])
  const log = logged.ok ? logged.stdout.trim() : null
  if (commit === undefined)
    return {
      commit: null,
      heads: heads.ok ? heads.stdout.trim() : null,
      log,
      wips: [],
      yours: {
        behind: 0,
        ahead: null,
        follow: null,
        conflicts: { commits: 0, files: [] },
      },
    }
  const listed = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    `bookmarks(glob:${revsetName(`${line.wipPrefix}*`)}) ~ ::${onto}`,
    "-T",
    'local_bookmarks.map(|b| b.name()).join(",") ++ "\\t" ++ commit_id ++ "\\n"',
  ])
  const wips: {
    bookmark: string
    commit: CommitId
    behind: number
    ahead: number
  }[] = []
  for (const row of listed.ok ? lines(listed.stdout) : []) {
    const [names = "", id = ""] = row.split("\t")
    for (const bookmark of names.split(","))
      if (bookmark.startsWith(line.wipPrefix))
        wips.push({
          bookmark,
          commit: commitId(id),
          behind: await count(jj, `::${onto} ~ ::${id}`),
          ahead: await count(jj, `::${id} ~ ::${onto}`),
        })
  }
  const descends = (await count(jj, `${onto} & ::@-`)) > 0
  const behind = await count(jj, `::${onto} ~ ::@-`)
  return {
    commit,
    heads: heads.ok ? heads.stdout.trim() : null,
    log,
    wips,
    yours: {
      behind,
      ahead: descends ? await count(jj, `${onto}..@-`) : null,
      follow: behind === 0 ? null : await followPreview(jj, git, onto),
      conflicts: {
        commits: await count(jj, `(::@ ~ ::${onto}) & conflicts()`),
        files: await conflictedFiles(jj),
      },
    },
  }
}

/**
 * `git merge-tree` exits 1 on conflicts and prints the merged tree, then the
 * conflicting paths, then a blank line and its messages (S80 item 3). Null
 * when `@` descends from no commit of the line, or git cannot merge.
 */
async function followPreview(
  jj: Runner,
  git: Runner,
  onto: string,
): Promise<FollowPreview | null> {
  if ((await count(jj, `(::@ & ::${onto}) ~ root()`)) === 0) return null
  const [base] = await commitsOf(jj, `fork_point(${onto} | @)`)
  const [line] = await commitsOf(jj, onto)
  const [at] = await commitsOf(jj, "@")
  if (base === undefined || line === undefined || at === undefined) return null
  const merged = await git([
    "merge-tree",
    "--write-tree",
    "--name-only",
    `--merge-base=${base}`,
    line,
    at,
  ])
  if (!merged.ok && merged.code !== 1) return null
  const [tree = "", ...rest] = merged.stdout.split("\n")
  const blank = rest.indexOf("")
  const conflicts = (blank < 0 ? rest : rest.slice(0, blank)).filter(
    p => p !== "",
  )
  const changed = await git(["diff", "--name-only", at, tree.trim()])
  if (!changed.ok) return null
  return {
    files: lines(changed.stdout),
    conflicts,
    heads: await count(jj, `heads(roots(${onto}..@)::) ~ @`),
  }
}

/** The conflicted files in `@`, as last snapshotted. */
async function conflictedFiles(jj: Runner): Promise<string[]> {
  const ran = await jj([
    "file",
    "list",
    "-r",
    "@",
    "-T",
    'if(conflict, path ++ "\\n")',
  ])
  return ran.ok ? lines(ran.stdout) : []
}

/**
 * What a new lane's begin is planned from (`planBegin`): the line's commit,
 * and, for a WIP base, its commit and the line commit under it, when it is a
 * WIP above the line (not already on it).
 */
export async function beginFacts(
  jj: Runner,
  line: LineConfig,
  base: string | null,
): Promise<{
  readonly line: CommitId | null
  readonly wip: { readonly commit: CommitId; readonly under: CommitId } | null
}> {
  const onto = revsetName(line.onto)
  const [lineCommit] = await commitsOf(jj, `present(${onto})`)
  if (lineCommit === undefined || base === null)
    return { line: lineCommit ?? null, wip: null }
  const wip = revsetName(base)
  const [commit] = await commitsOf(jj, `present(${wip}) ~ ::${onto}`)
  const [under] =
    commit === undefined
      ? []
      : await commitsOf(jj, `latest(heads(::${commit} & ::${onto}))`)
  return {
    line: lineCommit,
    wip: commit === undefined || under === undefined ? null : { commit, under },
  }
}

/** What `wipState` decides from: where a WIP bookmark is, against the line. */
export async function wipFacts(
  jj: Runner,
  line: LineConfig,
  bookmark: string,
  source: CommitId,
): Promise<{
  readonly bookmark: CommitId | null
  readonly bookmarkInLine: boolean
  readonly sourceInLine: boolean
}> {
  const onto = `::present(${revsetName(line.onto)})`
  const [target] = await commitsOf(jj, `present(${revsetName(bookmark)})`)
  const inLine = async (revset: string) =>
    (await commitsOf(jj, `(${revset}) & ${onto}`)).length > 0
  return {
    bookmark: target ?? null,
    bookmarkInLine: target === undefined ? false : await inLine(target),
    sourceInLine:
      target !== undefined
        ? false
        : await inLine(
            `present(${source}) | present(change_id(${await changeOf(jj, source)}))`,
          ),
  }
}
