// folder/accept — a write into the project's folder, an accept's or a
// restore's, decided as values: whether it may be, what it writes, whether
// the folder can hold those names, whether its staging directory holds what
// was planned; from its journal and what the folder holds, how a stopped or
// failed write ends; and at a quiet read, what becomes of the asides it
// kept.

import path from "node:path/posix"
import {
  type AcceptWrite,
  ERR,
  type ErrCode,
  type FolderProposedChangesRecord,
  type FolderStamp,
  type InodeStat,
  isFolderReserved,
  type PathFact,
  type PointId,
  type ProposedChangesSeen,
  restoreStateId,
  type StateRecord,
  type WriteJournal,
  type WritePath,
  type WriterId,
  writeAsideDir,
} from "@pinetrie/core"
import {
  folderNewest,
  laneNewest,
  planState,
  type StateGraph,
  shownMergeId,
} from "./graph.ts"

/** What an accept does, decided from the graph after its own read. */
export type AcceptPlanned =
  /** The shown merge made a state: the accept's. */
  | { readonly kind: "accept"; readonly record: StateRecord }
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * An accept of `proposed`, as `seen`: refused unless accepted work's newest
 * and the lane's tip are still the two it was shown, with no conflict it
 * was not shown; refused when conflicted, with nothing to accept, or when
 * the shown merge's snapshot is gone. Else the accept's state is the shown
 * merge, its parents accepted work's newest and the lane's tip.
 */
export function planAccept(input: {
  readonly graph: StateGraph
  readonly proposed: FolderProposedChangesRecord | undefined
  readonly seen: ProposedChangesSeen | null
  /** Whether the shown merge's snapshot is there. */
  readonly shownMade: boolean
  readonly at: number
  readonly by: WriterId | null
}): AcceptPlanned {
  const refused = (code: ErrCode): AcceptPlanned => ({ kind: "refused", code })
  const { graph, proposed, seen } = input
  if (proposed === undefined || proposed.files.length === 0)
    return refused(ERR.NO_PROPOSED_CHANGES)
  const start = folderNewest(graph)
  const tip = laneNewest(graph, proposed.lane)
  if (
    seen?.kind !== "folder" ||
    start === null ||
    tip === null ||
    start !== seen.start ||
    tip !== seen.tip ||
    proposed.start !== start ||
    proposed.tip !== tip ||
    (proposed.conflicts.length > 0 && !seen.conflicted)
  )
    return refused(ERR.NOT_AS_SHOWN)
  // A conflicted shown merge has only a WIP to go to, and a folder has none.
  if (proposed.conflicts.length > 0) return refused(ERR.BAD_DESTINATION)
  if (!input.shownMade) return refused(ERR.NOT_AS_SHOWN)
  const planned = planState(graph, {
    id: shownMergeId(start, tip),
    parents: [start, tip],
    made: { kind: "accept", lane: proposed.lane },
    at: input.at,
    by: input.by,
  })
  return planned.kind === "record"
    ? { kind: "accept", record: planned.record }
    : refused(ERR.NOT_AS_SHOWN)
}

/** What a restore does, decided from the graph after its own read. */
export type RestorePlanned =
  /** The restore's state, its content `of`'s (`writeContent`). */
  | { readonly kind: "restore"; readonly record: StateRecord }
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * A restore of `of` into the project's folder, as accepted work's newest
 * was `seen`: refused unless the newest is still `seen`; refused when `of`
 * is not kept, or its snapshot is gone; refused when the newest holds its
 * content already. Else its state is a line state with one parent, the
 * newest, written from `of`'s snapshot. Every refusal is decided before
 * anything is made.
 */
