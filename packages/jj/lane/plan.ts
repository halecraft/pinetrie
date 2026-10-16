// jj/lane/plan — the jj steps of a lane's life, as values: a fork's setup,
// the base's checkout, a catch-up's merge and joins, a turn's commit, a
// bundle of its history, and the renames of a disk from before them.

import {
  type BaseMerge,
  baseMessage,
  type CommitId,
  type ForkStart,
  HOST_WORKING_COPY,
  type PointId,
  shellWord,
  type ThreadId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  inLane,
  LANE_CONFIG_DIR,
  LANE_JJ_CONFIG,
  type LaneStep,
  laneShell,
  OLD_LANE_CONFIG_DIR,
} from "@pinetrie/lanes"
import { bookmarkName, FETCHED_REF, stackBookmark } from "./names.ts"
import { commitFromPoint, type JjLane } from "./points.ts"

/**
 * A fork's whole jj config: in the repo at `repo`, everything at or above its
 * fork point is immutable, so the lane cannot rewrite a commit its parent or
 * your repo holds. A parent's fork point is an ancestor of its
 * child's, so nothing needs reading from the lane first.
 *
 * Scoped to `repo` because `JJ_CONFIG` reaches every jj command in the lane,
 * and jj rejects the whole config in a repo that lacks the commit.
 * `repo` is a plain path, written into TOML unescaped.
 */
export const forkConfig = (
  repo: string,
  commits: readonly CommitId[],
): string =>
  `[[--scope]]\n--when.repositories = ["${repo}"]\n[--scope.revset-aliases]\n"immutable_heads()" = "builtin_immutable_heads() | ${commits.join(" | ")}"\n`

/**
 * `forkConfig` with the repo and its one commit left to `printf`'s two `%s`,
 * in that order.
 */
const FORK_CONFIG_TEMPLATE = forkConfig("%s", ["%s" as CommitId])

/**
 * Fetch `commits` from `from` (your working copy, at `/mnt/host-working-copy`) when the disk
 * lacks any of them. The fetch puts each on a branch, which is what makes jj
 * see it, and jj imports it at once: a jj command with
 * `--ignore-working-copy` imports nothing. A commit a fork's disk already
 * holds needs no fetch.
 */
export function fetchById(
  commits: readonly CommitId[],
  from: string = HOST_WORKING_COPY,
): LaneStep {
  const has = commits.map(c => `git cat-file -e ${c}^{commit}`).join(" && ")
  const refs = commits.map((c, i) => `+${c}:${FETCHED_REF}/${i}`).join(" ")
  return laneShell(
    `{ ${has}; } 2>/dev/null || { git fetch -q ${shellWord(from)} ${refs} && jj --ignore-working-copy git import --quiet; }`,
  )
}

/**
 * The lane steps that start a lane on accepted work: an empty commit on
 * accepted work's commit, left as `@-`, whose trailer says the thread is on
 * accepted work.
 */
export const planAcceptedStart = (commit: CommitId): LaneStep[] => [
  fetchById([commit]),
  inLane("jj", "new", commit),
  inLane(
    "jj",
    "commit",
    "-m",
    baseMessage("base: accepted work", { kind: "accepted", commit }),
  ),
]

/**
 * The lane steps that make a copy of a WIP: a commit on `on`
 * with the WIP's files and a change id of its own, left as `@-`. Never the
 * WIP's own commits: the lane's tip, immutable in your repo, would make them
 * immutable. Fetches nothing: the lane must hold both commits.
 */
export const planWipCopy = (
  wip: { readonly bookmark: string; readonly commit: CommitId },
  on: CommitId,
): LaneStep[] => [
  inLane("jj", "new", on),
  inLane("jj", "restore", "--from", wip.commit),
  inLane(
    "jj",
    "commit",
    "-m",
    baseMessage(`copy of ${wip.bookmark}`, {
      kind: "wip",
      bookmark: wip.bookmark,
      commit: wip.commit,
    }),
  ),
]

/** What an update runs in a lane before its merge, and what it merges (`mergeUpdate`). */
export interface MergePlan {
  /**
   * A fetch of accepted work's commit; or a fetch of the WIP's commit and its copy
   * on the lane's previous copy, left as `@-`.
   */
  readonly steps: readonly LaneStep[]
  /** The commit to merge, or the copy the steps leave as `@-`. */
  readonly source: CommitId | "copy"
  /** Accepted work's names the base (`Pinetrie-Base`); a WIP's copy names its own; a parent's none. */
  readonly message: string
  /** With nothing to merge, a commit still names accepted work (`BaseMerge`). */
  readonly mark: boolean
  /**
   * The commits whose titles the update lists, `<from>..<to>` without the
   * accepted thread commits it joined (`mergeUpdate`); `from` null is the lane
   * before the merge.
   */
  readonly came: { readonly from: CommitId | null; readonly to: CommitId }
}

/**
 * An update's steps in `lane`, whose points are commits. A WIP's copy
 * fetches only the WIP's commit: the copy's parent is the lane's own. The
 * thread it branched from is merged as accepted work's commit is, with no
 * `Pinetrie-Base`: it is no base, and what the lane holds of it is its
 * history.
 */
