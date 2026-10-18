// shared — a shared directory's files as lineages. A shared file
// is outside every state: it is never branched, so there is no merge to
// tell two writers apart. Instead every write is attributed and given a
// version, and a write based on a version another write replaced is
// flagged concurrent rather than lost unseen. A version is a stamp (size and
// ctime), which a lane and the host read alike; no file is read or hashed.
// Versions order by their ctime, the host's clock for every writer.

import {
  type EntryId,
  entryId,
  isThreadId,
  NO_SHARED,
  SHARED_KEPT,
  type SharedAccess,
  type SharedTouch,
  type Stamp,
  stamp,
  stampTimeUs,
  type ThreadId,
  type TurnShared,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeRecord, textKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** A lane's write of a shared file: the version it was based on, and the one it left. */
export interface SharedWrite {
  readonly path: string
  /** The stamp it was based on; null when it found no file. */
  readonly base: Stamp | null
  /**
   * When it found no file, by the host's clock: its write's ctime, less the
   * time between its open and its release on the lane's monotonic clock.
   * Unused when `base` is set: that version's own ctime is when it was made.
   */
  readonly missingAt: number
  readonly stamp: Stamp
  /**
   * Its stamp was read after the release returned, and the kernel's own
   * disagreed: it may be another writer's version (`ReleaseStamp`).
   */
  readonly raced: boolean
}

/**
 * A lane's reads and writes of shared files in a turn, from its accesses
 * (its runs', and its read and write tools', in the lane's monotonic
 * order), and what it
 * has read of each file since: `lastRead`, as the turn found it and as it
 * leaves it. A write is an open for writing and the last release of that
 * descriptor's file by the same process before it opens the file again.
 * It is based on what the lane last read of the file, in this turn or an
 * earlier one: what the agent knew of it, by any tool. With no read, it is
 * based on what its open found. An append is based on what its open found:
 * it adds to what is there, whatever version that is. A write that changed
 * nothing is a read. An open never released (a process killed) is dropped.
 */
export function sharedTouches(
  accesses: readonly SharedAccess[],
  lastRead: ReadonlyMap<string, Stamp>,
): {
  readonly reads: readonly SharedRead[]
  readonly writes: readonly SharedWrite[]
  readonly lastRead: ReadonlyMap<string, Stamp>
} {
  const reads: SharedRead[] = []
  const writes: SharedWrite[] = []
  const known = new Map(lastRead)
  const open = new Map<
    string,
    {
      path: string
      base: Stamp | null
      openedAt: number
      released: { stamp: Stamp; at: number; raced: boolean } | null
    }
  >()
  const finish = (key: string) => {
    const w = open.get(key)
    open.delete(key)
    if (w === undefined || w.released === null) return
    const { stamp: left, at, raced } = w.released
    if (left === w.base && !raced) reads.push({ path: w.path, stamp: left })
    else
      writes.push({
        path: w.path,
        base: w.base,
        missingAt: stampTimeUs(left) - (at - w.openedAt),
        stamp: left,
        raced,
      })
    known.set(w.path, left)
  }
  const ordered = [...accesses].sort((a, b) => a.at - b.at)
  for (const a of ordered) {
    const key = `${a.pid}\0${a.path}`
    if (a.kind === "open" && !a.writable) {
      if (a.stamp !== null) {
        reads.push({ path: a.path, stamp: a.stamp })
        known.set(a.path, a.stamp)
      }
    } else if (a.kind === "open") {
      finish(key)
      open.set(key, {
        path: a.path,
        base: a.append ? a.stamp : (known.get(a.path) ?? a.stamp),
        openedAt: a.at,
        released: null,
      })
    } else {
      const w = open.get(key)
      if (w !== undefined && a.left.stamp !== null)
        w.released = {
          stamp: a.left.stamp,
          at: a.at,
          raced: a.left.kind === "raced",
        }
    }
  }
  for (const key of [...open.keys()]) finish(key)
  return { reads, writes, lastRead: known }
}

/** A lane's read of a shared file: the version it found. */
export interface SharedRead {
  readonly path: string
  readonly stamp: Stamp
}

/** Who made a version of a shared file: a lane's turn, or something no lane observed (you). */
export type SharedWriter =
  | { readonly kind: "lane"; readonly lane: ThreadId; readonly entry: EntryId }
  | { readonly kind: "outside" }

/**
 * One version of a shared file. `at` is its stamp's ctime in µs
 * (`stampTimeUs`): the host's clock when it was made, for every writer, so
 * versions order by it, whatever order they are learnt in.
 */
interface SharedVersion {
  /** Numbered as the host learns of it, from 1. */
  readonly version: number
  readonly stamp: Stamp
  readonly at: number
  readonly writer: SharedWriter
  /**
   * When the version its writer last read was made, or when it found the
   * file missing; null for one made outside.
   */
  readonly baseAt: number | null
  /**
   * Writes of two lanes' turns, or two turns of one, both left this stamp:
   * a release's stamp is read after the call returns, so one of them read
   * the other's version. Which one made it is unknown.
   */
  readonly contested: boolean
  /**
   * Another version landed after the one it was based on, and before it;
   * or it is contested, or based on a contested one.
   */
  readonly concurrent: boolean
}

/** A shared file's versions, oldest first, the newest `SHARED_KEPT`. */
export interface SharedLineage {
  /** From the disk's root: `.plans/a.md`. */
  readonly path: string
  readonly versions: readonly SharedVersion[]
  /** The next version's number. */
  readonly next: number
  /** What each lane last read of the file, by its id: what its next write is based on. */
  readonly read: Readonly<Record<string, Stamp>>
}

/**
 * Whether `v` is concurrent among `versions`: another version landed after
 * the one it was based on, and before it; or `v` is contested; or it is
 * based on a contested version, whose content its writer may never have
 * read.
 */
const isConcurrent = (
  v: SharedVersion,
  versions: readonly SharedVersion[],
): boolean =>
  v.contested ||
  (v.baseAt !== null &&
    versions.some(
      u =>
        u.version !== v.version &&
        ((u.at > (v.baseAt ?? Number.POSITIVE_INFINITY) && u.at < v.at) ||
          (u.contested && u.at === v.baseAt)),
    ))

const isSameWriter = (a: SharedWriter, b: SharedWriter): boolean =>
  a.kind === "outside"
    ? b.kind === "outside"
    : b.kind === "lane" && a.lane === b.lane && a.entry === b.entry

/**
 * The shared lineages after a lane's turn, or after the host's watcher saw
 * stamps on the files (`seen`), and what the turn's record says of them.
 * - A stamp no lineage has seen becomes a version made outside every lane,
 *   by its ctime: yours, until a lane's turn reports it.
 * - A lane's write whose stamp the watcher saw first claims that version.
 * - A version another lane turn's write claimed already is contested, and
 *   keeps its first writer, whose turn is named in `revised`; so is one a
 *   raced release left (`SharedWrite.raced`).
 * - Concurrency is reckoned over the whole lineage each time, since versions
 *   order by ctime, not by when they are learnt: a write recorded before an
 *   earlier rival is found concurrent once the rival is, and named in
 *   `revised` for its turn's record.
 * - A lane's `lastRead` is kept on each lineage (`read`), so its next turn's
 *   writes are based on what it knew.
 */
export function planSharedLineages(input: {
  /** The lineages of the files touched, as stored; absent for a file never seen. */
  readonly lineages: ReadonlyMap<string, SharedLineage>
  readonly reads: readonly SharedRead[]
  readonly writes: readonly SharedWrite[]
  /** Stamps the host's watcher saw, with no writer known. */
  readonly seen: readonly SharedRead[]
  /** The lane and turn of `reads` and `writes`; null for the watcher's. */
  readonly writer: Extract<SharedWriter, { kind: "lane" }> | null
  /** What the lane has now read of each file (`sharedTouches`). */
  readonly lastRead: ReadonlyMap<string, Stamp>
}): {
  readonly lineages: readonly SharedLineage[]
  readonly turn: TurnShared
  readonly revised: readonly {
    readonly path: string
    readonly version: number
    readonly writer: SharedWriter
  }[]
} {
  const { writer } = input
  if (
    input.reads.length === 0 &&
    input.writes.length === 0 &&
    input.seen.length === 0 &&
    input.lastRead.size === 0
  )
    return { lineages: [], turn: NO_SHARED, revised: [] }
  const lineages = new Map<
    string,
    {
      versions: SharedVersion[]
      next: number
      read: Record<string, Stamp>
      changed: boolean
    }
  >()
  const working = (path: string) => {
    let lineage = lineages.get(path)
    if (lineage === undefined) {
      const stored = input.lineages.get(path)
      lineage = {
        versions: [...(stored?.versions ?? [])],
        next: stored?.next ?? 1,
        read: { ...(stored?.read ?? {}) },
        changed: false,
      }
      lineages.set(path, lineage)
    }
    return lineage
  }
  const add = (
    path: string,
    v: Omit<SharedVersion, "version" | "contested" | "concurrent" | "at">,
    contested = false,
  ): SharedVersion => {
    const lineage = working(path)
    const made = {
      ...v,
      version: lineage.next,
      at: stampTimeUs(v.stamp),
      contested,
      concurrent: false,
    }
    lineage.next += 1
    lineage.versions.push(made)
    lineage.versions.sort((a, b) => a.at - b.at)
    lineage.changed = true
    return made
  }
  /** The version with `s`, made outside if no lineage has seen it. */
  const known = (path: string, s: Stamp): SharedVersion =>
    working(path).versions.find(v => v.stamp === s) ??
    add(path, { stamp: s, writer: { kind: "outside" }, baseAt: null })

  for (const s of input.seen) known(s.path, s.stamp)
  for (const r of input.reads) known(r.path, r.stamp)
  const made: SharedTouch[] = []
  const revised: {
    path: string
    version: number
    writer: SharedWriter
  }[] = []
  for (const w of input.writes) {
    if (writer === null) break
    const baseAt = w.base === null ? w.missingAt : known(w.path, w.base).at
    const lineage = working(w.path)
    const seen = lineage.versions.findIndex(v => v.stamp === w.stamp)
    const claimed = lineage.versions[seen]
    if (claimed !== undefined) {
      const rival =
        claimed.writer.kind === "lane" && !isSameWriter(claimed.writer, writer)
      if (rival && !claimed.concurrent)
        revised.push({
          path: w.path,
          version: claimed.version,
          writer: claimed.writer,
        })
      lineage.versions[seen] = rival
        ? { ...claimed, contested: true }
        : {
            ...claimed,
            writer,
            baseAt,
            contested: claimed.contested || w.raced,
          }
      lineage.changed = true
      made.push({ path: w.path, version: claimed.version })
    } else {
      const v = add(w.path, { stamp: w.stamp, writer, baseAt }, w.raced)
      made.push({ path: w.path, version: v.version })
    }
  }
  if (writer !== null)
    for (const [path, s] of input.lastRead) {
      const lineage = working(path)
      if (lineage.read[writer.lane] !== s) {
        lineage.read[writer.lane] = s
        lineage.changed = true
      }
    }
  const isMade = (path: string, version: number) =>
    made.some(m => m.path === path && m.version === version)
  const out: SharedLineage[] = []
  for (const [path, lineage] of lineages) {
    const versions = lineage.versions.map(v => {
      const concurrent = isConcurrent(v, lineage.versions)
      if (concurrent && !v.concurrent && !isMade(path, v.version))
        revised.push({ path, version: v.version, writer: v.writer })
      return concurrent === v.concurrent ? v : { ...v, concurrent }
    })
    if (!lineage.changed && revised.every(r => r.path !== path)) continue
    out.push({
      path,
      versions: versions.slice(-SHARED_KEPT),
      next: lineage.next,
      read: lineage.read,
    })
  }
  const isConcurrentWrite = (m: SharedTouch) =>
    out
      .find(l => l.path === m.path)
      ?.versions.find(v => v.version === m.version)?.concurrent ?? false
  return {
    lineages: out,
    turn: {
      wrote: made.map(m => ({ ...m, concurrent: isConcurrentWrite(m) })),
    },
    revised,
  }
}

/** What `lane` last read of each file, from the lineages touched: what `sharedTouches` starts from. */
export const laneReads = (
  lineages: ReadonlyMap<string, SharedLineage>,
  lane: ThreadId,
): ReadonlyMap<string, Stamp> =>
  new Map(
    [...lineages].flatMap(([path, lineage]) => {
      const s = lineage.read[lane]
      return s === undefined ? [] : [[path, s] as const]
    }),
  )

/**
 * The lineages a full scan of the shared directory `dir` lets go: each under
 * it whose file the scan did not find, once every version is older than the
 * host's start (`startedAt`, in µs by the host's clock). Only then can no
 * turn the host has yet to record land a write among them.
 */
export function planGoneLineages(input: {
  readonly lineages: ReadonlyMap<string, SharedLineage>
  /** From the disk's root: `.plans`. */
  readonly dir: string
  /** Every regular file the scan found under `dir`. */
  readonly found: ReadonlySet<string>
  readonly startedAt: number
}): readonly string[] {
  const under = `${input.dir}/`
  return [...input.lineages.values()]
    .filter(
      l =>
        l.path.startsWith(under) &&
        !input.found.has(l.path) &&
        l.versions.every(v => v.at < input.startedAt),
    )
    .map(l => l.path)
    .sort()
}

/**
 * Each lineage that names one of `lanes` among its readers, without them:
 * the lanes of threads deleted for good, which never write again. An
 * archived or trashed thread's lane is kept, since it can be restored, and
 * its next write is then based on what it read.
 */
export function planForgottenReaders(
  lineages: ReadonlyMap<string, SharedLineage>,
  lanes: ReadonlySet<ThreadId>,
): readonly SharedLineage[] {
  return [...lineages.values()].flatMap(l => {
    const kept = Object.entries(l.read).filter(
      ([lane]) => !(isThreadId(lane) && lanes.has(lane)),
    )
    return kept.length === Object.keys(l.read).length
      ? []
      : [{ ...l, read: Object.fromEntries(kept) }]
  })
}

const VersionSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  stamp: Type.String({ minLength: 1 }),
  at: Type.Number(),
  writer: Type.Union([
    Type.Object({
      kind: Type.Literal("lane"),
      lane: Type.String(),
      entry: Type.String({ minLength: 1 }),
    }),
    Type.Object({ kind: Type.Literal("outside") }),
  ]),
  baseAt: Type.Union([Type.Number(), Type.Null()]),
  contested: Type.Boolean(),
  concurrent: Type.Boolean(),
})