export function planRestore(input: {
  readonly graph: StateGraph
  /** Accepted work's record's `kept`. */
  readonly kept: readonly PointId[]
  readonly of: PointId
  /** Whether `of`'s snapshot is there. */
  readonly ofMade: boolean
  /** The source paths between accepted work's newest and `of`; none when `of`'s snapshot is gone. */
  readonly changes: readonly string[]
  /** Accepted work's newest when the person was shown the restore. */
  readonly seen: PointId
  /** A uuidv7 for the restore's state. */
  readonly uuid: string
  readonly at: number
  readonly by: WriterId | null
}): RestorePlanned {
  const refused = (code: ErrCode): RestorePlanned => ({
    kind: "refused",
    code,
  })
  const newest = folderNewest(input.graph)
  if (newest === null || newest !== input.seen) return refused(ERR.NOT_AS_SHOWN)
  if (!input.kept.includes(input.of) || !input.ofMade)
    return refused(ERR.STATE_NOT_KEPT)
  if (input.changes.length === 0) return refused(ERR.NOTHING_TO_RESTORE)
  const planned = planState(input.graph, {
    id: restoreStateId(input.uuid),
    parents: [newest],
    made: { kind: "restore", of: input.of },
    at: input.at,
    by: input.by,
  })
  return planned.kind === "record"
    ? { kind: "restore", record: planned.record }
    : refused(ERR.NOT_AS_SHOWN)
}

/**
 * The paths an accept writes, each with what the accept's read stamped
 * there and what the shown merge holds: a directory where a file was is
 * the file deleted, its files being paths of their own. Or the first path
 * the shown merge holds something no folder save can be (a device, a
 * socket, a fifo).
 */
export function acceptWrites(
  /** The source paths between accepted work's newest and the shown merge. */
  changed: readonly string[],
  /** Each changed path's fact in the shown merge, in order. */
  facts: readonly PathFact[],
  /** The stamps of the accept's own read. */
  read: ReadonlyMap<string, FolderStamp>,
): readonly AcceptWrite[] | { readonly unwritable: string } {
  const writes: AcceptWrite[] = []
  for (const [i, p] of changed.entries()) {
    const fact = facts[i]
    if (fact === undefined || fact.kind === "other") return { unwritable: p }
    writes.push({
      path: p,
      expected: read.get(p) ?? null,
      to:
        fact.kind === "file"
          ? { kind: "file" }
          : fact.kind === "symlink"
            ? { kind: "symlink", target: fact.target }
            : null,
    })
  }
  return writes
}

/** What a write puts at its path: a staged file, from the staging directory's root, or a symlink. */
export type WriteTo =
  | { readonly kind: "file"; readonly staged: string }
  | { readonly kind: "symlink"; readonly target: string }

/**
 * One path's write. Each that holds an `expected` is checked against it
 * before anything moves, so no step replaces or deletes unchecked.
 */
export type WriteStep =
  | {
      readonly kind: "replace"
      readonly path: string
      readonly expected: FolderStamp
      readonly to: WriteTo
    }
  | { readonly kind: "create"; readonly path: string; readonly to: WriteTo }
  | {
      readonly kind: "delete"
      readonly path: string
      readonly expected: FolderStamp
    }

/**
 * Each write as its step, every delete first (deepest first), so a file
 * that becomes a directory, or a directory a file, frees its name before
 * anything is made there. A staged file is at its own path under `stage`.
 */
export function planWriteSteps(
  writes: readonly AcceptWrite[],
  stage: string,
): readonly WriteStep[] {
  const to = (w: AcceptWrite): WriteTo | null =>
    w.to === null
      ? null
      : w.to.kind === "file"
        ? { kind: "file", staged: `${stage}/${w.path}` }
        : { kind: "symlink", target: w.to.target }
  const deletes: WriteStep[] = []
  const writing: WriteStep[] = []
  for (const w of writes) {
    const t = to(w)
    if (t === null) {
      if (w.expected !== null)
        deletes.push({ kind: "delete", path: w.path, expected: w.expected })
    } else if (w.expected === null)
      writing.push({ kind: "create", path: w.path, to: t })
    else
      writing.push({
        kind: "replace",
        path: w.path,
        expected: w.expected,
        to: t,
      })
  }
  const byPath = (a: WriteStep, b: WriteStep) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  return [...deletes.sort(byPath).reverse(), ...writing.sort(byPath)]
}

