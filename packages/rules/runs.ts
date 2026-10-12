// runs — a lane's runs, folded on the host from their events (`RunEvent`,
// core), whatever observes the lane, and drained into records.
//
// An event is an attempt, and the observer does not see whether it
// succeeded. So a run's trace keeps, per path, what was there when the run
// first named it and what the run did since; whether the path is there now
// is read at each drain (`present`, from the lane), not inferred: a
// temporary file made and renamed away, or a call that failed, then
// reports nothing.

import path from "node:path"
import {
  type FileHashes,
  type Flushed,
  type LaneDrain,
  type LaneRuns,
  OPEN_FLAGS,
  type PathKind,
  type Recipe,
  type RecipeCheck,
  type ReleaseStamp,
  type RunEvent,
  type RunRecord,
  type RunWrite,
  type SharedAccess,
  type Stamp,
} from "@pinetrie/core"

/** A release's version: raced when the kernel's stamp disagreed with the one read after. */
const releaseStamp = (e: Extract<RunEvent, { kind: "call" }>): ReleaseStamp =>
  e.raced !== null && e.stamp !== null
    ? { kind: "raced", stamp: e.stamp, kernel: e.raced }
    : { kind: "stamp", stamp: e.stamp }

/** What a run did to one path, since it first named it. */
export interface PathTrace {
  /** Something was at the path when the run first named it. */
  readonly before: boolean
  readonly wrote: boolean
  /** Read while it held what was there before the run. */
  readonly read: boolean
  /** Looked for while missing, before the run made it. */
  readonly missed: boolean
  readonly dir: boolean
  /** Reported written at an earlier drain: gone now, it is a deletion. */
  readonly reportedWrite: boolean
  readonly reportedRead: boolean
  readonly reportedMissing: boolean
}

/** A run as folded so far: its paths relative to `root`. */
export interface RunTrace {
  readonly id: string
  readonly command: string | null
  /** The lane's directory, absolute. */
  readonly root: string
  /** Shared directories, relative to `root`. */
  readonly shared: readonly string[]
  readonly exit: number | null
  readonly ended: boolean
  /** Events the observer lost, in all: the run is incomplete for good. */
  readonly lost: number
  readonly paths: ReadonlyMap<string, PathTrace>
  /** Paths changed since the last drain. */
  readonly dirty: ReadonlySet<string>
  /** Shared accesses since the last drain. */
  readonly accesses: readonly SharedAccess[]
  /** Anything to report at the next drain, the exit and the end included. */
  readonly changed: boolean
}

export const newRunTrace = (input: {
  readonly id: string
  readonly command: string | null
  readonly root: string
  readonly shared: readonly string[]
}): RunTrace => ({
  ...input,
  exit: null,
  ended: false,
  lost: 0,
  paths: new Map(),
  dirty: new Set(),
  accesses: [],
  changed: true,
})

const FIRST: Omit<PathTrace, "before"> = {
  wrote: false,
  read: false,
  missed: false,
  dir: false,
  reportedWrite: false,
  reportedRead: false,
  reportedMissing: false,
}

/** `p` relative to `root`, or null outside it (and for `root` itself). */
const inside = (root: string, p: string): string | null => {
  if (p === "") return null
  const rel = path.posix.relative(root, path.posix.normalize(p))
  return rel === "" ||
    rel === ".." ||
    rel.startsWith("../") ||
    path.posix.isAbsolute(rel)
    ? null
    : rel
}

const isUnder = (p: string, roots: readonly string[]): boolean =>
  roots.some(r => p === r || p.startsWith(`${r}/`))

/**
 * `trace` with `events` folded in. Copies the trace's maps once per call,
 * so fold a batch at a time.
 */
