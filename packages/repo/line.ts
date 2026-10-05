// repo/line — the integration line in your repo (ADR-0060): what it is now,
// read as values for the host to plan from, and what catching your files up
// with it would do (S80). Reads only; the host's steps that set it up and
// publish it are `planLineSetup`, `planPublishCatchUp`, `planPublishMove` and
// `planCatchUpUndo` (`plan.ts`, ADR-0090).

import {
  type BaseRecord,
  type CommitId,
  commitId,
  type LaneBase,
  type LineFacts,
} from "@pinetrie/core"
import {
  commitsOf,
  conflictedFilesAt,
  type LineConfig,
  lines,
  type Runner,
  revsetName,
} from "@pinetrie/lanes"
import { changeOf } from "./offer.ts"

/** What `planPublishCatchUp`'s rebase would do to your files (S80): `LineRecord`'s shape. */
type CatchUpPreview = NonNullable<LineFacts["yours"]["catchUp"]>

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
      published: { commit: null, behind: 0, ahead: 0 },
      yours: {
        behind: 0,
        ahead: 0,
        catchUp: null,
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
  const behind = await count(jj, `::${onto} ~ ::@-`)
  return {
    commit,
    heads: heads.ok ? heads.stdout.trim() : null,
    log,
    wips,
    published: await publishedFacts(jj, onto, revsetName(line.publish)),
    yours: {
      behind,
      ahead: await count(jj, `::@- ~ ::${onto}`),
      catchUp: behind === 0 ? null : await catchUpPreview(jj, git, onto),
      conflicts: {
        commits: await count(jj, `(::@ ~ ::${onto}) & conflicts()`),
        files: await conflictedFilesAt(jj, "@").catch(() => []),
      },
    },
  }
}

/**
 * The publish bookmark against the line (ADR-0076), read as a WIP's pair:
 * the line commits it lacks, and its commits the line lacks.
 */
async function publishedFacts(
  jj: Runner,
  onto: string,
  publish: string,
): Promise<LineFacts["published"]> {
  const [commit] = await commitsOf(jj, `present(${publish})`)
  if (commit === undefined) return { commit: null, behind: 0, ahead: 0 }
  return {
    commit,
    behind: await count(jj, `::${onto} ~ ::${publish}`),
    ahead: await count(jj, `::${publish} ~ ::${onto}`),
  }
}

/**
 * `git merge-tree` exits 1 on conflicts and prints the merged tree, then the
 * conflicting paths, then a blank line and its messages (S80 item 3). Null
 * when `@` descends from no commit of the line, or git cannot merge.
 */
async function catchUpPreview(
  jj: Runner,
  git: Runner,
  onto: string,
): Promise<CatchUpPreview | null> {
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
    changes: lines(changed.stdout).length,
    conflicts,
    heads: await count(jj, `heads(roots(${onto}..@)::) ~ @`),
  }
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

/**
 * What `wipState` decides from: where a lane's WIP bookmark is, against the
 * line, and whether the commit its base names is there. Null for a base on
 * the line, or none.
 */
async function wipFacts(
  jj: Runner,
  line: LineConfig,
  base: LaneBase | null,
): Promise<{
  readonly bookmark: CommitId | null
  readonly bookmarkInLine: boolean
  readonly sourceInLine: boolean
} | null> {
  if (base?.base.kind !== "wip") return null
  const { source } = base
  const { bookmark } = base.base
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

/**
 * A WIP base's state (ADR-0060): landed when its bookmark points into the
 * line (moved there, or squashed into the line, which keeps the bookmark and
 * drops the WIP's change, S77 item 2), or, with the bookmark gone, when the
 * commit the lane's `Pinetrie-Base` names, or its change, is on the line.
 * Gone when the bookmark is gone and the WIP did not land; else ok. No
 * facts, a base on the line, is ok. Pure.
 */
export function wipState(
  facts: {
    /** Where the WIP bookmark points now; null when it is gone. */
    readonly bookmark: CommitId | null
    /** The bookmark's commit is in the line's history. */
    readonly bookmarkInLine: boolean
    /** The commit `Pinetrie-Base` names, or its change, is in the line's history. */
    readonly sourceInLine: boolean
  } | null,
): BaseRecord["state"] {
  if (facts === null) return "ok"
  if (facts.bookmark !== null) return facts.bookmarkInLine ? "landed" : "ok"
  return facts.sourceInLine ? "landed" : "gone"
}

/** What became of a lane's WIP base (`wipState` of `wipFacts`); "ok" for a base on the line. */
export const readWipState = async (
  jj: Runner,
  line: LineConfig,
  base: LaneBase | null,
): Promise<BaseRecord["state"]> => wipState(await wipFacts(jj, line, base))
