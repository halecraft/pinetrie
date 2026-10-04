// repo/observe — what an outside change moved in your repo, as values: the
// fingerprint read at one operation (`fingerprintRead`, `parseFingerprint`),
// and what moved between two (`planObserve`). Pure; the owner reads and acts.

import type { ThreadName } from "@pineta/core"
import {
  type CommitId,
  commitId,
  isLaneName,
  type LaneName,
} from "@pineta/core"
import { type LineConfig, offerBookmark, revsetName } from "@pineta/lanes"

/**
 * What an outside change can move: the line, the WIPs, the publish bookmark,
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
 * `all`: the line or a WIP moved, or this is the first observation. `line`:
 * the publish bookmark moved, which changes only the line's record, since no
 * offer depends on it (ADR-0076). `yours`: `@` moved, which changes only each
 * record's `yourEdits` and the line's preview. `lanes`: lanes' refs moved.
 * `offers`: offer bookmarks moved, by thread name.
 */
export interface Moved {
  readonly all: boolean
  readonly line: boolean
  readonly yours: boolean
  readonly lanes: ReadonlySet<LaneName>
  readonly offers: ReadonlySet<ThreadName>
}

const OFFER_PREFIX = offerBookmark("" as ThreadName)
const LANE_REMOTE = "pineta-"

/** A lane's remote in your repo is `pineta-<lane>` (`laneTipName`). */
const laneOfRemote = (remote: string): LaneName | null => {
  const lane = remote.slice(LANE_REMOTE.length)
  return remote.startsWith(LANE_REMOTE) && isLaneName(lane) ? lane : null
}

/** Whether a local bookmark is one an offer or the line's record depends on. */
const watchedLocal = (name: string, line: LineConfig): boolean =>
  name === line.onto ||
  name === line.publish ||
  name.startsWith(line.wipPrefix) ||
  name.startsWith(OFFER_PREFIX)

/**
 * The one `jj log` the fingerprint is read from: the commits of the line,
 * the WIPs, the publish bookmark, the offers, the lanes' remote bookmarks,
 * and `@`; each with
 * whether it is `@`, and its local and remote bookmarks.
 */
export function fingerprintRead(line: LineConfig): readonly string[] {
  const revset = [
    `present(${revsetName(line.onto)})`,
    `bookmarks(glob:${revsetName(`${line.wipPrefix}*`)})`,
    `present(${revsetName(line.publish)})`,
    `bookmarks(glob:${revsetName(`${OFFER_PREFIX}*`)})`,
    `remote_bookmarks(remote=glob:${revsetName(`${LANE_REMOTE}*`)})`,
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
  line: LineConfig,
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
      if (name !== "" && watchedLocal(name, line)) add(name, commit)
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

/** Pure: what moved from `prev` to `next`. A bookmark that appears, moves or goes counts as moved. */
export function planObserve(
  prev: Fingerprint | null,
  next: Fingerprint,
  line: LineConfig,
): Moved {
  const lanes = new Set<LaneName>()
  const offers = new Set<ThreadName>()
  let all = prev === null
  let published = false
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
    else if (name === line.publish) published = true
    else if (watchedLocal(name, line)) all = true
  }
  return {
    all,
    line: published,
    yours: prev === null || prev.at !== next.at,
    lanes,
    offers,
  }
}
