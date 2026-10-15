// host/folder/changes — what differs between two states as the project sees
// it: the one answer a turn's paths, an offer's files and a catch-up's
// forecast all use. The disk's diff, with each directory it names made or
// gone read as the files under it; then the files whose bytes and mode
// truly differ; then the source paths alone, as the lanes' ignore rule
// reads them.

import { type DiskChange, type PointId, snapshotId } from "@pinetrie/core"
import type { FolderDisks, LaneRuntime } from "@pinetrie/lanes"
import {
  type IgnoreFile,
  ignoreDirs,
  ignoredPaths,
} from "@pinetrie/rules/ignores"

/** The most a `.gitignore` read from a state may hold. */
const IGNORE_FILE_LIMIT = 1024 * 1024

/** What reading two states' changes takes. */
export interface StateReader {
  readonly runtime: Pick<LaneRuntime, "diff">
  readonly disks: Pick<
    FolderDisks,
    "filesUnder" | "sameContent" | "pathFacts" | "read"
  >
  /** pine·trie's own patterns now (`laneIgnores`, with the shared directories). */
  readonly own: () => string
}

/** The `.gitignore` files of `state` that bear on `paths`. */
async function ignoreFilesIn(
  r: StateReader,
  state: PointId,
  paths: readonly string[],
): Promise<readonly IgnoreFile[]> {
  const files = await Promise.all(
    ignoreDirs(paths).map(async dir => {
      const text = await r.disks.read(
        state,
        dir === "" ? ".gitignore" : `${dir}/.gitignore`,
        IGNORE_FILE_LIMIT,
      )
      return text === null ? [] : [{ dir, text }]
    }),
  )
  return files.flat()
}

/** The source paths that differ between states `a` and `b`, sorted. */
export async function sourceChanges(
  r: StateReader,
  a: PointId,
  b: PointId,
): Promise<readonly string[]> {
  // gather the diff, each made or gone directory as its files
  const { changes } = await r.runtime.diff(snapshotId(a), snapshotId(b))
  const dirsIn = (change: "added" | "deleted") =>
    changes
      .filter(c => c.kind === "dir" && c.change === change)
      .map(c => c.path)
  const [made, gone] = await Promise.all([
    r.disks.filesUnder(b, dirsIn("added")),
    r.disks.filesUnder(a, dirsIn("deleted")),
  ])
  const changed = changes
    .filter(c => c.kind !== "dir" && c.change === "changed")
    .map(c => c.path)
  const inB = new Set([
    ...made,
    ...changes
      .filter(c => c.kind !== "dir" && c.change === "added")
      .map(c => c.path),
    ...changed,
  ])
  const inAOnly = new Set([
    ...gone,
    ...changes
      .filter(c => c.kind !== "dir" && c.change === "deleted")
      .map(c => c.path),
  ])
  for (const p of inB) inAOnly.delete(p)
  // drop the files rewritten as they were, bytes and mode
  const alike = new Set(await r.disks.sameContent(a, b, changed))
  const [factsA, factsB] = await Promise.all([
    r.disks.pathFacts(a, [...alike]),
    r.disks.pathFacts(b, [...alike]),
  ])
  const same = new Set(
    [...alike].filter((_, i) => {
      const fa = factsA[i]
      const fb = factsB[i]
      return fa?.kind === "file" && fb?.kind === "file" && fa.exec === fb.exec
    }),
  )
  // source paths alone
  const own = r.own()
  const present = [...inB].filter(p => !same.has(p))
  const absent = [...inAOnly]
  const [ignoredB, ignoredA] = await Promise.all([
    ignoreFilesIn(r, b, present).then(files =>
      ignoredPaths({ files, own, paths: present, dirs: new Set() }),
    ),
    ignoreFilesIn(r, a, absent).then(files =>
      ignoredPaths({ files, own, paths: absent, dirs: new Set() }),
    ),
  ])
  return [
    ...present.filter(p => !ignoredB.has(p)),
    ...absent.filter(p => !ignoredA.has(p)),
  ].sort()
}

/**
 * The disk's diff from `a` to `b`, its source paths alone: what a path merge
 * plans from, a renamed directory still named by its path alone.
 */
export async function sourceDiff(
  r: StateReader,
  a: PointId,
  b: PointId,
): Promise<readonly DiskChange[]> {
  const { changes } = await r.runtime.diff(snapshotId(a), snapshotId(b))
  const own = r.own()
  const ignoredIn = async (state: PointId, cs: readonly DiskChange[]) => {
    const paths = cs.map(c => c.path)
    return ignoredPaths({
      files: await ignoreFilesIn(r, state, paths),
      own,
      paths,
      dirs: new Set(cs.filter(c => c.kind === "dir").map(c => c.path)),
    })
  }
  const deleted = changes.filter(c => c.change === "deleted")
  const present = changes.filter(c => c.change !== "deleted")
  const [ignoredB, ignoredA] = await Promise.all([
    ignoredIn(b, present),
    ignoredIn(a, deleted),
  ])
  return changes.filter(c =>
    c.change === "deleted" ? !ignoredA.has(c.path) : !ignoredB.has(c.path),
  )
}