export function planMerge(lane: JjLane, from: BaseMerge): MergePlan {
  const commit = (p: PointId) => commitFromPoint(lane, p)
  if (from.kind === "accepted") {
    const accepted = commit(from.point)
    return {
      steps: [fetchById([accepted])],
      source: accepted,
      message: baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: accepted,
      }),
      mark: from.mark,
      came: { from: null, to: accepted },
    }
  }
  if (from.kind === "parent") {
    const newest = commit(from.point)
    return {
      steps: [fetchById([newest])],
      source: newest,
      message: `catch up: ${from.name}`,
      mark: false,
      came: { from: commit(from.caughtUpWith), to: newest },
    }
  }
  return {
    steps: [fetchById([from.commit]), ...planWipCopy(from, commit(from.on))],
    source: "copy",
    message: `update: ${from.bookmark}`,
    mark: false,
    came: { from: from.under, to: from.commit },
  }
}

/** An accepted thread commit on accepted work the lane lacks, and the sources its message names (`sourcesOf`). */
export interface AcceptedThreadCommitAbove {
  readonly acceptedThreadCommit: CommitId
  readonly sources: readonly CommitId[]
}

/** An accepted thread commit to join to the sources the lane holds, before an update's merge. */
export interface Join {
  readonly acceptedThreadCommit: CommitId
  /** Of its sources, those in the lane's history: a squash may name others. */
  readonly sources: readonly CommitId[]
  /**
   * The join's message. It carries no trailer: the host finds bases and
   * accepted thread commits by their trailers (`newestBase`,
   * `acceptedThreadCommitsRevset`), and a join is neither.
   */
  readonly message: string
}

/**
 * The accepted thread commits an update joins to their sources before it
 * merges, oldest first as they come: each that names a source the lane holds.
 * An accepted thread commit is a copy of the lane's work on accepted work, and
 * the join says so in history, so the merge does not bring that work in twice.
 * One naming a source the lane lacks too, a squash's, is joined all the same:
 * the rest of it is accepted work's. Each join is made on the one before, so a
 * later one's base holds the earlier ones.
 */
export function planJoins(
  accepted: readonly AcceptedThreadCommitAbove[],
  held: ReadonlySet<CommitId>,
): readonly Join[] {
  return accepted.flatMap(({ acceptedThreadCommit, sources }) => {
    const ours = sources.filter(s => held.has(s))
    return ours.length === 0
      ? []
      : [
          {
            acceptedThreadCommit,
            sources: ours,
            message: `join: ${acceptedThreadCommit} holds ${ours.join(" ")}`,
          },
        ]
  })
}

/**
 * The lane steps that make a disk a fork of `jj`, whose points are commits:
 * a change of its own, before any other jj command runs there, the lane's
 * bookmark at its base, and inherited history made immutable. Without it,
 * the fork's first turn reuses its parent's change id, and your repo sees a
 * divergent change. A base with several parents is committed once, empty, so
 * the bookmark names one commit. A lane starting on accepted work or a WIP's
 * copy is based on the commit that names it.
 */
export function planForkSetup(jj: JjLane, start: ForkStart): LaneStep[] {
  const { lane } = jj
  const recorded =
    start.kind === "recorded"
      ? start.points.map(p => commitFromPoint(jj, p))
      : []
  const base: LaneStep[] =
    start.kind === "accepted"
      ? planAcceptedStart(commitFromPoint(jj, start.point))
      : start.kind === "wip"
        ? [
            fetchById([start.commit, start.under]),
            ...planWipCopy(start, start.under),
          ]
        : [
            fetchById(recorded),
            inLane("jj", "new", ...recorded),
            ...(recorded.length > 1
              ? [inLane("jj", "commit", "-m", `base: ${lane}`)]
              : []),
          ]
  // A start made here is known only once made: the config reads @-.
  const immutable =
    start.kind !== "recorded" || recorded.length > 1
      ? `"$(jj --ignore-working-copy log --no-graph -r @- -T commit_id)"`
      : shellWord(recorded[0] ?? "")
  // After `planFork`'s pre-rename removal of the old config folder.
  return [
    ...base,
    inLane(
      "jj",
      "bookmark",
      "set",
      "--allow-backwards",
      bookmarkName(lane),
      "-r",
      "@-",
    ),
    laneShell(
      `mkdir -p ${LANE_CONFIG_DIR} && printf ${shellWord(FORK_CONFIG_TEMPLATE)} ${WORKSPACE_ROOT} ${immutable} > ${LANE_JJ_CONFIG}`,
    ),
  ]
}

/** pre-rename: the prefix of the lane's bookmarks before b05e2252. */
const OLD_BOOKMARK_PREFIX = "pineta/"

/** pre-rename: what of the names before the rename is on a lane's disk. */
export interface OldNamesOnDisk {
  readonly configDir: { readonly old: boolean; readonly current: boolean }
  /** Every bookmark in the lane's repo. */
  readonly bookmarks: readonly string[]
}