export function foldRunEvents(
  trace: RunTrace,
  events: readonly RunEvent[],
): RunTrace {
  const paths = new Map(trace.paths)
  const dirty = new Set(trace.dirty)
  const accesses = [...trace.accesses]
  let { exit, ended, lost, changed } = trace

  const touch = (
    p: string,
    kind: PathKind,
    change: (t: PathTrace) => PathTrace,
  ) => {
    const t = paths.get(p) ?? { ...FIRST, before: kind !== "missing" }
    paths.set(p, change(t))
    dirty.add(p)
    changed = true
  }
  const written = (dir: boolean) => (t: PathTrace) => ({
    ...t,
    wrote: true,
    dir,
  })

  for (const e of events) {
    if (e.kind === "exit") {
      exit = e.status
      changed = true
      continue
    }
    if (e.kind === "lost") {
      lost += e.count
      changed = true
      continue
    }
    if (e.kind === "end") {
      ended = true
      changed = true
      continue
    }
    const p = inside(trace.root, e.path)
    const p2 = inside(trace.root, e.path2)
    if (
      p !== null &&
      isUnder(p, trace.shared) &&
      (e.op === "open" || e.op === "release")
    ) {
      const fields = {
        path: p,
        writable: (e.flags & OPEN_FLAGS.accmode) !== 0,
        append: (e.flags & OPEN_FLAGS.append) !== 0,
        at: e.at,
        pid: e.pid,
      }
      accesses.push(
        e.op === "open"
          ? { ...fields, kind: "open", stamp: e.stamp }
          : { ...fields, kind: "release", left: releaseStamp(e) },
      )
      changed = true
    }
    switch (e.op) {
      case "open": {
        if (p === null || e.before === "dir") break
        const known = paths.get(p)
        if ((e.flags & OPEN_FLAGS.path) !== 0) {
          if (e.before === "missing" && known === undefined)
            touch(p, e.before, t => ({ ...t, missed: true }))
          break
        }
        const writes =
          (e.flags & OPEN_FLAGS.accmode) !== 0 ||
          (e.flags & (OPEN_FLAGS.creat | OPEN_FLAGS.trunc)) !== 0
        if (e.before === "missing") {
          if ((e.flags & OPEN_FLAGS.creat) !== 0)
            touch(p, e.before, written(false))
          else if (known === undefined)
            touch(p, e.before, t => ({ ...t, missed: true }))
        } else if (writes) touch(p, e.before, written(false))
        else if (known === undefined || !known.wrote)
          touch(p, e.before, t => ({ ...t, read: t.before }))
        break
      }
      case "rename": {
        if (p !== null) {
          if (e.before === "dir") moveUnder(paths, dirty, p, p2)
          touch(p, e.before, t => t)
        }
        if (p2 !== null) touch(p2, e.before2, written(e.before === "dir"))
        break
      }
      case "link":
        if (p2 !== null) touch(p2, e.before2, written(false))
        break
      case "symlink":
        if (p !== null) touch(p, e.before, written(false))
        break
      case "mkdir":
        if (p !== null && e.before === "missing")
          touch(p, e.before, written(true))
        break
      case "unlink":
        if (p !== null) touch(p, e.before, t => t)
        break
      case "release":
        break
    }
  }
  return { ...trace, exit, ended, lost, paths, dirty, accesses, changed }
}

/**
 * A directory renamed by the run: what the run did under its old name, it
 * did under the new. The directory's own deletion stands for its old paths.
 */
function moveUnder(
  paths: Map<string, PathTrace>,
  dirty: Set<string>,
  from: string,
  to: string | null,
) {
  for (const [p, t] of [...paths]) {
    if (!p.startsWith(`${from}/`)) continue
    paths.delete(p)
    dirty.delete(p)
    if (to === null) continue
    const moved = `${to}${p.slice(from.length)}`
    paths.set(moved, t)
    dirty.add(moved)
  }
}

/**
 * The run's record since the last drain, given which of its changed paths
 * are there now (`trace.dirty`, read by the caller), and the trace to fold
 * on into. Null when nothing happened since.
 */
