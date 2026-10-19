// interface/review — what a column's review of its proposed changes draws: each
// revision's title, body and files, what each file's section shows, and a
// diff's lines by kind. `review-pane.tsx` draws it; `use-fetched.ts` reads.

import {
  type ConfigWidening,
  type DiffSpan,
  type FileChange,
  isImageMime,
  type MediaSide,
  type ReviewFile,
  type RevisionReview,
  spanKey,
  wideningWords,
  withoutTrailers,
} from "@pinetrie/core"
import { fileUrl } from "@pinetrie/rules"
import type { ReviewTarget } from "./column-view.ts"
import { byteWords } from "./counts.ts"

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
const COLLAPSE_OVER = 400
/** A section draws at most this many lines of its diff. */
export const DIFF_LINES_SHOWN = 5000

/** One side of a media row: the file's URL at that side, and its size in words. */
export interface MediaShown {
  readonly url: string
  readonly size: string
}

/**
 * A file shown as a file, not as lines: an image drawn on each side, or
 * another file's sizes and links to open each side. A side the file is
 * absent at is null.
 */
export interface MediaRow {
  readonly kind: "image" | "file"
  readonly before: MediaShown | null
  readonly after: MediaShown | null
}

export interface FileRow {
  /** `<span>:<path>` (`spanKey`): a stack can change one path in two revisions. */
  readonly key: string
  readonly span: DiffSpan
  readonly path: string
  readonly shown: string
  readonly letter: "A" | "M" | "D" | "C" | "R"
  /** "+12 −3", each part only when not 0; "" when both are. */
  readonly lines: string
  /** Lines added and removed, together. */
  readonly changed: number
  readonly conflicts: boolean
  /** `@` changes it too: you are editing it in your working copy. */
  readonly editing: boolean
  /** More than `COLLAPSE_OVER` changed lines: it waits to be opened. */
  readonly startsCollapsed: boolean
  /** The placeholder's height, in diff lines, before the diff loads. */
  readonly estimate: number
  /** Shown as media, with no diff section; null for lines. */
  readonly media: MediaRow | null
  /** A move with no change to its content: "moved, unchanged", no diff section. */
  readonly moved: boolean
}

/** What a renamed row with no lines says in place of a diff. */
export const MOVED_UNCHANGED = "moved, unchanged"

/**
 * A file's sides as a media row, each side's URL its span's (`fileUrl`).
 * None for a move or a copy: its before is at another path, which its row
 * does not name, and a move is shown as one ("moved, unchanged").
 */
function mediaRow(span: DiffSpan, f: ReviewFile): MediaRow | null {
  if (
    f.content.kind === "lines" ||
    f.change === "renamed" ||
    f.change === "copied"
  )
    return null
  const { before, after } = f.content
  const side = (s: MediaSide | null, which: "before" | "after") =>
    s === null
      ? null
      : { url: fileUrl(span, f.path, which), size: byteWords(s.size) }
  const isImage = (s: MediaSide | null) => s === null || isImageMime(s.content)
  return {
    kind: isImage(before) && isImage(after) ? "image" : "file",
    before: side(before, "before"),
    after: side(after, "after"),
  }
}

interface RevisionShown {
  readonly title: string
  /** The description after its first line, the host's trailers removed; "" when none. */
  readonly body: string
  /** What its `pinetrie.json` would let lanes do once accepted (`wideningLine`); "" when nothing. */
  readonly widens: string
  readonly files: readonly FileRow[]
}

interface ReviewView {
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
  /** Bottom first, one per span of the target. */
  readonly revisions: readonly {
    readonly span: DiffSpan
    /** `spanKey`'s. */
    readonly key: string
    readonly state: Loaded<RevisionShown>
  }[]
}

/** A revision the review reads: while it reads, or why it could not. */
export const revisionReadWords = (failed: string | null): string =>
  failed === null
    ? "reading this revision…"
    : `could not read this revision: ${failed}`

/** What a revision's `pinetrie.json` would let every lane do once accepted, in one line; "" for nothing. */
export const wideningLine = (widenings: readonly ConfigWidening[]): string =>
  widenings.length === 0
    ? ""
    : `Accepting this lets threads use ${widenings.map(wideningWords).join(", ")}.`

const LETTER: Record<FileChange, FileRow["letter"]> = {
  added: "A",
  modified: "M",
  removed: "D",
  copied: "C",
  renamed: "R",
}

/**
 * The review's rows from each span's fetched review, in the target's
 * order. A file is flagged by path from the proposed changes' record.
 */
export function reviewView(
  target: ReviewTarget,
  revisions: readonly Loaded<RevisionReview>[],
): ReviewView {
  const conflicts = new Set(target.conflicts)
  const editing = new Set(target.workingCopyEdits)
  const shown: ReviewView["revisions"] = target.spans.map((span, i) => {
    const key = spanKey(span)
    const got = revisions[i] ?? { kind: "loading" }
    if (got.kind !== "ready") return { span, key, state: got }
    const text = withoutTrailers(got.value.description)
    const cut = text.indexOf("\n")
    const files = got.value.files.map(f => {
      const changed = f.added + f.removed
      return {
        key: `${key}:${f.path}`,
        span,
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
        editing: editing.has(f.path),
        startsCollapsed: changed > COLLAPSE_OVER,
        estimate: Math.min(
          DIFF_LINES_SHOWN,
          changed + 4 + 6 * Math.ceil(changed / 20),
        ),
        media: mediaRow(span, f),
        moved: f.change === "renamed" && changed === 0,
      }
    })
    return {
      span,
      key,
      state: {
        kind: "ready",
        value: {
          title:
            (cut < 0 ? text : text.slice(0, cut)) ||
            target.title ||
            "(no summary)",
          body: cut < 0 ? "" : text.slice(cut + 1).trim(),
          widens: wideningLine(got.value.widenings),
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

type SectionState =
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

interface DiffLine {
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

/**
 * How you read a review, your reader's settings: kept per device, the same in
 * every column's review.
 */
export interface ReviewPrefs {
  /** Long diff lines wrap, rather than scrolling sideways. */
  readonly wrap: boolean
  /** The file list is folded away, giving the diffs the pane's width. */
  readonly listFolded: boolean
}

/** A review head's toggle: one of `ReviewPrefs`. */
export type ReviewPref = keyof ReviewPrefs

/** A review toggle's glyph and label, by what it does from `on`. */
export function reviewPrefWords(
  pref: ReviewPref,
  on: boolean,
): { readonly glyph: string; readonly label: string } {
  switch (pref) {
    case "wrap":
      return {
        glyph: "↩",
        label: on ? "stop wrapping long lines" : "wrap long lines",
      }
    case "listFolded":
      return {
        glyph: "☰",
        label: on ? "show the file list" : "hide the file list",
      }
  }
}
