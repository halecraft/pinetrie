// jj/lane/names — the names pine·trie gives in a lane's repo and in yours:
// each lane's bookmark, its history and stack as remote bookmarks in your
// repo, the proposed bookmarks, and your repo's own names (`RepoConfig`).

import type { RepoConfig, ThreadId, ThreadName } from "@pinetrie/core"

/** The branch a commit fetched by id is put on, so jj sees it. */
export const FETCHED_REF = "refs/heads/pinetrie/fetched"
/** The bookmark that holds a lane's newest revision, in the lane's own repo. */
export const bookmarkName = (lane: ThreadId): string => `pinetrie/${lane}`

/** A revset string literal, so a bookmark name is never parsed as a revset. */
export const revsetName = (name: string): string => JSON.stringify(name)

/**
 * `commits` as one revset, each `present()` so one this repo lacks names
 * nothing; `none()` for none. A long one belongs in an alias (`revsetAliased`):
 * jj parses a union of hundreds of commits for longer than it reads.
 */
export const presentUnion = (commits: readonly string[]): string =>
  commits.length === 0
    ? "none()"
    : `(${commits.map(c => `present(${c})`).join(" | ")})`

/** The alias a read gives the sources of accepted proposed changes it names. */
export const SOURCES_ALIAS = "pinetrie_sources"

/**
 * A revset and the aliases it names, kept together: the revset alone fails
 * on the names it does not define.
 */
export interface RevsetQuery {
  readonly revset: string
  readonly aliases: Readonly<Record<string, string>>
}

/**
 * `args` with one `--config revset-aliases.<name>=<value>` per alias, after
 * them: a long union of commits parses slowly inline and as an alias quickly,
 * and a log line cut short still shows the command. The value is a TOML basic
 * string, which `JSON.stringify` writes.
 */
export function revsetAliased(
  args: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string[] {
  return [
    ...args,
    ...Object.entries(aliases).flatMap(([name, value]) => [
      "--config",
      `revset-aliases.${name}=${JSON.stringify(value)}`,
    ]),
  ]
}

/** The revset of one bookmark, its name quoted so it is never parsed as a revset. */
export const bookmarkRevset = (name: string): string =>
  `bookmarks(exact:${revsetName(name)})`

/**
 * A lane's history in your repo: a remote bookmark, `tip@pinetrie-<lane>`,
 * which jj keeps out of your default log and immutable with its builtin
 * config, ancestors included. No git remote is added.
 */
export const LANE_REMOTE_PREFIX = "pinetrie-"
const laneRemote = (lane: ThreadId): string => `${LANE_REMOTE_PREFIX}${lane}`
/** Where git keeps a lane's history in your repo: `laneTipName`'s ref. */
export const laneTipRef = (lane: ThreadId): string =>
  `refs/remotes/${laneRemote(lane)}/tip`
export const laneTipName = (lane: ThreadId): string => `tip@${laneRemote(lane)}`

/**
 * A split's stack: the bookmark its run leaves in the lane's own
 * repo, and the remote bookmark it arrives as in yours.
 */
export const stackBookmark = (lane: ThreadId): string =>
  `pinetrie/${lane}-stack`
/** Where git keeps a split's stack in your repo: `laneStackName`'s ref. */
export const laneStackRef = (lane: ThreadId): string =>
  `refs/remotes/${laneRemote(lane)}/stack`
export const laneStackName = (lane: ThreadId): string =>
  `stack@${laneRemote(lane)}`

/**
 * Where an archived lane's refs are parked, so git keeps its history until a
 * restore: jj imports nothing under `refs/pinetrie/`, and git keeps what any
 * ref names.
 */
export const laneParkedRef = (lane: ThreadId): string =>
  `refs/pinetrie/archived/${lane}`

/**
 * The remote the host keeps its version of each proposed changes under, as a
 * tracked remote bookmark. No git remote is added, so nothing fetches from it
 * or pushes to it. It starts with `LANE_REMOTE_PREFIX`, and is no lane's.
 */
export const HOST_REMOTE = "pinetrie-host"
/** Where git keeps the host's version of the proposed changes under `bookmark`. */
export const hostProposedRef = (bookmark: string): string =>
  `refs/remotes/${HOST_REMOTE}/${bookmark}`
/** The host's version of the proposed changes under `bookmark`, as a revset: empty when there is none. */
export const hostProposedRevset = (bookmark: string): string =>
  `remote_bookmarks(exact:${revsetName(bookmark)}, remote=exact:${revsetName(HOST_REMOTE)})`

/**
 * A lane's proposed changes in your repo. Not under `pinetrie/`, whose
 * bookmarks were immutable when proposed bookmarks began.
 */
export const PROPOSED_PREFIX = "pinetrie-proposed/"
export const proposedBookmark = (name: ThreadName): string =>
  `${PROPOSED_PREFIX}${name}`
/** Every proposed changes' bookmark, as a revset. */
export const PROPOSED_BOOKMARKS = `bookmarks(glob:${revsetName(`${PROPOSED_PREFIX}*`)})`

export const DEFAULT_REPO: RepoConfig = {
  acceptedBookmark: "pinetrie-accepted",
  wipPrefix: "wip/",
  publish: "main",
  publishCatchesUp: false,
}

/**
 * Whether `name` is usable as a bookmark, by git's ref-name rules, which a
 * colocated repo's bookmarks must meet: no space or control character, none
 * of `~^:?*[\\@{`, no `..`, no `//`, not starting with `-` or `/`, not ending
 * with `/`, `.` or `.lock`.
 */
export const isBookmarkName = (name: string): boolean =>
  name !== "" &&
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the rule is about them
  !/[\x00-\x20\x7f~^:?*[\\@{]/.test(name) &&
  !name.includes("..") &&
  !name.includes("//") &&
  !name.startsWith("-") &&
  !name.startsWith("/") &&
  !name.endsWith("/") &&
  !name.endsWith(".") &&
  !name.endsWith(".lock")
