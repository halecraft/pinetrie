// core/refusals — what the host may refuse a command with (`ERR`), and a
// refusal as a value. Here, not beside the commands, because packages that
// send no command refuse with these codes too.

/** Error codes the host may return. Kept here so both sides agree without I/O. */
export const ERR = {
  UNKNOWN_KIND: "unknown-kind",
  EMPTY_MESSAGE: "empty-message",
  /** pi refused the target: it is not in this conversation. */
  UNKNOWN_TARGET: "unknown-target",
  /** pi refused for a reason with no more specific code here. */
  REFUSED: "refused",
  /** A run on a host with no model: the setup page says why. */
  NO_MODEL: "no-model",
  /**
   * The root is no entry: a `reply` or `queue` has nothing to continue.
   * Only a `branch` starts a thread at it.
   */
  NO_ANCHOR: "no-anchor",
  /** A display name is empty or too long. */
  INVALID_NAME: "invalid-name",
  /**
   * A write in a canvas in the archive, or a move out of one: restore the canvas
   * first. The message names who moved it there.
   */
  CANVAS_ARCHIVED: "canvas-archived",
  /** Moving a canvas into the archive while an agent of its works or cards are queued. */
  CANVAS_BUSY: "canvas-busy",
  /** A workflow state the session's workflow does not hold. */
  UNKNOWN_STATE: "unknown-state",
  /** Removing a workflow state that still holds a canvas. */
  STATE_NOT_EMPTY: "state-not-empty",
  /** Moving, removing or marking the archive. */
  STATE_ARCHIVE: "state-archive",
  /**
   * Removing the state marked Topics, where a new canvas starts, or marking a
   * state that holds the other mark.
   */
  STATE_MARKED: "state-marked",
  /** A workflow state named with nothing but spaces. */
  EMPTY_NAME: "empty-name",
  /** A lane pi holds an operation open on: after a crash, until it resumes. */
  BUSY: "busy",
  /** Landing a lane that has no copy of its own: a host without tools made it. */
  NOT_OWN_COPY: "not-own-copy",
  /** An action on proposed changes, on a lane with none in your repo. */
  NO_PROPOSED_CHANGES: "no-proposed-changes",
  /**
   * An accept into the project's folder that found a path it writes changed
   * while it wrote: everything it wrote is put back.
   */
  FOLDER_MOVED: "folder-moved",
  /**
   * An accept whose proposed changes hold a path the project's folder cannot
   * hold (a name another there folds to, one not UTF-8, a symlink out of it,
   * a device): refused before anything is written.
   */
  FOLDER_CANNOT_HOLD: "folder-cannot-hold",
  /** A restore of a state of accepted work whose snapshot the host no longer keeps. */
  STATE_NOT_KEPT: "state-not-kept",
  /** A restore of a state the project's folder holds already. */
  NOTHING_TO_RESTORE: "nothing-to-restore",
  /** A conflict's version chosen while the thread's agent runs. */
  THREAD_RUNNING: "thread-running",
  /** A conflict's version chosen at a path with no open conflict: closed already. */
  NO_CONFLICT: "no-conflict",
  /** Squashing a folder project's proposed changes, which is its files, never a stack. */
  NOT_A_STACK: "not-a-stack",
  /** A `/package:name` command that names no command there is. */
  UNKNOWN_COMMAND: "unknown-command",
  /** A peer whose principal is not an email: nobody the host can name. */
  INVALID_IDENTITY: "invalid-identity",
  /** A message shares, or a picture names, a `/blob/` the host does not store. */
  IMAGE_MISSING: "image-missing",
  /** A blob put in a media column that the store sorted as text or opaque. */
  NOT_AN_IMAGE: "not-an-image",
  /** A picture pi cannot decode or fit within `PICTURE_MOST`. */
  PICTURE_UNREADABLE: "picture-unreadable",
  /** A title with a line break, or longer than `MAX_TITLE`. */
  INVALID_TITLE: "invalid-title",
  /** A new thread's lane id that names a lane pi already holds. */
  LANE_ID_IN_USE: "lane-id-in-use",
  /** A branch naming a thread that has started already. */
  THREAD_TAKEN: "thread-taken",
  /** A new canvas's id that names a canvas the session already holds. */
  CANVAS_ID_IN_USE: "canvas-id-in-use",
  /** A new root's id that names a root the session already holds. */
  ROOT_ID_IN_USE: "root-id-in-use",
  /** Proposed changes accepted, or a publish, before accepted work is set up. */
  NOT_SET_UP: "not-set-up",
  /** Publishing in a repo with no publish bookmark. */
  NO_PUBLISH: "no-publish",
  /** Publishing while the publish bookmark has commits accepted work lacks. */
  NOT_FAST_FORWARD: "not-fast-forward",
  /** Publishing while the working copy has conflicts, or catching it up would make some. */
  WORKING_COPY_CONFLICT: "working-copy-conflict",
  /** An acceptance into a bookmark that is not one of the proposed changes' destinations now. */
  BAD_DESTINATION: "bad-destination",
  /** A new thread's base that is not a WIP bookmark above accepted work. */
  BAD_BASE: "bad-base",
  /** Bringing a thread up to date with a WIP bookmark that is gone. */
  BASE_GONE: "base-gone",
  /** Catching up with the thread it branched from, for a thread that began at its base. */
  NO_PARENT: "no-parent",
  /** Catching up with the thread it branched from while that thread's agent runs. */
  PARENT_RUNNING: "parent-running",
  /**
   * An acceptance that now brings other work than the one it was shown (another
   * ledger), or now conflicts where it did not.
   */
  NOT_AS_SHOWN: "not-as-shown",
  /** An answer to a lane's use of an ssh identity, from someone not its owner. */
  NOT_OWNER: "not-owner",
  /** An answer the lane's access does not take now: nothing waits, or it is already so. */
  NOTHING_TO_ANSWER: "nothing-to-answer",
  /**
   * A run, a catch-up or an action on proposed changes on a lane whose history
   * are not the project's kind: it was made before the project changed kind.
   */
  FOREIGN_LANE: "foreign-lane",
} as const

export type ErrCode = (typeof ERR)[keyof typeof ERR]

/**
 * A command refused, and why. Planners return it, the codec decodes to it, and
 * the host answers it as its outcome unchanged.
 */
export interface Refusal {
  readonly kind: "refused"
  readonly code: ErrCode
  readonly message: string
}

export const refused = (code: ErrCode, message: string): Refusal => ({
  kind: "refused",
  code,
  message,
})
