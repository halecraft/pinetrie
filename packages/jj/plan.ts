// The steps of every change to your repo, as `RepoStep`s, and the revsets
// they and the reads share: each rule here is tested without jj or git.

import {
  type AcceptedFacts,
  type CommitBase,
  type CommitId,
  commitId,
  HOST_OPERATOR,
  type NonEmpty,
  type ProposedSource,
  type PublishMove,
  type RepoConfig,
  type RevisionFacts,
  type ThreadId,
  type ThreadName,
  trailerRevset,
} from "@pinetrie/core"
import {
  bookmarkName,
  HOST_REMOTE,
  hostProposedRef,
  laneParkedRef,
  laneStackRef,
  laneTipRef,
  PROPOSED_BOOKMARKS,
  proposedBookmark,
  revsetName,
  stackBookmark,
} from "./lane/names.ts"
import { git, host, type RepoStep, you } from "./step.ts"

/**
 * Your repo's `immutable_heads()` with accepted work and the proposed changes
 * on it added: `current` is the definition the repo has, null for jj's builtin.
 * `present()`, or a repo with no line fails every jj command. Proposed changes
 * are immutable only while its parent is accepted work, so nothing of yours
 * above accepted work is frozen. Given its own output, it returns it.
 */
export function immutableHeads(
  repoConfig: RepoConfig,
  current: string | null,
): string {
  const added = acceptedHeads(repoConfig.acceptedBookmark)
  const base = (current ?? "builtin_immutable_heads()").trim()
  return base.endsWith(added) ? base : `${base} | ${added}`
}

/** What `immutableHeads` adds for accepted work's `bookmark`: it and the proposed changes on it. */
const acceptedHeads = (bookmark: string): string => {
  const accepted = `present(${revsetName(bookmark)})`
  return `${accepted} | (${PROPOSED_BOOKMARKS} & children(${accepted}))`
}

/**
 * Your repo's `revsets.log` with the proposed changes added: `current` is the
 * definition the repo has, null for jj's default. Proposed changes on accepted
 * work are an immutable head, which `builtin_log()` leaves out, so jj and jjui
 * would not show it. Given its own output, it returns it.
 */
export function logRevset(current: string | null): string {
  const added = PROPOSED_BOOKMARKS
  const base = (current ?? "builtin_log()").trim()
  return base.endsWith(added) ? base : `${base} | ${added}`
}

/**
 * Set up accepted work: its bookmark at your `@-`, as the
 * host, then your repo's `immutable_heads()` (`immutableHeads`), written in
 * the repo's own config. Run only on your command, after you saw `heads`.
 */
export const planSetup = (input: {
  readonly acceptedBookmark: string
  readonly heads: string
  readonly log: string
}): RepoStep[] => [
  host("bookmark", "create", input.acceptedBookmark, "-r", "@-"),
  you(
    "config",
    "set",
    "--repo",
    'revset-aliases."immutable_heads()"',
    input.heads,
  ),
  you("config", "set", "--repo", "revsets.log", input.log),
]

/**
 * `bookmarks` moved forward to `to`, in one operation: an acceptance
 * and a publish are each one. Never `--allow-backwards`: jj refuses a move
 * that is not forward, so a move planned on stale facts fails rather than
 * dropping commits; with several bookmarks, a refusal of one moves none.
 */
export const moveForward = (
  as: "host" | "you",
  bookmarks: readonly string[],
  to: string,
): RepoStep =>
  (as === "host" ? host : you)("bookmark", "move", ...bookmarks, "--to", to)

/**
 * A publish's catch-up: your work above accepted work rebased onto it,
 * as you, since it changes the working copy; jj snapshots it first. `-b @` moves
 * every head on your work with `@`; `-r` would strip them of the
 * commits under them. A conflict is recorded, not refused, and
 * `planPublishFinish` reads it.
 */
export const planPublishCatchUp = (input: {
  readonly acceptedBookmark: string
}): RepoStep[] => [
  you("rebase", "-b", "@", "-d", revsetName(input.acceptedBookmark)),
]

