// core/disks — a lane's disk: its snapshots, the paths that differ between
// two, and what a turn did to it beyond its commit.

import type { TurnShared } from "./runs.ts"

declare const snapshotIdBrand: unique symbol
/**
 * A lane disk snapshot's id: the entry id of the revision record it belongs
 * to, or `"base"`. Its file is `.pinetrie/snapshots/<id>.img`. One snapshot
 * per record, so a turn retried after a crash writes the same file.
 */
export type SnapshotId = string & { readonly [snapshotIdBrand]: true }
export const snapshotId = (id: string): SnapshotId => id as SnapshotId
/** The project's disk at accepted work's commit, which root lanes fork from. */
export const BASE_SNAPSHOT = snapshotId("base")

/**
 * One path that differs between two snapshots of a disk, from the disk's
 * root. A renamed directory is its old path deleted and its new one added,
 * the directory alone: what is under it moved with it.
 */
export interface DiskChange {
  readonly path: string
  readonly change: "added" | "changed" | "deleted"
  /** What is at the path: what was, for a deletion; `other` when not known. */
  readonly kind: "file" | "dir" | "symlink" | "other"
}

/**
 * Paths on a lane's disk that pine·trie, the repos and the file system keep:
 * never classed, never a recipe's output, never deleted as stale. The lane's
 * home, under `.pinetrie-lane`, is classed all the same (`LANE_HOME_PATH`).
 */
export const DISK_OWN_ROOTS: readonly string[] = [
  ".pinetrie-lane",
  ".jj",
  ".git",
  "lost+found",
]

/** Whether `p`, from a disk's root, is `root` or under it, for any of `roots`. */
export const isUnderAny = (p: string, roots: readonly string[]): boolean =>
  roots.some(r => p === r || p.startsWith(`${r}/`))

/** A path inside a disk: relative, each segment a name, never `.` or `..`. */
export const isPathInside = (p: string): boolean =>
  p !== "" &&
  !p.startsWith("/") &&
  p.split("/").every(s => s !== "" && s !== "." && s !== "..")

declare const diskPathBrand: unique symbol
/**
 * A path checked to stay inside a disk (`isPathInside`), as a recipe's
 * outputs are: what pine·trie deletes on a lane's disk is one of these.
 */
export type DiskPath = string & { readonly [diskPathBrand]: true }
/** `p` as a `DiskPath`; null for a path that leaves the disk. */
export const diskPath = (p: string): DiskPath | null =>
  isPathInside(p) ? (p as DiskPath) : null

/** What differs between two snapshots of a disk, sorted by path. */
export interface DiskDiff {
  readonly changes: readonly DiskChange[]
}

/** Some of a turn's paths: the first of them, and how many more. */
export interface ListedPaths {
  readonly paths: readonly string[]
  readonly more: number
}

/** How many paths of each class a turn's record lists. */
export const DISK_LISTED = 100

/**
 * What a turn did to its lane's disk, beyond its commit: its runs' records
 * and tool writes classed by `.gitignore`, and what its whole-disk diff
 * found that no tool call wrote. Paths are topmost: a directory stands for
 * what is under it.
 */
export interface TurnDisk {
  /** Derived roots its runs wrote. */
  readonly derived: ListedPaths
  /** Local paths it wrote: ignored, and not made from source. */
  readonly local: ListedPaths
  /** Directories its runs made from source that `.gitignore` does not ignore. */
  readonly unignored: readonly string[]
  /** Source files it wrote that its commit left out: jj's size limit, for one. */
  readonly leftovers: readonly string[]
  /** The shared files' versions it wrote (`SharedLineage`, `@pinetrie/rules`). */
  readonly shared: TurnShared
}
