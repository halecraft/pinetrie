// Accepted work in your repo, read for the host to plan from, and what
// catching the working copy up with it would do. Reads only: the steps are
// in `plan.ts`.

import {
  type AcceptedFacts,
  type CommitBase,
  type CommitId,
  commitId,
  type JjBaseRecord,
  type RepoConfig,
} from "@pinetrie/core"
import { describeFailure, lines, type Runner } from "@pinetrie/lanes"
import { revsetName } from "./lane/names.ts"
import { readCommits, readConflictedFiles } from "./lane/revisions.ts"
import { readChangeId } from "./proposed.ts"

/** What `planPublishGetLatest`'s rebase would do to the working copy: `AcceptedRecord`'s shape. */
type LatestPreview = NonNullable<AcceptedFacts["workingCopy"]["getLatest"]>

/**
 * A row of a read whose rows are tagged: the tags of the revsets holding its
 * commit, the commit, and the fields after it.
 */
interface TaggedRow {
  readonly tags: ReadonlySet<string>
  readonly commit: CommitId
  readonly fields: readonly string[]
}

/** Each revset as an `if(self.contained_in(…))` printing its tag, then a comma. */
const tagsTemplate = (sets: ReadonlyMap<string, string>): string =>
  [...sets]
    .map(
      ([tag, revset]) =>
        `if(self.contained_in(${JSON.stringify(revset)}), "${tag},")`,
    )
    .join(" ++ ")

/** A tagged read's output as rows: tags, a tab, the commit, then its own fields. */
export const taggedRows = (stdout: string): readonly TaggedRow[] =>
  lines(stdout).map(row => {
    const [tags = "", id = "", ...fields] = row.split("\t")
    return {
      tags: new Set(tags.split(",").filter(t => t !== "")),
      commit: commitId(id),
      fields,
    }
  })

/** The rows a tag holds: a count's revset is its tag's rows. */
const tagged = (rows: readonly TaggedRow[], tag: string) =>
  rows.filter(r => r.tags.has(tag))

