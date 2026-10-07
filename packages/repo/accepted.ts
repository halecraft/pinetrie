// repo/accepted — accepted work in your repo (ADR-0060): what it is now,
// read as values for the host to plan from, and what catching your files up
// with it would do (S80). Reads only; the host's steps that set it up and
// publish it are `planSetup`, `planPublishCatchUp`, `planPublishMove` and
// `planCatchUpUndo` (`plan.ts`, ADR-0090).

import {
  type AcceptedFacts,
  type BaseRecord,
  type CommitId,
  commitId,
  type LaneBase,
} from "@pinetrie/core"
import {
  commitsOf,
  conflictedFilesAt,
  lines,
  type RepoConfig,
  type Runner,
  revsetName,
} from "@pinetrie/lanes"
import { changeOf } from "./offer.ts"

/** What `planPublishCatchUp`'s rebase would do to your files (S80): `AcceptedRecord`'s shape. */
type CatchUpPreview = NonNullable<AcceptedFacts["yours"]["catchUp"]>

const count = async (jj: Runner, revset: string): Promise<number> =>
  (await commitsOf(jj, revset)).length

/**
 * Read accepted work's facts from your repo (`jj` as the host reads it, `git` on
 * the same repo, for the preview).
 */
export async function acceptedFacts(
  jj: Runner,
  git: Runner,
  repoConfig: RepoConfig,
): Promise<AcceptedFacts> {
  const acceptedBookmark = revsetName(repoConfig.acceptedBookmark)
  const [commit] = await commitsOf(jj, `present(${acceptedBookmark})`)
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
    `bookmarks(glob:${revsetName(`${repoConfig.wipPrefix}*`)}) ~ ::${acceptedBookmark}`,
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
      if (bookmark.startsWith(repoConfig.wipPrefix))
        wips.push({
          bookmark,
          commit: commitId(id),
          behind: await count(jj, `::${acceptedBookmark} ~ ::${id}`),
          ahead: await count(jj, `::${id} ~ ::${acceptedBookmark}`),
        })
  }
  const behind = await count(jj, `::${acceptedBookmark} ~ ::@-`)
  return {
    commit,
    heads: heads.ok ? heads.stdout.trim() : null,
    log,
    wips,
    published: await publishedFacts(
      jj,
      acceptedBookmark,
      revsetName(repoConfig.publish),
    ),
    yours: {
      behind,
      ahead: await count(jj, `::@- ~ ::${acceptedBookmark}`),
      catchUp:
        behind === 0 ? null : await catchUpPreview(jj, git, acceptedBookmark),
      conflicts: {
        commits: await count(jj, `(::@ ~ ::${acceptedBookmark}) & conflicts()`),
        files: await conflictedFilesAt(jj, "@").catch(() => []),
      },
    },
  }
}

/**
 * The publish bookmark against accepted work (ADR-0076), read as a WIP's pair:
 * accepted commits it lacks, and its commits accepted work lacks.
 */
async function publishedFacts(
  jj: Runner,
  acceptedBookmark: string,
  publish: string,
): Promise<AcceptedFacts["published"]> {
  const [commit] = await commitsOf(jj, `present(${publish})`)
  if (commit === undefined) return { commit: null, behind: 0, ahead: 0 }
  return {
    commit,
    behind: await count(jj, `::${acceptedBookmark} ~ ::${publish}`),
    ahead: await count(jj, `::${publish} ~ ::${acceptedBookmark}`),
  }
}

/**
 * `git merge-tree` exits 1 on conflicts and prints the merged tree, then the
 * conflicting paths, then a blank line and its messages (S80 item 3). Null
 * when `@` descends from no commit of accepted work, or git cannot merge.
 */
async function catchUpPreview(
  jj: Runner,
  git: Runner,
  acceptedBookmark: string,
): Promise<CatchUpPreview | null> {
  if ((await count(jj, `(::@ & ::${acceptedBookmark}) ~ root()`)) === 0)
    return null
  const [base] = await commitsOf(jj, `fork_point(${acceptedBookmark} | @)`)
  const [line] = await commitsOf(jj, acceptedBookmark)
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
    heads: await count(jj, `heads(roots(${acceptedBookmark}..@)::) ~ @`),
  }
}

