// lanehost/walk — what differs between two snapshots, from each tree's
// `lstat`s: the diff where `btrfs send` cannot run, under rootless Docker.
// It reads every entry of both, about 80 ms each for a lane of 44,566
// entries, whatever changed.

import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import type { DiskChange, DiskDiff } from "@pinetrie/core"

/** What a walk keeps of an entry. */
export interface Entry {
  readonly kind: DiskChange["kind"]
  readonly mode: number
  readonly size: number
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
  readonly ino: number
}

/** An entry's kind from its `lstat`: lanehost decides it here alone. */
export const statKind = (s: {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}) =>
  s.isDirectory()
    ? "dir"
    : s.isSymbolicLink()
      ? "symlink"
      : s.isFile()
        ? "file"
        : "other"

/** Every entry under `root`, by its path from it; never through a symlink. */
export async function walkTree(
  root: string,
): Promise<ReadonlyMap<string, Entry>> {
  const out = new Map<string, Entry>()
  const pending = [""]
  for (let rel = pending.pop(); rel !== undefined; rel = pending.pop()) {
    const names = await readdir(path.join(root, rel)).catch(
      () => [] as string[],
    )
    for (const name of names) {
      const p = rel === "" ? name : `${rel}/${name}`
      const s = await lstat(path.join(root, p), { bigint: true })
      const kind = statKind(s)
      out.set(p, {
        kind,
        mode: Number(s.mode),
        size: Number(s.size),
        mtimeNs: s.mtimeNs,
        ctimeNs: s.ctimeNs,
        ino: Number(s.ino),
      })
      if (kind === "dir") pending.push(p)
    }
  }
  return out
}

/**
 * The paths that differ between two walks, sorted. An entry is changed when
 * its mode, size, times or inode differ; a directory only when its mode
 * does, since its times move with every entry made in it, as `send` reports
 * no change for times alone. One whose kind changed is changed, as its new
 * kind.
 */
export function compareTrees(
  before: ReadonlyMap<string, Entry>,
  after: ReadonlyMap<string, Entry>,
): readonly DiskChange[] {
  const out: DiskChange[] = []
  for (const [p, a] of after) {
    const b = before.get(p)
    if (b === undefined) out.push({ path: p, change: "added", kind: a.kind })
    else if (
      b.kind !== a.kind ||
      b.mode !== a.mode ||
      (a.kind !== "dir" &&
        (b.size !== a.size ||
          b.mtimeNs !== a.mtimeNs ||
          b.ctimeNs !== a.ctimeNs ||
          b.ino !== a.ino))
    )
      out.push({ path: p, change: "changed", kind: a.kind })
  }
  for (const [p, b] of before)
    if (!after.has(p)) out.push({ path: p, change: "deleted", kind: b.kind })
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
}

/** The diff by walking both trees, where `btrfs send` cannot run. */
export async function diffByWalk(from: string, to: string): Promise<DiskDiff> {
  const [before, after] = await Promise.all([walkTree(from), walkTree(to)])
  return { changes: compareTrees(before, after) }
}
