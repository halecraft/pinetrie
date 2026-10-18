// core/revisions — the files at an entry (`RevisionRecord`), a lane's proposed
// changes as recorded for each kind of project, and a review of them.

import type { CommitId, PointId } from "./bases.ts"
import type { SnapshotId, TurnDisk } from "./disks.ts"
import type { FileContent } from "./folder.ts"
import type { EntryId, ThreadId } from "./ids.ts"
import type { ProposedLedger } from "./proposed.ts"
import type { ConfigWidening } from "./runs.ts"

/**
 * The files at an entry: a host-written `pinetrie.revision` value keyed by the
 * entry's id. Every run's prompt has one, and so does every assistant message
 * of a lane of its own that made tool calls. So the nearest record above any
 * entry names its lane, its commit and its disk (`nearestRevision`).
 */
export interface RevisionRecord {
  readonly entry: EntryId
  readonly lane: ThreadId
  /** The turn's state; null when nothing tracked changed, or the lane has no copy of its own. */
  readonly point: PointId | null
  /**
   * The lane's whole disk at this entry; null for a lane with no copy of its
   * own, and in records written before lane containers.
   */
  readonly snapshot: SnapshotId | null
  /**
   * The paths the turn changed, from the project's root; none for a prompt's
   * record or a turn with no state of its own.
   */
  readonly paths: readonly string[]
  /** The files conflicted at `point`: what a branch from here starts with. */
  readonly conflicts: readonly string[]
  /**
   * What the turn did to its disk beyond its state. Null for a prompt's
   * record, a lane with no copy of its own, an update, and records written
   * before.
   */
  readonly disk: TurnDisk | null
}

/**
 * A lane's proposed changes: the lane's work you do not have yet. A
 * host-written `pinetrie.proposed` value keyed by lane: the page's cache, of
 * the project's kind. The host never decides from it, so a record lost or stale
 * changes nothing; at start it deletes those of the other kind.
 */
export type ProposedChangesRecord =
  | JjProposedChangesRecord
  | FolderProposedChangesRecord

/**
 * A jj project's proposed changes: one revision, or a stack, in your repo.
 * Written from the repo after each of the host's steps
 * (`proposedChangesRecord`, `@pinetrie/rules`); the host reads the proposed
 * changes from your repo (`ProposedChangesInRepo`). What accepting it would
 * bring, each revision's description, files and diffs, is not stored: the page
 * reads it by commit when it asks (`RevisionReview`).
 */
export interface JjProposedChangesRecord {
  readonly kind: "jj"
  readonly lane: ThreadId
  /** Its revisions: 1 for single proposed changes, more for a stack. */
  readonly size: number
  /** The lane turned since the stack was made: it no longer holds all of it. */
  readonly stale: boolean
  /** None when accepted work already holds its work (`proposedChangesStatus`'s `held`). */
  readonly files: readonly string[]
  /** Files that conflict with your committed work. */
  readonly conflicts: readonly string[]
  /**
   * The files conflicted where it starts, read only when it conflicts: those of
   * `conflicts` among them came with the lane's copy (`conflictCause`).
   */
  readonly startConflicts: readonly string[]
  /** Files it touches that you are editing in `@`. */
  readonly workingCopyEdits: readonly string[]
  /** An agent wrote its description; false while it carries the placeholder. */
  readonly described: boolean
  /** You edited it since the host last wrote it: the host leaves it alone. */
  readonly edited: boolean
  /** Its bookmark in your repo, as jjui shows it. */
  readonly bookmark: string
  /**
   * The change id its top became when you accepted it; null while it is open.
   */
  readonly acceptedAs: string | null
  /**
   * Each revision's commit as the host last read it, bottom first: what a
   * review may read. It follows a rebase jj made under the proposed changes,
   * and your edits.
   */
  readonly commits: readonly CommitId[]
  /**
   * What it brings, as its top's message says (`proposedLedger`): the lane tip
   * it holds and where it starts. An acceptance names it
   * (`ProposedChangesSeen`). Null for proposed changes whose message carry
   * none, and for a record written before the field, until the owner's first
   * observation writes it again.
   */
  readonly ledger: ProposedLedger | null
  readonly at: number
}

/**
 * A folder project's proposed changes: the lane's newest state against accepted
 * work's newest, its files those whose content differs. The page reviews it as
 * the range `start..tip`.
 */
export interface FolderProposedChangesRecord {
  readonly kind: "folder"
  readonly lane: ThreadId
  /** Accepted work's newest state, which the proposed changes are computed against. */
  readonly start: PointId
  /** The lane's newest state. */
  readonly tip: PointId
  /** None when accepted work already holds its work. */
  readonly files: readonly string[]
  /** The lane's open conflicts among them. */
  readonly conflicts: readonly string[]
  /** An agent's description of it; null until one is written. */
  readonly description: string | null
  readonly at: number
}

/**
 * Where proposed changes' conflict comes from (`conflictCause`): the lane's
 * work against its target, or the copy it was cloned with, every conflicted
 * file already conflicted where it starts.
 */
export type ConflictCause = "work" | "start"

/** How jj says a file changed in a revision. */
export type FileChange = "added" | "modified" | "removed" | "copied" | "renamed"

/** One side of a file a review shows as a file, not as lines: what it holds, and its size in bytes. */
export interface MediaSide {
  readonly content: FileContent
  readonly size: number
}

/** One file of a review, in either kind of project: its change, and how its content is shown. */
export interface ReviewFile {
  readonly path: string
  /** The display path: `{old => new}` for a rename or copy, else `path`. */
  readonly shown: string
  readonly change: FileChange
  /** Lines added and removed; 0 and 0 for a binary file or a pure rename. */
  readonly added: number
  readonly removed: number
  /**
   * Lines, shown as a diff; or media, each side a file to show whole (an
   * image) or to open, null where the file is absent.
   */
  readonly content:
    | { readonly kind: "lines" }
    | {
        readonly kind: "media"
        readonly before: MediaSide | null
        readonly after: MediaSide | null
      }
}

/**
 * One revision of proposed changes, as its commit holds it. A commit id names
 * its content, so this never changes for a commit.
 */
export interface RevisionReview {
  /** Its description, the host's trailers included. */
  readonly description: string
  readonly files: readonly ReviewFile[]
  /**
   * What its change to `pinetrie.json` would let lanes do or share once
   * accepted; none when it leaves the file, or only narrows it.
   */
  readonly widenings: readonly ConfigWidening[]
}

/**
 * What a review reads: one revision of proposed changes, the diff from its
 * parent to it, or a range, the diff from one state of a lane to another, such
 * as an ask's work across its turns. Each id names its content, so a review of
 * either never changes.
 */
export type DiffSpan =
  | { readonly kind: "revision"; readonly commit: CommitId }
  | {
      readonly kind: "range"
      readonly from: PointId
      readonly to: PointId
    }

/** A span as one string, for a key or a URL: `<commit>`, or `<from>..<to>`. */
export const spanKey = (s: DiffSpan): string =>
  s.kind === "revision" ? s.commit : `${s.from}..${s.to}`
