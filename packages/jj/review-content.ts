// jj/review-content — what each file of a jj review holds, so a review tells
// content by its bytes in either kind of project. A file with lines is
// lines. One with no lines and no move is read from your repo: each side's
// first bytes say what it holds (`fileContent`), and its size comes from
// the revision's `bytes_delta()` where the stats carry one, else from a
// count of the side read whole. `planJjReviewContent` decides the reads, so
// at most one side is read whole where a delta is known.

import {
  FILE_CONTENT_WINDOW,
  type FileChange,
  type FileContent,
  fileContent,
  type MediaSide,
  type ReviewFile,
} from "@pinetrie/core"
import type { BytesStream } from "./run.ts"

/**
 * How a file's size is had, by which reader made its stats: a revision's
 * `bytes_delta()`, or a range's, whose template has no stat, a count.
 */
export type JjStatSize =
  | { readonly kind: "delta"; readonly bytes: number }
  | { readonly kind: "count" }

/** One file's stats, as a review's reader read them. */
export interface JjFileStat {
  readonly path: string
  readonly change: FileChange
  readonly added: number
  readonly removed: number
  readonly size: JjStatSize
}

/** Which side of a span a file is read at. */
type ReviewSide = "before" | "after"

/** One side of one file to read: its first bytes, or all of them, counted. */
export interface JjRead {
  readonly path: string
  readonly side: ReviewSide
  readonly whole: boolean
}

/** Whether a file's row is lines from its stats alone: it has lines, or it moved. */
const isLinesByStats = (s: JjFileStat): boolean =>
  s.added > 0 ||
  s.removed > 0 ||
  s.change === "renamed" ||
  s.change === "copied"

/**
 * The reads a review's content needs: none for a file with lines or a
 * move. An added file's after side and a removed one's before side, read
 * whole only for a count. A modified file's before side read whole, and
 * with a delta only its after side's first bytes; with a count both whole.
 */
export function planJjReviewContent(
  stats: readonly JjFileStat[],
): readonly JjRead[] {
  return stats.flatMap((s): JjRead[] => {
    if (isLinesByStats(s)) return []
    const count = s.size.kind === "count"
    switch (s.change) {
      case "added":
        return [{ path: s.path, side: "after", whole: count }]
      case "removed":
        return [{ path: s.path, side: "before", whole: count }]
      default:
        return [
          { path: s.path, side: "before", whole: true },
          { path: s.path, side: "after", whole: count },
        ]
    }
  })
}

/** A side as it was read: what its first bytes hold, and its size when it was read whole. */
export interface SideRead {
  readonly content: FileContent
  readonly size: number | null
}

/**
 * A file's content from its stats and its sides read (`planJjReviewContent`'s
 * reads, answered): lines where every side read is text, else media, each
 * size counted or had from the delta.
 */
export function jjReviewContent(
  stat: JjFileStat,
  read: (side: ReviewSide) => SideRead | undefined,
): ReviewFile["content"] {
  if (isLinesByStats(stat)) return { kind: "lines" }
  const before = stat.change === "added" ? undefined : read("before")
  const after = stat.change === "removed" ? undefined : read("after")
  if (
    (before === undefined || before.content === "text") &&
    (after === undefined || after.content === "text")
  )
    return { kind: "lines" }
  const delta = stat.size.kind === "delta" ? stat.size.bytes : null
  const sized = (
    side: SideRead | undefined,
    fromDelta: number | null,
  ): MediaSide | null =>
    side === undefined
      ? null
      : { content: side.content, size: side.size ?? fromDelta ?? 0 }
  const beforeSize =
    before?.size ?? (delta === null ? null : Math.max(0, -delta))
  return {
    kind: "media",
    before: sized(before, beforeSize),
    after: sized(
      after,
      delta === null
        ? null
        : stat.change === "added"
          ? delta
          : (before?.size ?? 0) + delta,
    ),
  }
}

/**
 * One side of a file read from your repo at `rev`: its first bytes, kept
 * for `fileContent`, and with `whole` every byte counted; else the read
 * stops once it has the window.
 */
export async function readJjSide(
  bytes: BytesStream,
  rev: string,
  path: string,
  whole: boolean,
): Promise<SideRead> {
  const head: Uint8Array[] = []
  let kept = 0
  let size = 0
  for await (const chunk of bytes([
    "file",
    "show",
    "-r",
    rev,
    `root-file:${JSON.stringify(path)}`,
  ])) {
    size += chunk.byteLength
    if (kept < FILE_CONTENT_WINDOW) {
      head.push(chunk.subarray(0, FILE_CONTENT_WINDOW - kept))
      kept = Math.min(FILE_CONTENT_WINDOW, kept + chunk.byteLength)
    }
    if (!whole && kept >= FILE_CONTENT_WINDOW) break
  }
  return {
    content: fileContent(Buffer.concat(head)),
    size: whole ? size : null,
  }
}

/**
 * A file's bytes at `rev`, as they come, with what its first bytes hold:
 * its window read before the answer is typed, then the rest streamed on.
 * Null when jj cannot show it (no file there).
 */
export async function jjFileBytes(
  bytes: BytesStream,
  rev: string,
  path: string,
): Promise<{
  readonly content: FileContent
  readonly bytes: AsyncIterable<Uint8Array>
} | null> {
  const stream = bytes([
    "file",
    "show",
    "-r",
    rev,
    `root-file:${JSON.stringify(path)}`,
  ])[Symbol.asyncIterator]()
  const head: Uint8Array[] = []
  let kept = 0
  let done = false
  try {
    while (kept < FILE_CONTENT_WINDOW) {
      const next = await stream.next()
      if (next.done === true) {
        done = true
        break
      }
      head.push(next.value)
      kept += next.value.byteLength
    }
  } catch {
    return null
  }
  async function* rest(): AsyncIterable<Uint8Array> {
    yield* head
    if (done) return
    for (let next = await stream.next(); next.done !== true; ) {
      yield next.value
      next = await stream.next()
    }
  }
  return { content: fileContent(Buffer.concat(head)), bytes: rest() }
}