/**
 * The move that ends a publish: the publish bookmark forward to accepted
 * work, as the host, since it changes no file and anyone admitted may; or, accepting your commits, accepted work and the publish bookmark
 * together to your `@-`, as you, since it is your act.
 */
export const planPublishMove = (input: PublishMove): RepoStep[] => [
  input.accept
    ? moveForward("you", [input.acceptedBookmark, input.publish], "@-")
    : moveForward("host", [input.publish], revsetName(input.acceptedBookmark)),
]

/**
 * Undo a publish's catch-up: its operation reverted, as you. Never `op
 * restore`, which deletes from disk an edit made since.
 */
export const planCatchUpUndo = (op: string): RepoStep[] => [
  you("op", "revert", op),
]

/**
 * What setting accepted work up would write to your repo's config, from what jj
 * resolves now (`AcceptedFacts`): its immutable heads and log, each with the
 * line's own added (`immutableHeads`, `logRevset`). Its record shows them.
 */
export const setupProposal = (
  repoConfig: RepoConfig,
  facts: Pick<AcceptedFacts, "heads" | "log">,
): { readonly heads: string; readonly log: string } => ({
  heads: immutableHeads(repoConfig, facts.heads),
  log: logRevset(facts.log),
})

/**
 * `jj git import` into your repo, as the host. A jj command with
 * `--ignore-working-copy` imports no git refs, so every ref pinetrie writes is
 * imported at once. With the flag, the import leaves your working copy
 * unsnapshotted: 12-47 ms, where a plain `jj git import` snapshots it too
 * (about 100 ms). As the host, so the operation is `pinetrie-host`'s.
 */
export const IMPORT: RepoStep = host("git", "import")

/**
 * A lane's bundle (`planBundle`, made in the lane) into your repo, as its
 * remote bookmark: git fetches the bookmark from the bundle into
 * `laneTipRef`, or with `stack` a split's into `laneStackRef`, and jj imports
 * it.
 */
export function planImport(input: {
  readonly lane: ThreadId
  /** A host file holding the bundle. */
  readonly bundle: string
  /** A split's stack instead of the lane's tip (`stackBookmark`). */
  readonly stack: boolean
}): RepoStep[] {
  const bookmark = input.stack
    ? stackBookmark(input.lane)
    : bookmarkName(input.lane)
  const to = input.stack ? laneStackRef(input.lane) : laneTipRef(input.lane)
  return [
    git("fetch", "-q", input.bundle, `+refs/heads/${bookmark}:${to}`),
    IMPORT,
  ]
}

/**
 * Point lanes' remote bookmarks in your repo at commits, or remove them
 * (null), then import: the one writer of `laneTipRef` besides the fetch.
 * Archiving a root removes its lanes' refs, first parking them under
 * `laneParkedRef`, so git keeps their history through a gc: a restore writes
 * a commit of that history back. The park is a fetch from the repo itself
 * with a pattern, which copies nothing and succeeds for a lane never
 * fetched, where `update-ref` from a missing ref would fail. A restore
 * removes the parked ref.
 */
export const laneRefSteps = (
  updates: readonly {
    readonly lane: ThreadId
    readonly commit: CommitId | null
  }[],
): RepoStep[] =>
  updates.length === 0
    ? []
    : [
        ...updates.flatMap(u =>
          u.commit === null
            ? [
                git(
                  "fetch",
                  "-q",
                  ".",
                  `+${laneTipRef(u.lane)}*:${laneParkedRef(u.lane)}*`,
                ),
                git("update-ref", "-d", laneTipRef(u.lane)),
              ]
            : [
                git("update-ref", laneTipRef(u.lane), u.commit),
                git("update-ref", "-d", laneParkedRef(u.lane)),
              ],
        ),
        IMPORT,
      ]

/**
 * The host's version of the proposed changes under each of `bookmarks` moved
 * to its bookmark, and tracked: copied in git from the bookmark's own ref,
 * which jj exports after each host command, so no step names a commit id;
 * imported once, which moves a tracked bookmark with it; and tracked, which
 * makes the tracking the first time, writes nothing after, and repairs a jj
 * command of yours that imported the ref untracked before this import. An
 * untracked one would make the proposed changes an immutable head. jj exports
 * no conflicted bookmark, so this is planned only for proposed changes read
 * whole, never divergent ones.
 */
