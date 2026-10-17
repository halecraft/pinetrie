// folder/review — a review of two folder states decided as a value: each
// changed path's row, its content shown as lines or as media from what each
// side holds, and a path gone and one added with equal bytes paired as one
// move. The host gathers the facts (`readFolderReview`); nothing here reads.

import type {
  DiffStat,
  FileChange,
  MediaSide,
  PathFact,
  PathPair,
  ReviewFile,
  RevisionReview,
} from "@pinetrie/core"

/** A changed file's path and size on the side that holds it. */
export interface SizedPath {
  readonly path: string
  readonly size: number
}

/**
 * Each path gone paired with each path added of the same size: the only
 * pairs whose bytes can be equal, so the only ones worth reading.
 */
export function renameCandidates(
  gone: readonly SizedPath[],
  added: readonly SizedPath[],
): readonly PathPair[] {
  return gone.flatMap(g =>
    added.filter(a => a.size === g.size).map(a => ({ a: g.path, b: a.path })),
  )
}

/**
 * The moves: each candidate whose bytes are equal (`equal`, as the disks
 * answered) and whose path gone and path added each have exactly that one
 * equal partner. Two copies of one file, or one file copied twice, pair
 * with nothing: a guess is never shown as a fact.
 */
export function pairRenames(
  candidates: readonly PathPair[],
  equal: readonly PathPair[],
): readonly PathPair[] {
  const isCandidate = (p: PathPair) =>
    candidates.some(c => c.a === p.a && c.b === p.b)
  const found = equal.filter(isCandidate)
  const count = (key: "a" | "b", path: string) =>
    found.filter(p => p[key] === path).length
  return found.filter(p => count("a", p.a) === 1 && count("b", p.b) === 1)
}

/** A move's display path, as jj writes one: `dir/{old => new}` under their common directory. */
export function renameShown(from: string, to: string): string {
  const a = from.split("/")
  const b = to.split("/")
  let common = 0
  while (
    common < a.length - 1 &&
    common < b.length - 1 &&
    a[common] === b[common]
  )
    common++
  const dir = a.slice(0, common).join("/")
  const inner = `{${a.slice(common).join("/")} => ${b.slice(common).join("/")}}`
  return dir === "" ? inner : `${dir}/${inner}`
}

/** A side as lines read it: none, a symlink's target, or a text file. */
const isLinesSide = (f: PathFact | undefined): boolean =>
  f === undefined ||
  f.kind === "absent" ||
  f.kind === "symlink" ||
  (f.kind === "file" && f.content === "text")

const mediaSide = (f: PathFact | undefined): MediaSide | null =>
  f?.kind === "file" ? { content: f.content, size: f.size } : null

/** How a row's content is shown: lines where every side reads as lines, else each side as media. */
function rowContent(
  before: PathFact | undefined,
  after: PathFact | undefined,
): ReviewFile["content"] {
  return isLinesSide(before) && isLinesSide(after)
    ? { kind: "lines" }
    : { kind: "media", before: mediaSide(before), after: mediaSide(after) }
}

const isAbsent = (f: PathFact | undefined) =>
  f === undefined || f.kind === "absent"

/**
 * The review of the source paths that differ between two states: a row for
 * each, sorted by path, with its lines added and removed and how its content
 * is shown; each move (`renames`, from `pairRenames`) one row, `{old =>
 * new}`, its lines 0 and 0.
 */
export function planFolderReview(input: {
  /** The source paths that differ, sorted (`sourceChanges`). */
  readonly files: readonly string[]
  /** Each file's lines added and removed, in order. */
  readonly stats: readonly DiffStat[]
  /** What the first state holds at each file, in order. */
  readonly before: readonly PathFact[]
  /** What the last state holds at each file, in order. */
  readonly after: readonly PathFact[]
  /** The moves: `a` gone, `b` added, their bytes equal. */
  readonly renames: readonly PathPair[]
  readonly description: string
}): RevisionReview {
  const at = new Map(
    input.files.map((path, i) => [
      path,
      {
        stat: input.stats[i],
        before: input.before[i],
        after: input.after[i],
      },
    ]),
  )
  const moved = new Set(input.renames.flatMap(r => [r.a, r.b]))
  const rows: ReviewFile[] = input.files
    .filter(path => !moved.has(path))
    .map(path => {
      const f = at.get(path)
      const change: FileChange = isAbsent(f?.before)
        ? "added"
        : isAbsent(f?.after)
          ? "removed"
          : "modified"
      return {
        path,
        shown: path,
        change,
        added: f?.stat?.added ?? 0,
        removed: f?.stat?.removed ?? 0,
        content: rowContent(f?.before, f?.after),
      }
    })
  const moves: ReviewFile[] = input.renames.map(r => ({
    path: r.b,
    shown: renameShown(r.a, r.b),
    change: "renamed",
    added: 0,
    removed: 0,
    content: rowContent(at.get(r.a)?.before, at.get(r.b)?.after),
  }))
  return {
    description: input.description,
    files: [...rows, ...moves].sort((x, y) =>
      x.path < y.path ? -1 : x.path > y.path ? 1 : 0,
    ),
    widenings: [],
  }
}
