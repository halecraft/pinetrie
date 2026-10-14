// jj/lane/names — the names pine·trie gives in a lane's repo and in yours:
// each lane's bookmark, its history and stack as remote bookmarks in your
// repo, offers' bookmarks, and your repo's own names (`RepoConfig`).

import type { RepoConfig, ThreadId, ThreadName } from "@pinetrie/core"

/** The branch a commit fetched by id is put on, so jj sees it. */
export const FETCHED_REF = "refs/heads/pinetrie/fetched"
/** The bookmark that holds a lane's newest revision, in the lane's own repo. */
export const bookmarkName = (lane: ThreadId): string => `pinetrie/${lane}`

/** A revset string literal, so a bookmark name is never parsed as a revset. */
export const revsetName = (name: string): string => JSON.stringify(name)

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
 * A lane's offer in your repo. Not under `pinetrie/`, whose bookmarks were
 * immutable when offers began.
 */
export const OFFER_PREFIX = "pinetrie-offer/"
export const offerBookmark = (name: ThreadName): string =>
  `${OFFER_PREFIX}${name}`
/** Every offer's bookmark, as a revset. */
export const OFFER_BOOKMARKS = `bookmarks(glob:${revsetName(`${OFFER_PREFIX}*`)})`

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