export function drainRun(
  trace: RunTrace,
  present: ReadonlySet<string>,
): { readonly record: RunRecord | null; readonly trace: RunTrace } {
  if (!trace.changed) return { record: null, trace }
  const paths = new Map(trace.paths)
  const reads: string[] = []
  const writes: RunWrite[] = []
  const deletions: string[] = []
  const missing: string[] = []
  for (const p of [...trace.dirty].sort()) {
    const t = paths.get(p)
    if (t === undefined) continue
    const now = present.has(p)
    if (t.wrote && now) writes.push({ path: p, created: !t.before, dir: t.dir })
    else if (!now && (t.before || t.reportedWrite)) deletions.push(p)
    if (t.read && !t.reportedRead) reads.push(p)
    if (t.missed && !t.reportedMissing) missing.push(p)
    paths.set(p, {
      ...t,
      reportedWrite: t.wrote && now,
      reportedRead: t.reportedRead || t.read,
      reportedMissing: t.reportedMissing || t.missed,
    })
  }
  return {
    record: {
      id: trace.id,
      command: trace.command,
      exit: trace.exit,
      alive: !trace.ended,
      observed:
        trace.lost > 0
          ? { kind: "lost", events: trace.lost }
          : { kind: "complete" },
      reads,
      writes,
      deletions,
      missing,
      shared: trace.accesses,
    },
    trace: { ...trace, paths, dirty: new Set(), accesses: [], changed: false },
  }
}

/**
 * A lane's traces with a drain folded in: the runs its helper launched,
 * then the source's notices up to its flush. A notice of a run the host
 * never saw launched (an earlier helper's) starts a trace with no command.
 */
export function foldLaneDrain(
  traces: ReadonlyMap<string, RunTrace>,
  input: { readonly drain: LaneDrain; readonly notices: Flushed },
): Map<string, RunTrace> {
  const next = new Map(traces)
  const { root, shared } = input.drain
  const start = (run: string, command: string | null) =>
    newRunTrace({ id: run, command, root, shared })
  for (const l of input.drain.launched)
    next.set(l.run, next.get(l.run) ?? start(l.run, l.command))
  const byRun = new Map<string, RunEvent[]>()
  for (const n of input.notices) {
    const list = byRun.get(n.run) ?? []
    list.push(n.event)
    byRun.set(n.run, list)
  }
  for (const [run, events] of byRun)
    next.set(run, foldRunEvents(next.get(run) ?? start(run, null), events))
  return next
}

/** The paths whose presence the next drain needs: every trace's changed ones. */
export const dirtyPaths = (
  traces: ReadonlyMap<string, RunTrace>,
): readonly string[] =>
  [...new Set([...traces.values()].flatMap(t => [...t.dirty]))].sort()

/**
 * A lane's runs drained, given which of `dirtyPaths` are there now, with
 * its tools' part; and the traces to fold on into, each ended run gone.
 */
export function drainLane(
  traces: ReadonlyMap<string, RunTrace>,
  present: ReadonlySet<string>,
  drain: LaneDrain,
): { readonly runs: LaneRuns; readonly traces: Map<string, RunTrace> } {
  const runs: RunRecord[] = []
  const next = new Map<string, RunTrace>()
  for (const [id, trace] of traces) {
    const { record, trace: after } = drainRun(trace, present)
    if (record !== null) runs.push(record)
    if (!after.ended) next.set(id, after)
  }
  return {
    runs: {
      runs,
      toolWrites: drain.toolWrites,
      toolShared: drain.toolShared,
    },
    traces: next,
  }
}

/**
 * Whether `recipe`'s key holds on a disk, but for its image, which the host
 * compares: the first input whose hash differs, failed lookup now found, or
 * shared file whose stamp differs, in that order; null when none.
 */
export function checkRecipe(
  recipe: Recipe,
  now: {
    readonly hashes: FileHashes
    readonly present: ReadonlySet<string>
    readonly stamps: Readonly<Record<string, Stamp | null>>
  },
): RecipeCheck {
  const { key } = recipe
  const broken =
    Object.keys(key.inputs)
      .sort()
      .find(p => now.hashes[p] !== key.inputs[p]) ??
    key.missing.find(p => now.present.has(p)) ??
    Object.keys(key.shared)
      .sort()
      .find(p => now.stamps[p] !== key.shared[p]) ??
    null
  return { run: recipe.run, broken }
}