/** One read of `sets`' union, its rows tagged; `fields` prints each row's own fields after its commit. */
async function readTagged(
  jj: Runner,
  sets: ReadonlyMap<string, string>,
  fields = '""',
): Promise<readonly TaggedRow[]> {
  const ran = await jj([
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    [...sets.values()].map(r => `(${r})`).join(" | "),
    "-T",
    `${tagsTemplate(sets)} ++ "\\t" ++ commit_id ++ "\\t" ++ ${fields} ++ "\\n"`,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj log", ran))
  return taggedRows(ran.stdout)
}

/** Both configs accepted work's record holds, printed on the root's row: it is always there. */
const CONFIG_FIELDS = `if(self.root(), json(config('revset-aliases."immutable_heads()"')) ++ "\\t" ++ json(config("revsets.log")))`

/**
 * What the second read counts, by tag, from what the first found: the
 * working copy against accepted work, the publish bookmark's pair when it
 * exists, each WIP's pair, and the preview's commits. No set is written out
 * commit by commit: each is named by a revset, as every read here is.
 */
export function acceptedCounts(found: {
  readonly accepted: string
  readonly publish: string | null
  readonly unfinished: readonly CommitId[]
}): ReadonlyMap<string, string> {
  const a = found.accepted
  return new Map([
    ["behind", `::${a} ~ ::@-`],
    ["ahead", `::@- ~ ::${a}`],
    ["conflicted", `(::@ ~ ::${a}) & conflicts()`],
    ["at-conflicted", "@ & conflicts()"],
    ["fork", `fork_point(${a} | @)`],
    ["at", "@"],
    ["heads", `heads(roots(${a}..@)::) ~ @`],
    ...(found.publish === null
      ? []
      : ([
          ["published-behind", `::${a} ~ ::${found.publish}`],
          ["published-ahead", `::${found.publish} ~ ::${a}`],
        ] as const)),
    ...found.unfinished.flatMap(
      (id, i) =>
        [
          [`unfinished-behind-${i}`, `::${a} ~ ::${id}`],
          [`unfinished-ahead-${i}`, `::${id} ~ ::${a}`],
        ] as const,
    ),
  ])
}

/** A config's value as `json(config(…))` prints it; null when it is no string. */
const configValue = (field: string | undefined): string | null => {
  if (field === undefined || field === "") return null
  const value: unknown = JSON.parse(field)
  return typeof value === "string" ? value.trim() : null
}

/**
 * Read accepted work's facts from your repo (`jj` as the host reads it, `git` on
 * the same repo, for the preview). Two reads whatever the WIPs: the commits
 * (accepted work's, the publish bookmark's, the WIPs', and on the root's row
 * both configs), then every count, as one read's rows tagged by the revsets
 * holding them. `@`'s conflicted files and the preview's git add their own.
 */
export async function acceptedFacts(
  jj: Runner,
  git: Runner,
  repoConfig: RepoConfig,
): Promise<AcceptedFacts> {
  const accepted = revsetName(repoConfig.acceptedBookmark)
  const publish = revsetName(repoConfig.publish)
  const first = await readTagged(
    jj,
    new Map([
      ["root", "root()"],
      ["accepted", `present(${accepted})`],
      ["publish", `present(${publish})`],
      [
        "unfinished",
        `bookmarks(glob:${revsetName(`${repoConfig.wipPrefix}*`)}) ~ ::present(${accepted})`,
      ],
    ]),
    `local_bookmarks.map(|b| b.name()).join(",") ++ "\\t" ++ ${CONFIG_FIELDS}`,
  )
  const [rooted] = tagged(first, "root")
  const heads = configValue(rooted?.fields[1])
  const log = configValue(rooted?.fields[2])
  const [commitRow] = tagged(first, "accepted")
  if (commitRow === undefined)
    return {
      commit: null,
      heads,
      log,
      unfinishedWork: [],
      published: { commit: null, behind: 0, ahead: 0 },
      workingCopy: {
        behind: 0,
        ahead: 0,
        getLatest: null,
        conflicts: { commits: 0, files: [] },
      },
    }
  const commit = commitRow.commit
  const published = tagged(first, "publish")[0]?.commit ?? null
  const unfinished = tagged(first, "unfinished").flatMap(r =>
    (r.fields[0] ?? "")
      .split(",")
      .filter(b => b.startsWith(repoConfig.wipPrefix))
      .map(bookmark => ({ bookmark, commit: r.commit })),
  )
  const counts = await readTagged(
    jj,
    acceptedCounts({
      accepted,
      publish: published === null ? null : publish,
      unfinished: unfinished.map(u => u.commit),
    }),
  )
  const count = (tag: string) => tagged(counts, tag).length
  const behind = count("behind")
  return {
    commit,
    heads,
    log,
    unfinishedWork: unfinished.map((u, i) => ({
      ...u,
      behind: count(`unfinished-behind-${i}`),
      ahead: count(`unfinished-ahead-${i}`),
    })),
    published:
      published === null
        ? { commit: null, behind: 0, ahead: 0 }
        : {
            commit: published,
            behind: count("published-behind"),
            ahead: count("published-ahead"),
          },
    workingCopy: {
      behind,
      ahead: count("ahead"),
      getLatest: behind === 0 ? null : await latestPreview(git, commit, counts),
      conflicts: {
        commits: count("conflicted"),
        files:
          count("at-conflicted") === 0
            ? []
            : await readConflictedFiles(jj, "@").catch(() => []),
      },
    },
  }
}

/**
 * `git merge-tree` exits 1 on conflicts and prints the merged tree, then the
 * conflicting paths, then a blank line and its messages. Null when `@`
 * shares no commit with accepted work but the root (their fork point is the
 * root), or git cannot merge.
 */
async function latestPreview(
  git: Runner,
  line: CommitId,
  counts: readonly TaggedRow[],
): Promise<LatestPreview | null> {
  const [base] = tagged(counts, "fork")
  const [at] = tagged(counts, "at")
  if (base === undefined || at === undefined) return null
  if (/^0+$/.test(base.commit)) return null
  const merged = await git([
    "merge-tree",
    "--write-tree",
    "--name-only",
    `--merge-base=${base.commit}`,
    line,
    at.commit,
  ])
  if (!merged.ok && merged.code !== 1) return null
  const [tree = "", ...rest] = merged.stdout.split("\n")
  const blank = rest.indexOf("")
  const conflicts = (blank < 0 ? rest : rest.slice(0, blank)).filter(
    p => p !== "",
  )
  const changed = await git(["diff", "--name-only", at.commit, tree.trim()])
  if (!changed.ok) return null
  return {
    changes: lines(changed.stdout).length,
    conflicts,
    heads: tagged(counts, "heads").length,
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
  readonly unfinished: {
    readonly commit: CommitId
    readonly under: CommitId
  } | null
}> {
  const acceptedBookmark = revsetName(repoConfig.acceptedBookmark)
  const [acceptedCommit] = await readCommits(jj, `present(${acceptedBookmark})`)
  if (acceptedCommit === undefined || base === null)
    return { acceptedCommit: acceptedCommit ?? null, unfinished: null }
  const unfinished = revsetName(base)
  const [commit] = await readCommits(
    jj,
    `present(${unfinished}) ~ ::${acceptedBookmark}`,
  )
  const [under] =
    commit === undefined
      ? []
      : await readCommits(
          jj,
          `latest(heads(::${commit} & ::${acceptedBookmark}))`,
        )
  return {
    acceptedCommit: acceptedCommit,
    unfinished:
      commit === undefined || under === undefined ? null : { commit, under },
  }
}

/**
 * What `unfinishedState` decides from: where a lane's WIP bookmark is, against the
 * line, and whether the commit its base names is there. Null for a base on
 * accepted work, or none.
 */
async function unfinishedFacts(
  jj: Runner,
  repoConfig: RepoConfig,
  base: CommitBase | null,
): Promise<{
  readonly bookmark: CommitId | null
  readonly bookmarkInAccepted: boolean
  readonly sourceInAccepted: boolean
} | null> {
  if (base?.base.kind !== "unfinished") return null
  const { source } = base
  const { bookmark } = base.base
  const acceptedBookmark = `::present(${revsetName(repoConfig.acceptedBookmark)})`
  const [target] = await readCommits(jj, `present(${revsetName(bookmark)})`)
  const inAccepted = async (revset: string) =>
    (await readCommits(jj, `(${revset}) & ${acceptedBookmark}`)).length > 0
  return {
    bookmark: target ?? null,
    bookmarkInAccepted: target === undefined ? false : await inAccepted(target),
    sourceInAccepted:
      target !== undefined
        ? false
        : await inAccepted(
            `present(${source}) | present(change_id(${await readChangeId(jj, source)}))`,
          ),
  }
}

/**
 * A WIP base's state: landed when its bookmark points into the line (moved
 * there, or squashed into accepted work, which keeps the bookmark and drops
 * the WIP's change), or, with the bookmark gone, when the commit the lane's
 * `Pinetrie-Base` names, or its change, is on accepted work. Gone when the
 * bookmark is gone and the WIP did not land; else ok. No facts, a base on
 * accepted work, is ok.
 */
export function unfinishedState(
  facts: {
    /** Where the WIP bookmark points now; null when it is gone. */
    readonly bookmark: CommitId | null
    /** The bookmark's commit is in accepted work's history. */
    readonly bookmarkInAccepted: boolean
    /** The commit `Pinetrie-Base` names, or its change, is in accepted work's history. */
    readonly sourceInAccepted: boolean
  } | null,
): JjBaseRecord["state"] {
  if (facts === null) return "ok"
  if (facts.bookmark !== null) return facts.bookmarkInAccepted ? "landed" : "ok"
  return facts.sourceInAccepted ? "landed" : "gone"
}

/** What became of a lane's WIP base (`unfinishedState` of `unfinishedFacts`); "ok" for a base on accepted work. */
export const readUnfinishedState = async (
  jj: Runner,
  repoConfig: RepoConfig,
  base: CommitBase | null,
): Promise<JjBaseRecord["state"]> =>
  unfinishedState(await unfinishedFacts(jj, repoConfig, base))
