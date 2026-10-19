// lanes/session-files — the layout of a session's data directory: the store,
// the start's times, and what its lanes are given.

import path from "node:path"

/** What the host keeps for a session's lanes, on the host. */
export interface LaneFiles {
  /** The lane runtime, one directory per image tag. */
  readonly runtime: string
  /** The lanes' ignore file's directory (`laneIgnores`), mounted in every lane. */
  readonly laneGit: string
  /** What every lane's ssh is given, read-only (`@pinetrie/ssh`'s files). */
  readonly laneSsh: string
  /** The secret a lane's ssh token is made under. */
  readonly sshSecret: string
  /**
   * A folder project's stamps of its last read, which the next read is
   * planned from (`planRead`): written once that read's state is recorded.
   */
  readonly folderStamps: string
}

/** Every file the host keeps for a session: none of them in its project. */
export interface SessionFiles {
  /** The session's SQLite file, unless `PINETRIE_STORE` names another. */
  readonly store: string
  /** What each step of its last starts took (`start-checklist.ts`). */
  readonly startTimes: string
  readonly lanes: LaneFiles
}

/** A session's files, under its data directory (`sessions/<name>/`). */
export function sessionFiles(sessionData: string): SessionFiles {
  return {
    store: path.join(sessionData, "pinetrie.db"),
    startTimes: path.join(sessionData, "start-times.json"),
    lanes: {
      runtime: path.join(sessionData, "runtime"),
      laneGit: path.join(sessionData, "lane-git"),
      laneSsh: path.join(sessionData, "lane-ssh"),
      sshSecret: path.join(sessionData, "ssh-secret"),
      folderStamps: path.join(sessionData, "folder-stamps.json"),
    },
  }
}