export const markSteps = (...bookmarks: NonEmpty<string>): RepoStep[] => [
  ...bookmarks.map(b =>
    git("update-ref", hostProposedRef(b), `refs/heads/${b}`),
  ),
  IMPORT,
  host("bookmark", "track", ...bookmarks, "--remote", HOST_REMOTE),
]

/**
 * Each of `bookmarks` and the host's version of it forgotten, in one
 * operation: the one way the host removes that ref. Deleted in git, then
 * imported, it would make jj abandon every commit only it held, a commit of
 * yours under proposed changes among them, and rebase yours off it.
 * Forgetting abandons nothing, and is no operation when there is nothing to
 * forget.
 */
export const forgetSteps = (...bookmarks: NonEmpty<string>): RepoStep[] => [
  host("bookmark", "forget", "--include-remotes", ...bookmarks),
]

/** The commits an acceptance made: its proposed changes' trailers name a source or a thread. */
export const ACCEPTED_THREAD_COMMITS = trailerRevset(["source", "thread"])

/**
 * Where proposed changes start, as a revset: the newest ancestors of the
 * lane's tip you already have. That is the commit the lane's base names
 * (`start`: accepted work's commit, or the WIP's copy), and every lane commit a
 * accepted proposed changes' `Pinetrie-Source` names above what the base holds
 * (`acceptedThreadCommitsRevset`), with their history: a parent lane's work
 * accepted after this lane forked, or a branch of this lane accepted
 * whole. Each source is
 * `present()`: one not fetched here names nothing you have. Several heads
 * start the proposed changes from their merge.
 */
export function proposedStart(input: {
  readonly tip: CommitId
  readonly start: CommitId
  readonly sources: readonly CommitId[]
}): string {
  const sources = input.sources.map(c => `present(${c})`).join(" | ")
  const had = sources === "" ? input.start : `${input.start} | ::(${sources})`
  return `heads(::${input.tip} & (${had}))`
}

/**
 * The accepted thread commits `proposedStart` reads, by their `Pinetrie-Source`
 * or `Pinetrie-Thread` trailers: accepted proposed changes' sources, or none
 * for an proposed changes accepted before proposed changes carried them
 * (`untracedLanes`). Those in `::<accepted>`, and in `::<wip>` for a lane on a
 * WIP, but not in the history of the base's `source`. The lane merged that
 * commit, so it holds what was accepted below it. Proposed changes keep the
 * diff from the merge of its start to the tip, so a source the target holds as
 * another commit would be subtracted from the target, and conflict where
 * accepted work changed it since. The source is `present()`: a commit gone from
 * your repo excludes nothing.
 */
export function acceptedThreadCommitsRevset(input: {
  readonly repoConfig: RepoConfig
  readonly base: CommitBase
}): string {
  const { base } = input.base
  const heads = [
    `present(${revsetName(input.repoConfig.acceptedBookmark)})`,
    ...(base.kind === "wip" ? [`present(${revsetName(base.bookmark)})`] : []),
  ].join(" | ")
  return `(::(${heads}) ~ ::present(${input.base.source})) & ${ACCEPTED_THREAD_COMMITS}`
}

/** One version of a commit in `jj evolog`: who made it, and from what. */
export interface EvologEntry {
  readonly commit: CommitId
  readonly changeId: string
  /** The operation that made it was the host's (`HOST_OPERATOR`). */
  readonly byHost: boolean
  readonly predecessors: readonly {
    readonly commit: CommitId
    readonly changeId: string
  }[]
}

/**
 * The template `parseEvolog` reads: one entry a line, its fields split by
 * tabs, each predecessor as `<commit>:<change>`. An entry whose operation
 * jj no longer holds (a tidy cut it) prints an empty user, which is not the
 * host's, and no predecessors, so a walk stops there.
 */
export const EVOLOG_ENTRY =
  'commit.commit_id() ++ "\t" ++ commit.change_id() ++ "\t" ++ if(operation, operation.user(), "") ++ "\t" ++ predecessors.map(|p| p.commit_id() ++ ":" ++ p.change_id()).join(",") ++ "\n"'