/** Why the folder cannot hold a path an accept would write. */
export type NameRefusal =
  /** Another path, written or there, is the same name once folded. */
  | { readonly kind: "collides"; readonly path: string; readonly with: string }
  /** It is no UTF-8: its name was read with a replacement character. */
  | { readonly kind: "not-utf8"; readonly path: string }
  /** A symlink whose target is absolute or climbs out of the folder. */
  | { readonly kind: "leaves"; readonly path: string }
  /** It lies under a name an accept reserves at the folder's root. */
  | { readonly kind: "reserved"; readonly path: string }

/**
 * The first written path the folder cannot hold, or null. Names and every
 * directory on their way are compared folded (NFC, and case-folded on a
 * disk that folds case), so a collision is found here, never as an
 * `EEXIST` half way through the writes.
 */
export function planNames(
  writes: readonly AcceptWrite[],
  /** The source paths of the accept's read. */
  folderPaths: Iterable<string>,
  foldsCase: boolean,
): NameRefusal | null {
  const fold = (name: string) => {
    const nfc = name.normalize("NFC")
    return foldsCase ? nfc.toLowerCase() : nfc
  }
  const gone = new Set(writes.filter(w => w.to === null).map(w => w.path))
  const written = writes.filter(w => w.to !== null)
  const sorted = [...written].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
  for (const w of sorted) {
    if (isFolderReserved(w.path)) return { kind: "reserved", path: w.path }
    if (w.path.includes("\uFFFD")) return { kind: "not-utf8", path: w.path }
    if (
      w.to?.kind === "symlink" &&
      (path.isAbsolute(w.to.target) ||
        path.normalize(path.join(path.dirname(w.path), w.to.target)) === ".." ||
        path
          .normalize(path.join(path.dirname(w.path), w.to.target))
          .startsWith("../"))
    )
      return { kind: "leaves", path: w.path }
  }
  // Each name, and each directory on a name's way, by its folded form.
  const seen = new Map<string, string>()
  const prefixes = (p: string) => {
    const parts = p.split("/")
    return parts.map((_, i) => parts.slice(0, i + 1).join("/"))
  }
  const there = [...folderPaths].filter(p => !gone.has(p))
  for (const p of [...sorted.map(w => w.path), ...there])
    for (const name of prefixes(p)) {
      const key = fold(name)
      const was = seen.get(key)
      if (was === undefined) seen.set(key, name)
      else if (was !== name) {
        const ours = sorted.find(
          w => w.path === name || w.path.startsWith(`${name}/`),
        )
        return {
          kind: "collides",
          path: ours?.path ?? was,
          with: ours === undefined ? name : was,
        }
      }
    }
  return null
}

/** One entry of the staging directory, as an `lstat` walk found it: a symlink is never entered. */
export interface StageEntry {
  /** From the staging directory's root. */
  readonly path: string
  readonly kind: "file" | "dir" | "symlink" | "other"
  readonly ino: number
  readonly size: number
  readonly mtimeNs: string
}

/** Whether the staging directory holds what was planned, with each staged file's stat. */
export type StageChecked =
  | {
      readonly kind: "staged"
      readonly files: ReadonlyMap<string, InodeStat>
    }
  | {
      readonly kind: "refused"
      readonly path: string
      readonly why: "extra" | "missing" | "kind"
    }

/**
 * The staging directory checked before any link: exactly the planned
 * files, each a regular file, and no directory but those on their way. A
 * lane controls the names in its state, and a symlink there would let a
 * link write around the checks: since a walk never enters one, a file
 * under it is missing.
 */
export function checkStage(
  walk: readonly StageEntry[],
  writes: readonly AcceptWrite[],
): StageChecked {
  const planned = new Set(
    writes.filter(w => w.to?.kind === "file").map(w => w.path),
  )
  const dirs = new Set(
    [...planned].flatMap(p => {
      const parts = p.split("/").slice(0, -1)
      return parts.map((_, i) => parts.slice(0, i + 1).join("/"))
    }),
  )
  const files = new Map<string, InodeStat>()
  for (const e of [...walk].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    if (planned.has(e.path)) {
      if (e.kind !== "file")
        return { kind: "refused", path: e.path, why: "kind" }
      files.set(e.path, { ino: e.ino, size: e.size, mtimeNs: e.mtimeNs })
    } else if (!(dirs.has(e.path) && e.kind === "dir"))
      return {
        kind: "refused",
        path: e.path,
        why: dirs.has(e.path) ? "kind" : "extra",
      }
  }
  const missing = [...planned].sort().find(p => !files.has(p))
  return missing === undefined
    ? { kind: "staged", files }
    : { kind: "refused", path: missing, why: "missing" }
}

