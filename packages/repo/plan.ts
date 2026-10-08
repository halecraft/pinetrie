// repo/plan — every decision about your repo, as values (ADR-0105,
// ADR-0104, ADR-0061, ADR-0090).
//
// Each function here is pure and returns `RepoStep`s (`step.ts`), carried out
// by `executeRepo`. What is gathered is read by `offer.ts` and `line.ts`. So
// each rule below is tested without jj or git.

import {
  type AcceptedFacts,
  type CatchUpRead,
  type CommitId,
  commitId,
  HOST_OPERATOR,
  type LaneBase,
  type LaneName,
  type OfferSource,
  type PublishMove,
  type StartRead,
  type ThreadName,
  trailerRevset,
} from "@pinetrie/core"
import {
  bookmarkName,
  laneStackRef,
  laneTipRef,
  OFFER_BOOKMARKS,
  offerBookmark,
  type RepoConfig,
  revsetName,
  stackBookmark,
} from "@pinetrie/lanes"
import { git, host, type RepoStep, you } from "./step.ts"

/**
 * Your repo's `immutable_heads()` with accepted work and the offers on it added
 * (ADR-0104): `current` is the definition the repo has, null for jj's
 * builtin. `present()`, or a repo with no line fails every jj command
 * (S77). An offer is immutable only while its parent is accepted work, so nothing
 * of yours above accepted work is frozen. Given its own output, it returns it.
 */
export function immutableHeads(
  repoConfig: RepoConfig,
  current: string | null,
): string {
  const added = acceptedHeads(repoConfig.acceptedBookmark)
  const base = (current ?? "builtin_immutable_heads()").trim()
  return base.endsWith(added) ? base : `${base} | ${added}`
}

/** What `immutableHeads` adds for accepted work's `bookmark`: it and the offers on it. */
export const acceptedHeads = (bookmark: string): string => {
  const accepted = `present(${revsetName(bookmark)})`
  return `${accepted} | (${OFFER_BOOKMARKS} & children(${accepted}))`
}

/**
 * Your repo's `revsets.log` with the offers added (ADR-0104): `current` is
 * the definition the repo has, null for jj's default. An offer on accepted work is
 * an immutable head, which `builtin_log()` leaves out, so jj and jjui would
 * not show it (S77 item 8). Given its own output, it returns it.
 */
export function logRevset(current: string | null): string {
  const added = OFFER_BOOKMARKS
  const base = (current ?? "builtin_log()").trim()
  return base.endsWith(added) ? base : `${base} | ${added}`
}

/**
 * Set up accepted work (ADR-0104): its bookmark at your `@-`, as the
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
 * dropping commits (S77 item 1); with several bookmarks, a refusal of one
 * moves none (S111).
 */
export const moveForward = (
  as: "host" | "you",
  bookmarks: readonly string[],
  to: string,
): RepoStep =>
  (as === "host" ? host : you)("bookmark", "move", ...bookmarks, "--to", to)

/**
 * A publish's catch-up (ADR-0090): your work above accepted work rebased onto it,
 * as you, since it changes your files; jj snapshots them first. `-b @` moves
 * every head on your work with `@` (S80 item 1); `-r` would strip them of the
 * commits under them. A conflict is recorded, not refused, and
 * `planPublishFinish` reads it.
 */
export const planPublishCatchUp = (input: {
  readonly acceptedBookmark: string
}): RepoStep[] => [
  you("rebase", "-b", "@", "-d", revsetName(input.acceptedBookmark)),
]

/**
 * The move that ends a publish (ADR-0090): the publish bookmark forward to
 * accepted work, as the host, since it changes no file and anyone admitted may
 * (ADR-0076); or, accepting your commits, accepted work and the publish bookmark
 * together to your `@-`, as you, since it is your act.
 */
export const planPublishMove = (input: PublishMove): RepoStep[] => [
  input.accept
    ? moveForward("you", [input.acceptedBookmark, input.publish], "@-")
    : moveForward("host", [input.publish], revsetName(input.acceptedBookmark)),
]

/**
 * Undo a publish's catch-up (S111): its operation reverted, as you. Never `op
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
 * (about 100 ms, S44 item 8). As the host, so the operation is
 * `pinetrie-host`'s (S87 item 7).
 */
export const IMPORT: RepoStep = host("git", "import")

/**
 * A lane's bundle (`planBundle`, made in the lane) into your repo, as its
 * remote bookmark: git fetches the bookmark from the bundle into
 * `laneTipRef`, or with `stack` a split's into `laneStackRef`, and jj imports
 * it.
 */