/** Whether an operation's user (`<user>@<hostname>`) is the host's. */
const isHostUser = (user: string): boolean =>
  user.startsWith(`${HOST_OPERATOR}@`)

/** `jj evolog -T EVOLOG_ENTRY`'s output -> its entries, newest first. */
export function parseEvolog(stdout: string): EvologEntry[] {
  return stdout
    .split("\n")
    .filter(line => line !== "")
    .map(line => {
      const [commit = "", changeId = "", user = "", preds = ""] =
        line.split("\t")
      return {
        commit: commitId(commit),
        changeId,
        byHost: isHostUser(user),
        predecessors: preds
          .split(",")
          .filter(p => p !== "")
          .map(p => {
            const [c = "", ch = ""] = p.split(":")
            return { commit: commitId(c), changeId: ch }
          }),
      }
    })
}

/**
 * The versions of a revision since the host's newest: walking back from
 * `from` through each entry's predecessor of the same change, until a
 * version the host made (`reached`). It stops, not `reached`, at an entry
 * with no such predecessor, one the read did not return, or a cycle.
 * `yours` are the versions an operation not the host's made, each with the
 * version before it: only those can be your edit. The evolog says who made
 * each version, as long as the op log still holds the operations.
 */
export function walkToHost(
  entries: readonly EvologEntry[],
  from: CommitId,
): {
  readonly reached: boolean
  readonly yours: readonly { readonly from: CommitId; readonly to: CommitId }[]
} {
  const byCommit = new Map(entries.map(e => [e.commit, e]))
  const yours: { from: CommitId; to: CommitId }[] = []
  const seen = new Set<CommitId>()
  let at = from
  for (;;) {
    const entry = byCommit.get(at)
    if (entry === undefined || seen.has(at)) return { reached: false, yours }
    if (entry.byHost) return { reached: true, yours }
    seen.add(at)
    const before = entry.predecessors.find(p => p.changeId === entry.changeId)
    if (before === undefined) return { reached: false, yours }
    yours.push({ from: before.commit, to: at })
    at = before.commit
  }
}

/** What a revision's read since the host needs next, or what it found (`planSinceHost`). */
type SinceHostRead =
  | { readonly kind: "known"; readonly facts: RevisionFacts }
  /** Walk its evolog back to a version the host made (`walkToHost`). */
  | { readonly kind: "walk" }
  /** Compare it with the commit of its change in the host's version. */
  | { readonly kind: "compare"; readonly host: CommitId }

/**
 * The next read of a revision since the host's version, from what is read so
 * far. Marked proposed changes are the host's, whole, since a commit id hashes
 * all below it, so nothing is read. Otherwise the evolog, which also finds a
 * host step that stopped before its mark. A walk that cannot reach the host,
 * whose operations a tidy cut, compares with the host's version, when there is
 * one.
 */
export function planSinceHost(input: {
  readonly marked: boolean
  readonly host: CommitId | null
  /** What the walk found; null before it ran. */
  readonly walked: RevisionFacts | null
}): SinceHostRead {
  if (input.marked)
    return { kind: "known", facts: { reached: true, yoursChanged: false } }
  if (input.walked === null) return { kind: "walk" }
  if (input.walked.reached || input.host === null)
    return { kind: "known", facts: input.walked }
  return { kind: "compare", host: input.host }
}

/**
 * A host operation that rewrites proposed changes. Proposed changes on accepted
 * work are immutable, so the host's own rewrites of it pass
 * `--ignore-immutable`; a bookmark move rewrites no commit and needs none.
 */
const rewrite = (...args: string[]): RepoStep =>
  host("--ignore-immutable", ...args)

/**
 * The revset naming the `i`th commit proposed changes' plan makes, until the
 * plan's last steps describe it. `jj new` has no template, so a commit it makes
 * can be found again only by something unique the plan chose.
 */
export const nonceRevset = (nonce: string, i: number): string =>
  `description(exact:"${nonce}-${i}\n")`