/**
 * pre-rename: the steps that give a disk cloned from a snapshot taken before
 * the rename the names the host reads now; empty when nothing is old.
 * The config folder moves first, so the jj steps after it run under the
 * lane's own config: jj ignores a `JJ_CONFIG` naming no file. Bookmarks of
 * other lanes, a fork's inherited ones, are never read and are left alone.
 */
export function planOldNamesOnDisk(
  facts: OldNamesOnDisk,
  lane: ThreadId,
): LaneStep[] {
  const { configDir, bookmarks } = facts
  const has = new Set(bookmarks)
  // `-R`, so the steps need no working directory.
  const bookmark = (...args: string[]) =>
    inLane(
      "jj",
      "-R",
      WORKSPACE_ROOT,
      "--ignore-working-copy",
      "bookmark",
      ...args,
    )
  const folder = !configDir.old
    ? []
    : [
        laneShell(
          configDir.current
            ? `rm -rf ${OLD_LANE_CONFIG_DIR}`
            : `mv ${OLD_LANE_CONFIG_DIR} ${LANE_CONFIG_DIR}`,
        ),
      ]
  const pairs: readonly (readonly [string, string])[] = [
    [`${OLD_BOOKMARK_PREFIX}${lane}`, bookmarkName(lane)],
    [`${OLD_BOOKMARK_PREFIX}${lane}-stack`, stackBookmark(lane)],
  ]
  const renames = pairs
    .filter(([old]) => has.has(old))
    .map(([old, now]) =>
      has.has(now) ? bookmark("delete", old) : bookmark("rename", old, now),
    )
  const fetched = bookmarks.filter(b =>
    b.startsWith(`${OLD_BOOKMARK_PREFIX}fetched/`),
  )
  return [
    ...folder,
    ...renames,
    ...(fetched.length === 0 ? [] : [bookmark("delete", ...fetched)]),
  ]
}

/**
 * A git bundle of `bookmark` in the lane, written to the host file `to`,
 * excluding what your repo already has: a bundle naming only the bookmark
 * carries the whole history, 1.1 MB against 8 KB for one commit on pine·trie's
 * repo. Your repo imports it with `@pinetrie/jj`'s `planImport`.
 */
export const planBundle = (input: {
  readonly bookmark: string
  readonly have: readonly CommitId[]
  readonly to: string
}): LaneStep => ({
  in: "lane",
  argv: [
    "git",
    "bundle",
    "create",
    "-",
    `refs/heads/${input.bookmark}`,
    ...input.have.map(c => `^${c}`),
  ],
  stdoutTo: input.to,
})

/** What a turn's revision is: a commit of `@`, a commit the agent made, or none. */
export type TurnCommit =
  | { readonly kind: "commit" }
  | { readonly kind: "adopt"; readonly commit: CommitId }
  | { readonly kind: "none" }

/**
 * A turn whose `@` has changes commits them. With `@` empty, a single parent
 * that descends from the lane's bookmark is a commit the agent made in the
 * turn, and is the turn's revision: otherwise the proposed changes would lack
 * it, and a branch's `jj new` would put the bookmark's files back. A parent on
 * another line, such as a stack's, or a merge, is left alone.
 */
export function planTurnCommit(facts: {
  readonly atEmpty: boolean
  /** `@-`: one commit, or several after `jj new a b`. */
  readonly parents: readonly CommitId[]
  readonly bookmark: CommitId | null
  /** The bookmark is an ancestor of `@-`, or `@-` itself. */
  readonly parentDescends: boolean
}): TurnCommit {
  if (!facts.atEmpty) return { kind: "commit" }
  const [parent, ...others] = facts.parents
  if (parent === undefined || others.length > 0) return { kind: "none" }
  if (facts.bookmark === null || parent === facts.bookmark)
    return { kind: "none" }
  return facts.parentDescends
    ? { kind: "adopt", commit: parent }
    : { kind: "none" }
}

/**
 * A base's checkout of accepted work's commits (`yours`), by id. On a fresh
 * disk, `git init` and `jj git init --colocate` first, not `jj git clone`: a
 * fresh volume holds `lost+found`, which `jj git clone` refuses.
 *
 * On a base copied from the one before, made at other commits, the fetched
 * ref moves sideways when your `@-` was rewritten rather than built
 * on: the import abandons the commit it named, and rebases the working-copy
 * commit, a child of it, with `--ignore-working-copy`. The working copy is
 * then stale, and `jj new` refuses until `jj workspace update-stale`, which
 * does nothing when it is not.
 */
export function planBaseCheckout(input: {
  readonly yours: readonly CommitId[]
  readonly fresh: boolean
}): readonly LaneStep[] {
  return [
    ...(input.fresh
      ? [inLane("git", "init", "-q"), inLane("jj", "git", "init", "--colocate")]
      : []),
    fetchById(input.yours),
    ...(input.fresh ? [] : [inLane("jj", "workspace", "update-stale")]),
    inLane("jj", "new", ...input.yours),
  ]
}
