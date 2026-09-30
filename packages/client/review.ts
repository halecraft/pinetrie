// client/review — what a column's review of its offer draws, pure (ADR-0047):
// each revision's title, body and files, what each file's section shows, and
// a diff's lines by kind. `review-pane.tsx` draws it; `use-fetched.ts` reads.

import type { CommitId, FileChange, RevisionReview } from "@pineta/core"
import { withoutTrailers } from "@pineta/marginalia"
import type { ReviewTarget } from "./column-view.ts"

/** A fetch's state. */
export type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | {
      readonly kind: "failed"
      readonly status: number
      readonly reason: string
    }

/** A file changing more lines than this waits to be opened. */
export const COLLAPSE_OVER = 400
/** A section draws at most this many lines of its diff. */
export const DIFF_LINES_SHOWN = 5000

export interface FileRow {
  /** `<commit>:<path>`: a stack can change one path in two revisions. */
  readonly key: string
  readonly commit: CommitId
  readonly path: string
  readonly shown: string
  readonly letter: "A" | "M" | "D" | "C" | "R"
  /** "+12 −3", each part only when not 0; "" when both are. */
  readonly lines: string
  /** Lines added and removed, together. */
  readonly changed: number
  readonly conflicts: boolean
  readonly yours: boolean
  /** More than `COLLAPSE_OVER` changed lines: it waits to be opened. */
  readonly startsCollapsed: boolean
  /** The placeholder's height, in diff lines, before the diff loads. */
  readonly estimate: number
}

export interface RevisionShown {
  readonly title: string
  /** The description after its first line, the host's trailers removed; "" when none. */
  readonly body: string
  readonly files: readonly FileRow[]
}

export interface ReviewView {
  /**
   * Whether the file list shows: not for one revision of at most one file,
   * nor while that one revision is unread.
   */
  readonly listed: boolean
  /**
   * The one revision's title, for the review's head; undefined for a stack,
   * whose list heads each revision's files with its title instead.
   */
  readonly title: string | undefined
  /** Bottom first, one per commit of the target. */
  readonly revisions: readonly {
    readonly commit: CommitId
    readonly state: Loaded<RevisionShown>
  }[]
}

const LETTER: Record<FileChange, FileRow["letter"]> = {
  added: "A",
  modified: "M",
  removed: "D",
  copied: "C",
  renamed: "R",
}

/**
 * The review's rows from each commit's fetched review, in the target's
 * order. A file is flagged by path from the offer's record.
 */
export function reviewView(
  target: ReviewTarget,
  revisions: readonly Loaded<RevisionReview>[],
): ReviewView {
  const conflicts = new Set(target.conflicts)
  const yours = new Set(target.yourEdits)
  const shown: ReviewView["revisions"] = target.commits.map((commit, i) => {
    const got = revisions[i] ?? { kind: "loading" }
    if (got.kind !== "ready") return { commit, state: got }
    const text = withoutTrailers(got.value.description)
    const cut = text.indexOf("\n")
    const files = got.value.files.map(f => {
      const changed = f.added + f.removed
      return {
        key: `${commit}:${f.path}`,
        commit,
        path: f.path,
        shown: f.shown,
        letter: LETTER[f.change],
        lines: [
          f.added > 0 ? `+${f.added}` : "",
          f.removed > 0 ? `−${f.removed}` : "",
        ]
          .filter(s => s !== "")
          .join(" "),
        changed,
        conflicts: conflicts.has(f.path),
        yours: yours.has(f.path),
        startsCollapsed: changed > COLLAPSE_OVER,
        estimate: Math.min(
          DIFF_LINES_SHOWN,
          changed + 4 + 6 * Math.ceil(changed / 20),
        ),
      }
    })
    return {
      commit,
      state: {
        kind: "ready",
        value: {
          title: (cut < 0 ? text : text.slice(0, cut)) || "(no description)",
          body: cut < 0 ? "" : text.slice(cut + 1).trim(),
          files,
        },
      },
    }
  })
  const only = shown.length === 1 ? shown[0]?.state : undefined
  return {
    listed:
      only === undefined ||
      (only.kind === "ready" && only.value.files.length > 1),
    title: only?.kind === "ready" ? only.value.title : undefined,
    revisions: shown,
  }
}

export type SectionState =
  | "waiting"
  | "loading"
  | "shown"
  | "collapsed"
  | "too-large"
  | "failed"

/**
 * A file section's state: collapsed while your toggle says so (a big file
 * starts collapsed, and a toggle opens it); otherwise waiting until it comes
 * near the view, then its diff's fetch.
 */
export function sectionState(
  startsCollapsed: boolean,
  toggled: boolean,
  wanted: boolean,
  diff: Loaded<string> | null,
): SectionState {
  if (startsCollapsed !== toggled) return "collapsed"
  if (!wanted) return "waiting"
  if (diff === null || diff.kind === "loading") return "loading"
  if (diff.kind === "ready") return "shown"
  return diff.status === 413 ? "too-large" : "failed"
}

export interface DiffLine {
  readonly kind: "meta" | "hunk" | "add" | "del" | "same"
  readonly text: string
}

/**
 * A git diff's lines, by kind. Before a file's first `@@`, every line is meta:
 * `--- a/x` and `+++ b/x` are headers, not a removed and an added line.
 */
export function diffLines(text: string): readonly DiffLine[] {
  const all = text.endsWith("\n") ? text.slice(0, -1) : text
  if (all === "") return []
  let header = true
  return all.split("\n").map((line): DiffLine => {
    if (line.startsWith("diff --git ")) header = true
    if (line.startsWith("@@")) {
      header = false
      return { kind: "hunk", text: line }
    }
    if (header || line.startsWith("\\")) return { kind: "meta", text: line }
    if (line.startsWith("+")) return { kind: "add", text: line }
    if (line.startsWith("-")) return { kind: "del", text: line }
    return { kind: "same", text: line }
  })
}