/** A journal's paths, planned before its first move: each field set before the step it names. */
export function journalPaths(
  steps: readonly WriteStep[],
  staged: ReadonlyMap<string, InodeStat>,
  id: string,
): readonly WritePath[] {
  return steps.map(step => {
    const to = step.kind === "delete" ? null : step.to
    const file = to?.kind === "file" ? staged.get(step.path) : undefined
    if (to?.kind === "file" && file === undefined)
      throw new Error(`${step.path} was planned but not staged`)
    return {
      path: step.path,
      aside:
        step.kind === "create" ? null : `${writeAsideDir(id)}/${step.path}`,
      moved: null,
      staged: file ?? null,
      symlink: to?.kind === "symlink" ? to.target : null,
      linked: false,
      keptOn: null,
    }
  })
}

/** What `lstat` says at a journal path's target now. */
export interface TargetFact {
  readonly kind: "file" | "symlink" | "other"
  readonly ino: number
  readonly size: number
  readonly mtimeNs: string
  /** A symlink's target. */
  readonly target: string | null
}

/** What the folder holds now for one journal path: its target, and its aside. */
export interface PathNow {
  readonly target: TargetFact | null
  readonly aside: InodeStat | null
}

/** Whether two stats are one file, unwritten between them. */
export const isSameInode = (a: InodeStat, b: InodeStat): boolean =>
  a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs

/**
 * Whether the target is what pine·trie wrote and nobody wrote since: the
 * staged file's inode, size and mtime, or a symlink to the journal's
 * target. A file written in place since its link is yours, not pine·trie's.
 */
const isOwn = (p: WritePath, t: TargetFact | null): boolean => {
  const own = ownOf(p)
  return own !== null && isStillOwn(own, t)
}

/** What proves a target pine·trie's: the staged file's stat, or a symlink's target. */
export type Own =
  | { readonly kind: "file"; readonly stat: InodeStat }
  | { readonly kind: "symlink"; readonly target: string }

/** `p`'s proof of its own write; null before it is planned. */
const ownOf = (p: WritePath): Own | null =>
  p.staged !== null
    ? { kind: "file", stat: p.staged }
    : p.symlink !== null
      ? { kind: "symlink", target: p.symlink }
      : null

/** Whether the target is still `own`. */
export const isStillOwn = (own: Own, t: TargetFact | null): boolean =>
  t !== null &&
  (own.kind === "file"
    ? t.kind === "file" && isSameInode(t, own.stat)
    : t.kind === "symlink" && t.target === own.target)

/** A step that puts back what an accept moved, or removes what it made. */
export type RecoveryStep =
  /** Unlink the target, only while it is still `own`: what pine·trie wrote. */
  | { readonly kind: "unlink-own"; readonly path: string; readonly own: Own }
  /** Link the aside in where nothing stands, then drop it. */
  | { readonly kind: "put-back"; readonly path: string; readonly aside: string }
  /** Drop an aside the folder holds nothing new in. */
  | { readonly kind: "drop-aside"; readonly aside: string }
  /** The staging directory removed, and the asides' directory where empty. */
  | { readonly kind: "drop-stage"; readonly id: string }

/** How an accept that did not end ends: finished, or put back. */
export type RecoveryPlan =
  /** Every path linked: the accept's record and stamps are written, as by a commit. */
  | { readonly kind: "finish" }
  | {
      readonly kind: "put-back"
      readonly steps: readonly RecoveryStep[]
      /** The journal after: put back, its kept asides' `keptOn` set. */
      readonly journal: WriteJournal
    }