/**
 * What a new lane's begin is planned from (`planBegin`): accepted work's commit,
 * and, for a WIP base, its commit and accepted commit under it, when it is a
 * WIP above accepted work (not already on it).
 */
export async function beginFacts(
  jj: Runner,
  repoConfig: RepoConfig,
  base: string | null,
): Promise<{
  readonly acceptedCommit: CommitId | null
  readonly wip: { readonly commit: CommitId; readonly under: CommitId } | null
}> {
  const acceptedBookmark = revsetName(repoConfig.acceptedBookmark)
  const [acceptedCommit] = await commitsOf(jj, `present(${acceptedBookmark})`)
  if (acceptedCommit === undefined || base === null)
    return { acceptedCommit: acceptedCommit ?? null, wip: null }
  const wip = revsetName(base)
  const [commit] = await commitsOf(
    jj,
    `present(${wip}) ~ ::${acceptedBookmark}`,
  )
  const [under] =
    commit === undefined
      ? []
      : await commitsOf(
          jj,
          `latest(heads(::${commit} & ::${acceptedBookmark}))`,
        )
  return {
    acceptedCommit: acceptedCommit,
    wip: commit === undefined || under === undefined ? null : { commit, under },
  }
}

/**
 * What `wipState` decides from: where a lane's WIP bookmark is, against the
 * line, and whether the commit its base names is there. Null for a base on
 * accepted work, or none.
 */
async function wipFacts(
  jj: Runner,
  repoConfig: RepoConfig,
  base: LaneBase | null,
): Promise<{
  readonly bookmark: CommitId | null
  readonly bookmarkInAccepted: boolean
  readonly sourceInAccepted: boolean
} | null> {
  if (base?.base.kind !== "wip") return null
  const { source } = base
  const { bookmark } = base.base
  const acceptedBookmark = `::present(${revsetName(repoConfig.acceptedBookmark)})`
  const [target] = await commitsOf(jj, `present(${revsetName(bookmark)})`)
  const inAccepted = async (revset: string) =>
    (await commitsOf(jj, `(${revset}) & ${acceptedBookmark}`)).length > 0
  return {
    bookmark: target ?? null,
    bookmarkInAccepted: target === undefined ? false : await inAccepted(target),
    sourceInAccepted:
      target !== undefined
        ? false
        : await inAccepted(
            `present(${source}) | present(change_id(${await changeOf(jj, source)}))`,
          ),
  }
}

/**
 * A WIP base's state (ADR-0060): landed when its bookmark points into the
 * line (moved there, or squashed into accepted work, which keeps the bookmark and
 * drops the WIP's change, S77 item 2), or, with the bookmark gone, when the
 * commit the lane's `Pinetrie-Base` names, or its change, is on accepted work.
 * Gone when the bookmark is gone and the WIP did not land; else ok. No
 * facts, a base on accepted work, is ok. Pure.
 */
export function wipState(
  facts: {
    /** Where the WIP bookmark points now; null when it is gone. */
    readonly bookmark: CommitId | null
    /** The bookmark's commit is in accepted work's history. */
    readonly bookmarkInAccepted: boolean
    /** The commit `Pinetrie-Base` names, or its change, is in accepted work's history. */
    readonly sourceInAccepted: boolean
  } | null,
): BaseRecord["state"] {
  if (facts === null) return "ok"
  if (facts.bookmark !== null) return facts.bookmarkInAccepted ? "landed" : "ok"
  return facts.sourceInAccepted ? "landed" : "gone"
}

/** What became of a lane's WIP base (`wipState` of `wipFacts`); "ok" for a base on accepted work. */
export const readWipState = async (
  jj: Runner,
  repoConfig: RepoConfig,
  base: LaneBase | null,
): Promise<BaseRecord["state"]> =>
  wipState(await wipFacts(jj, repoConfig, base))
