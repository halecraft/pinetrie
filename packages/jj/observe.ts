// What an outside change moved in your repo: the fingerprint read at one
// operation, and what moved between two. The owner reads and acts.

import {
  type CommitId,
  commitId,
  isThreadId,
  type RepoConfig,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import {
  LANE_REMOTE_PREFIX,
  OFFER_BOOKMARKS,
  OFFER_PREFIX,
  revsetName,
} from "./lane/names.ts"

/**
 * What an outside change can move: accepted work, the WIPs, the publish bookmark,
 * the offers, the lanes' refs, and `@`.
 */
export interface Fingerprint {
  readonly op: string
  /**
   * `name` or `name@remote` → its commit id; a conflicted bookmark → its
   * targets, sorted and joined by ",".
   */
  readonly bookmarks: ReadonlyMap<string, string>
  readonly at: CommitId | null
}

/**
 * `all`: accepted work or a WIP moved, or this is the first observation.
 * `acceptedMoved`: accepted work's bookmark moved since an earlier
 * observation, which the base snapshot follows; never on the first, since
 * startup reads the base itself. `published`: the publish bookmark moved,
 * which changes only accepted work's record, since no offer depends on it.
 * `yours`: `@` moved, which changes only each record's `yourEdits` and
 * accepted work's preview. `lanes`: lanes' refs moved. `offers`: offer
 * bookmarks moved, by thread name.
 */
export interface Moved {
  readonly all: boolean
  readonly acceptedMoved: boolean
  readonly published: boolean
  readonly yours: boolean
  readonly lanes: ReadonlySet<ThreadId>
  readonly offers: ReadonlySet<ThreadName>
}

/** A lane's remote in your repo is `pinetrie-<lane>` (`laneTipName`). */
const laneOfRemote = (remote: string): ThreadId | null => {
  const lane = remote.slice(LANE_REMOTE_PREFIX.length)
  return remote.startsWith(LANE_REMOTE_PREFIX) && isThreadId(lane) ? lane : null
}

/** Whether a local bookmark is one an offer or accepted work's record depends on. */
const watchedLocal = (name: string, repoConfig: RepoConfig): boolean =>
  name === repoConfig.acceptedBookmark ||
  name === repoConfig.publish ||
  name.startsWith(repoConfig.wipPrefix) ||
  name.startsWith(OFFER_PREFIX)

/**
 * The one `jj log` the fingerprint is read from: the commits of accepted work,
 * the WIPs, the publish bookmark, the offers, the lanes' remote bookmarks,
 * and `@`; each with
 * whether it is `@`, and its local and remote bookmarks.
 */
export function fingerprintRead(repoConfig: RepoConfig): readonly string[] {
  const revset = [
    `present(${revsetName(repoConfig.acceptedBookmark)})`,
    `bookmarks(glob:${revsetName(`${repoConfig.wipPrefix}*`)})`,
    `present(${revsetName(repoConfig.publish)})`,
    OFFER_BOOKMARKS,
    `remote_bookmarks(remote=glob:${revsetName(`${LANE_REMOTE_PREFIX}*`)})`,
    "@",
  ].join(" | ")
  return [
    "log",
    "--no-graph",
    "-r",
    revset,
    "-T",
    'commit_id ++ "\\t" ++ if(current_working_copy, "@") ++ "\\t" ++ local_bookmarks.map(|b| b.name()).join(",") ++ "\\t" ++ remote_bookmarks.map(|b| b.name() ++ "@" ++ b.remote()).join(",") ++ "\\n"',
  ]
}

/** `fingerprintRead`'s output → the fingerprint, keeping only what is watched. */
export function parseFingerprint(
  op: string,
  stdout: string,
  repoConfig: RepoConfig,
): Fingerprint {
  const targets = new Map<string, string[]>()
  let at: CommitId | null = null
  const add = (name: string, commit: string) =>
    targets.set(name, [...(targets.get(name) ?? []), commit])
  for (const row of stdout.split("\n")) {
    if (row === "") continue
    const [commit = "", here = "", locals = "", remotes = ""] = row.split("\t")
    if (here === "@") at = commitId(commit)
    for (const name of locals.split(","))
      if (name !== "" && watchedLocal(name, repoConfig)) add(name, commit)
    for (const name of remotes.split(","))
      if (laneOfRemote(name.slice(name.lastIndexOf("@") + 1)) !== null)
        add(name, commit)
  }
  return {
    op,
    bookmarks: new Map(
      [...targets].map(([name, commits]) => [name, commits.sort().join(",")]),
    ),
    at,
  }
}

/** What moved from `prev` to `next`. A bookmark that appears, moves or goes counts as moved. */
export function planObserve(
  prev: Fingerprint | null,
  next: Fingerprint,
  repoConfig: RepoConfig,
): Moved {
  const lanes = new Set<ThreadId>()
  const offers = new Set<ThreadName>()
  let all = prev === null
  let published = false
  let acceptedMoved = false
  const names = new Set([
    ...(prev?.bookmarks.keys() ?? []),
    ...next.bookmarks.keys(),
  ])
  for (const name of names) {
    if (prev !== null && prev.bookmarks.get(name) === next.bookmarks.get(name))
      continue
    const at = name.lastIndexOf("@")
    if (at >= 0) {
      const lane = laneOfRemote(name.slice(at + 1))
      if (lane !== null) lanes.add(lane)
    } else if (name.startsWith(OFFER_PREFIX))
      offers.add(name.slice(OFFER_PREFIX.length) as ThreadName)
    else if (name === repoConfig.publish) published = true
    else if (watchedLocal(name, repoConfig)) {
      all = true
      if (name === repoConfig.acceptedBookmark && prev !== null)
        acceptedMoved = true
    }
  }
  return {
    all,
    acceptedMoved,
    published: published,
    yours: prev === null || prev.at !== next.at,
    lanes,
    offers,
  }
}