/**
 * An open journal's end, from what the folder holds at each of its paths
 * (in order). Every path done is a finish. Else every path is put back:
 * pine·trie's own target unlinked, each aside linked back where nothing
 * stands. An aside whose target holds a save since is dropped when it
 * holds what was moved (the read's content, which accepted work has), and
 * kept, on accepted work's newest, when written through since.
 */
export function planRecovery(
  journal: WriteJournal,
  now: readonly PathNow[],
): RecoveryPlan {
  const facts = journal.paths.map((p, i) => ({
    p,
    now: now[i] ?? { target: null, aside: null },
  }))
  const isDone = ({ p, now }: (typeof facts)[number]) =>
    p.linked ||
    (p.staged === null && p.symlink === null
      ? p.moved !== null &&
        now.target === null &&
        now.aside !== null &&
        isSameInode(now.aside, p.moved)
      : isOwn(p, now.target))
  if (facts.every(isDone)) return { kind: "finish" }
  const [newest] = journal.record.parents
  if (newest === undefined)
    throw new Error(`an accept's state has no parents: ${journal.record.id}`)
  const steps: RecoveryStep[] = []
  const paths = facts.map(({ p, now }): WritePath => {
    const proof = ownOf(p)
    const own = proof !== null && isStillOwn(proof, now.target)
    if (own) steps.push({ kind: "unlink-own", path: p.path, own: proof })
    if (p.aside === null || now.aside === null) return p
    const free = now.target === null || own
    if (free) {
      steps.push({ kind: "put-back", path: p.path, aside: p.aside })
      return p
    }
    // Linked back already and stopped before the aside was dropped, or
    // holding the read's content under a save made since.
    if (
      now.target?.ino === now.aside.ino ||
      (p.moved !== null && isSameInode(now.aside, p.moved))
    ) {
      steps.push({ kind: "drop-aside", aside: p.aside })
      return p
    }
    return { ...p, keptOn: newest }
  })
  steps.push({ kind: "drop-stage", id: journal.id })
  return {
    kind: "put-back",
    steps,
    journal: { ...journal, paths, status: "put-back" },
  }
}

/** An aside a journal kept, to be checked at a quiet read. */
export interface KeptAside {
  readonly path: string
  readonly aside: string
  /** Null when its content is the user's whatever it holds: a put back's. */
  readonly moved: InodeStat | null
  readonly keptOn: PointId
}

/** Each ended journal's asides still to be checked. */
export const keptAsides = (
  journals: readonly WriteJournal[],
): readonly KeptAside[] =>
  journals.flatMap(j =>
    j.status === "open"
      ? []
      : j.paths.flatMap(p =>
          p.aside === null || p.keptOn === null
            ? []
            : [
                {
                  path: p.path,
                  aside: p.aside,
                  moved: j.status === "written" ? p.moved : null,
                  keptOn: p.keptOn,
                },
              ],
        ),
  )

/** What a quiet read does with the kept asides. */
export interface AsidesPlanned {
  /** Asides holding what was moved: dropped. */
  readonly drop: readonly string[]
  /** Asides written through since: each recorded as a concurrent save of its path, then dropped. */
  readonly saves: readonly {
    readonly path: string
    readonly aside: string
    readonly on: PointId
  }[]
}

/**
 * Each kept aside (with its `lstat` now, in order) dropped when its inode,
 * size and mtime are as moved, recorded as a concurrent save when they
 * moved; one gone is nothing. A read the watcher sets off comes once the
 * folder, asides included, was quiet, so each is dealt with at once.
 */
export function planAsides(
  kept: readonly KeptAside[],
  now: readonly (InodeStat | null)[],
): AsidesPlanned {
  const drop: string[] = []
  const saves: AsidesPlanned["saves"][number][] = []
  for (const [i, k] of kept.entries()) {
    const stat = now[i] ?? null
    if (stat === null) continue
    if (k.moved !== null && isSameInode(stat, k.moved)) drop.push(k.aside)
    else saves.push({ path: k.path, aside: k.aside, on: k.keptOn })
  }
  return { drop, saves }
}