/**
 * Proposed changes in your repo: for each source, a commit on the one before
 * (the first on `start`, a merge when it names several heads), with that
 * source's files restored into it; the whole of it rebased onto `target`; the
 * top bookmarked; then each described, which retires its nonce. Single proposed
 * changes has one source, the lane's tip; a stack has one per lane revision.
 * Every step is the host's, by nonce, never a commit id kept across steps: one
 * kept names a hidden commit once an earlier step rewrote it.
 */
export function planProposedChanges(input: {
  readonly name: ThreadName
  readonly start: readonly CommitId[]
  readonly sources: readonly ProposedSource[]
  readonly target: string
  readonly nonce: string
}): RepoStep[] {
  const { nonce, sources } = input
  const at = (i: number) => nonceRevset(nonce, i)
  const made = sources.flatMap((source, i) => [
    host(
      "new",
      "--no-edit",
      ...(i === 0 ? input.start : [at(i - 1)]),
      "-m",
      `${nonce}-${i}`,
    ),
    rewrite("restore", "--from", source.commit, "--into", at(i)),
  ])
  const top = sources.length - 1
  return [
    ...made,
    ...planRefreshProposed(at(0), input.target),
    host(
      "bookmark",
      "set",
      "--allow-backwards",
      proposedBookmark(input.name),
      "-r",
      at(top),
    ),
    ...sources.map((source, i) =>
      rewrite("describe", "-r", at(i), "-m", source.description),
    ),
  ]
}

/** Proposed changes moved onto the target: its bottom, and the rest with it. */
export const planRefreshProposed = (
  bottom: string,
  target: string,
): RepoStep[] => [rewrite("rebase", "-s", bottom, "-o", target)]

/**
 * Single proposed changes rebuilt from its lane in place: back onto where it
 * starts now, the lane's tip restored into it, onto the target again. Its
 * tree is then your target plus the lane's change since the start, which the
 * tip's files cannot give where it sits; its change id and bookmark stay.
 * With `description`, it is described again: the WIP line, when the
 * agent's message no longer describes it.
 */
export function planRebuildProposed(input: {
  readonly changeId: string
  readonly start: readonly CommitId[]
  readonly tip: CommitId
  readonly target: string
  readonly description: string | null
}): RepoStep[] {
  const { changeId } = input
  return [
    rewrite("rebase", "-s", changeId, ...input.start.flatMap(c => ["-o", c])),
    rewrite("restore", "--from", input.tip, "--into", changeId),
    ...planRefreshProposed(changeId, input.target),
    ...(input.description === null
      ? []
      : planDescribe(changeId, input.description)),
  ]
}

/** Proposed changes' revisions abandoned, to build it again. */
export const planAbandonProposed = (
  changeIds: readonly string[],
): RepoStep[] =>
  changeIds.length === 0 ? [] : [rewrite("abandon", ...changeIds)]

/** One revision of proposed changes described again (an agent's commit message). */
export const planDescribe = (changeId: string, message: string): RepoStep[] => [
  rewrite("describe", "-r", changeId, "-m", message),
]

/**
 * After a race left a revision divergent: abandon the commit the host's own
 * operation made, and point the proposed changes' bookmark at yours.
 */
export const planRepair = (input: {
  /** The proposed changes' bookmark, as its record holds it. */
  readonly bookmark: string
  readonly hosts: CommitId
  readonly yours: CommitId
  readonly top: boolean
}): RepoStep[] => [
  rewrite("abandon", input.hosts),
  ...(input.top
    ? [
        host(
          "bookmark",
          "set",
          "--allow-backwards",
          input.bookmark,
          "-r",
          input.yours,
        ),
      ]
    : []),
]

/**
 * Accept proposed changes: its destination bookmark moved forward to its top
 * (`moveForward`), as the host, then the proposed changes' bookmark and the
 * host's version of it forgotten (`forgetSteps`), once the destination holds
 * the proposed changes. Never a rebase, and never your `@`.
 */
export function planAcceptanceSteps(input: {
  /** The proposed changes' bookmark, as its record holds it. */
  readonly bookmark: string
  readonly top: string
  /** The bookmark the acceptance moves: accepted work, or a WIP. */
  readonly destination: string
}): RepoStep[] {
  return [
    moveForward("host", [input.destination], input.top),
    ...forgetSteps(input.bookmark),
  ]
}