const LineSchema = Type.Object({
  versions: Type.Array(VersionSchema),
  next: Type.Integer({ minimum: 1 }),
  read: Type.Record(Type.String(), Type.String({ minLength: 1 })),
})

/** Each shared file's lineage, at its path from the disk's root. */
export const SHARED_LINEAGE: RecordSpec<SharedLineage, string, "session"> = {
  namespace: "pinetrie.shared",
  home: "session",
  keyOf: l => l.path,
  encode: ({ path: _, ...contents }) => contents,
  decode: (contents, key) =>
    decodeRecord(LineSchema, contents, textKey(key), (l, path) => {
      const versions: SharedVersion[] = []
      for (const v of l.versions) {
        const writer: SharedWriter | null =
          v.writer.kind === "outside"
            ? { kind: "outside" }
            : isThreadId(v.writer.lane)
              ? {
                  kind: "lane",
                  lane: v.writer.lane,
                  entry: entryId(v.writer.entry),
                }
              : null
        if (writer === null) return undefined
        versions.push({ ...v, stamp: stamp(v.stamp), writer })
      }
      const read: Record<string, Stamp> = {}
      for (const [lane, s] of Object.entries(l.read)) read[lane] = stamp(s)
      return { path, versions, next: l.next, read }
    }),
}