export function planImport(input: {
  readonly lane: LaneName
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
 * Point lanes' remote bookmarks in your repo at commits, or delete them
 * (null), then import: the one writer of `laneTipRef` besides the fetch.
 * Archiving a root deletes its lanes' refs; restoring it writes them back
 * (S48 item 20).
 */
export const laneRefSteps = (
  updates: readonly {
    readonly lane: LaneName
    readonly commit: CommitId | null
  }[],
): RepoStep[] =>
  updates.length === 0
    ? []
    : [
        ...updates.map(u =>
          u.commit === null
            ? git("update-ref", "-d", laneTipRef(u.lane))
            : git("update-ref", laneTipRef(u.lane), u.commit),
        ),
        IMPORT,
      ]

/** The commits an acceptance made: its offer's trailers name a source or a thread. */
export const ACCEPTED_OFFER_COMMITS = trailerRevset(["source", "thread"])

/**
 * Where an offer starts, as a revset (ADR-0104): the newest ancestors of the
 * lane's tip you already have. That is the commit the lane's base names
 * (`start`: accepted work's commit, or the WIP's copy), and every lane commit a
 * accepted offer's `Pinetrie-Source` names above what the base holds
 * (`acceptedOfferCommitsRevset`), with their history: a parent lane's work
 * accepted after this lane forked, or a branch of this lane accepted
 * whole. Each source is
 * `present()`: one not fetched here names nothing you have. Several heads
 * start the offer from their merge.
 */
export function offerStart(input: {
  readonly tip: CommitId
  readonly start: CommitId
  readonly sources: readonly CommitId[]
}): string {
  const sources = input.sources.map(c => `present(${c})`).join(" | ")
  const had = sources === "" ? input.start : `${input.start} | ::(${sources})`
  return `heads(::${input.tip} & (${had}))`
}

/**
 * The accepted-offer commits `offerStart` reads, by their `Pinetrie-Source`
 * or `Pinetrie-Thread` trailers: an accepted offer's sources, or none for an
 * offer accepted before offers carried them (`untracedLanes`, S97). Those in `::<accepted>`, and in `::<wip>` for a
 * lane on a WIP, but not in the history of the base's `source` (S81). The lane merged that commit, so it holds
 * what was accepted below it. An offer keeps the diff from the merge of its
 * start to the tip, so a source the target holds as another commit would be
 * subtracted from the target, and conflict where accepted work changed it since.
 * The source is `present()`: a commit gone from your repo excludes nothing.
 */
export function acceptedOfferCommitsRevset(input: {
  readonly repoConfig: RepoConfig
  readonly base: LaneBase
}): string {
  const { base } = input.base
  const heads = [
    `present(${revsetName(input.repoConfig.acceptedBookmark)})`,
    ...(base.kind === "wip" ? [`present(${revsetName(base.bookmark)})`] : []),
  ].join(" | ")
  return `(::(${heads}) ~ ::present(${input.base.source})) & ${ACCEPTED_OFFER_COMMITS}`
}

/**
 * Whether a lane's catch-up forecast is read: `none` while the base is at
 * the lane's base start, `keep` when `known` was read at this tip and base
 * commit, else `read`: each lane reads it once per move of its tip or of
 * the base.
 */
export function planCatchUpRead(input: {
  readonly start: CommitId
  readonly to: CommitId
  readonly tip: CommitId
  readonly known: CatchUpRead | null
}): "none" | "keep" | "read" {
  const { start, to, tip, known } = input
  if (start === to) return "none"
  return known !== null && known.tip === tip && known.to === to
    ? "keep"
    : "read"
}

/**
 * The commits a catch-up's forecast diffs from: where the lane's next offer
 * would start. When the update merges accepted work, that is the offer's
 * start, which holds every accepted source the lane has: the sources
 * `mergeBase` joins to their accepted-offer commits before it merges
 * (S102), so the lane's own accepted work does not count as coming in. A
 * WIP's copy is no merge, and an untraced start names no source: both diff
 * from the base's start.
 */
export function catchUpHolds(input: {
  readonly base: LaneBase
  readonly start: StartRead
  /** The update copies the WIP rather than merging accepted work. */
  readonly copiesWip: boolean
}): readonly CommitId[] {
  const { base, start } = input
  return input.copiesWip ||
    start.kind === "untraced" ||
    start.start.length === 0
    ? [base.start]
    : start.start
}

/**
 * The files a catch-up would change, from one diff to the base's commit per
 * commit the lane holds (`moved`) and the diff from the lane's tip to it
 * (`lacking`): those every held commit has differently from the base, and
 * the tip too. A file the base has as any held commit has it keeps that
 * commit's value as the merge's base, so the merge leaves it alone. A union
 * would count every file of an offer accepted after the lane caught up
 * between offering it and its acceptance, whose start has two heads. In
 * the first diff's order.
 */
export function catchUpFilesOf(input: {
  readonly moved: readonly (readonly string[])[]
  readonly lacking: readonly string[]
}): string[] {
  const [first = [], ...rest] = input.moved
  const others = rest.map(files => new Set(files))
  const lacking = new Set(input.lacking)
  return first.filter(f => lacking.has(f) && others.every(o => o.has(f)))
}

/** One version of a commit in `jj evolog`: who made it, and from what. */
export interface EvologEntry {
  readonly commit: CommitId
  readonly change: string
  /** The operation that made it was the host's (`HOST_OPERATOR`). */
  readonly byHost: boolean
  readonly predecessors: readonly {
    readonly commit: CommitId
    readonly change: string
  }[]
}

/**
 * The template `parseEvolog` reads: one entry a line, its fields split by
 * tabs, each predecessor as `<commit>:<change>`. An entry whose operation
 * jj no longer holds prints an empty user, which is not the host's.
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
      const [commit = "", change = "", user = "", preds = ""] = line.split("\t")
      return {
        commit: commitId(commit),
        change,
        byHost: isHostUser(user),
        predecessors: preds
          .split(",")
          .filter(p => p !== "")
          .map(p => {
            const [c = "", ch = ""] = p.split(":")
            return { commit: commitId(c), change: ch }
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
 * each version, so nothing the host remembers is needed (S73).
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
    const before = entry.predecessors.find(p => p.change === entry.change)
    if (before === undefined) return { reached: false, yours }
    yours.push({ from: before.commit, to: at })
    at = before.commit
  }
}

/**
 * A host operation that rewrites an offer. An offer on accepted work is immutable
 * (ADR-0104), so the host's own rewrites of it pass `--ignore-immutable`; a
 * bookmark move rewrites no commit and needs none (S77 item 7).
 */
const rewrite = (...args: string[]): RepoStep =>
  host("--ignore-immutable", ...args)

/**
 * The revset naming the `i`th commit an offer's plan makes, until the plan's
 * last steps describe it. `jj new` has no template, so a commit it makes can
 * be found again only by something unique the plan chose (S48 item 18).
 */
export const nonceRevset = (nonce: string, i: number): string =>
  `description(exact:"${nonce}-${i}\n")`

/**
 * An offer in your repo: for each source, a commit on the one before (the
 * first on `start`, a merge when it names several heads), with that source's
 * files restored into it; the whole of it rebased onto `target`; the top
 * bookmarked; then each described, which retires its nonce. A single offer
 * has one source, the lane's tip; a stack has one per lane revision
 * (ADR-0105, S48 items 16 and 18). Every step is the host's, by nonce, never
 * a commit id kept across steps (S48 item 2).
 */
export function planOffer(input: {
  readonly name: ThreadName
  readonly start: readonly CommitId[]
  readonly sources: readonly OfferSource[]
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
    ...planRefreshOffer(at(0), input.target),
    host(
      "bookmark",
      "set",
      "--allow-backwards",
      offerBookmark(input.name),
      "-r",
      at(top),
    ),
    ...sources.map((source, i) =>
      rewrite("describe", "-r", at(i), "-m", source.description),
    ),
  ]
}

/** An offer moved onto the target: its bottom, and the rest with it. */
export const planRefreshOffer = (
  bottom: string,
  target: string,
): RepoStep[] => [rewrite("rebase", "-s", bottom, "-o", target)]

/**
 * A single offer rebuilt from its lane in place (ADR-0039): back onto where it
 * starts now, the lane's tip restored into it, onto the target again. Its
 * tree is then your target plus the lane's change since the start, which the
 * tip's files cannot give where it sits; its change id and bookmark stay
 * (S49). With `description`, it is described again: the WIP line, when the
 * agent's message no longer describes it.
 */
export function planRebuildOffer(input: {
  readonly change: string
  readonly start: readonly CommitId[]
  readonly tip: CommitId
  readonly target: string
  readonly description: string | null
}): RepoStep[] {
  const { change } = input
  return [
    rewrite("rebase", "-s", change, ...input.start.flatMap(c => ["-o", c])),
    rewrite("restore", "--from", input.tip, "--into", change),
    ...planRefreshOffer(change, input.target),
    ...(input.description === null
      ? []
      : planDescribe(change, input.description)),
  ]
}

/** An offer's revisions abandoned, to build it again. */
export const planAbandonOffer = (changes: readonly string[]): RepoStep[] =>
  changes.length === 0 ? [] : [rewrite("abandon", ...changes)]

/** One revision of an offer described again (an agent's commit message). */
export const planDescribe = (change: string, message: string): RepoStep[] => [
  rewrite("describe", "-r", change, "-m", message),
]

/**
 * After a race left a revision divergent: abandon the commit the host's own
 * operation made, and point the offer's bookmark at yours (S48 item 8).
 */
export const planRepair = (input: {
  /** The offer's bookmark, as its record holds it. */
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
 * Accept an offer (ADR-0104): its destination bookmark moved forward to its
 * top (`moveForward`), as the host, then the offer's bookmark deleted. Never
 * a rebase, and never your `@`.
 */
export function planOfferAcceptanceSteps(input: {
  /** The offer's bookmark, as its record holds it. */
  readonly bookmark: string
  readonly top: string
  /** The bookmark the acceptance moves: accepted work, or a WIP. */
  readonly destination: string
}): RepoStep[] {
  return [
    moveForward("host", [input.destination], input.top),
    host("bookmark", "delete", input.bookmark),
  ]
}
