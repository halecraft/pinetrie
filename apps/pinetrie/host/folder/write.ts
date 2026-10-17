// host/folder/write — a write's paths carried out in the project's folder,
// an accept's or a restore's, as `@pinetrie/folder` plans them: each path
// checked, moved aside, checked again and linked in, its journal written
// before each sub-step; and a failed or stopped write put back by its
// recovery's steps. A link fails where anything stands, so a save that
// lands by name during the write refuses it, and nothing is ever renamed
// over a file.

import { randomUUID } from "node:crypto"
import {
  link,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import {
  type FolderStamp,
  type InodeStat,
  type WriteJournal,
  type WritePath,
  writeAsideDir,
  writeStageDir,
} from "@pinetrie/core"
import {
  isSameInode,
  isStillOwn,
  type PathNow,
  planRecovery,
  type RecoveryStep,
  type StageEntry,
  type TargetFact,
  type WriteStep,
} from "@pinetrie/folder"

declare const allLinkedBrand: unique symbol
/**
 * Every path of a write linked. Only this module makes one: the one
 * proof that lets a write's state be recorded.
 */
export type AllLinked = {
  readonly write: string
  readonly [allLinkedBrand]: true
}

const allLinked = (journal: WriteJournal): AllLinked =>
  ({ write: journal.id }) as AllLinked

/** How a write's paths ended. */
type WritesDone =
  | { readonly kind: "linked"; readonly proof: AllLinked }
  /** A check or a link failed at `path`: the write is to be put back. */
  | { readonly kind: "failed"; readonly path: string; readonly why: string }

const lstatBig = (at: string) => lstat(at, { bigint: true }).catch(() => null)

const inodeStat = (s: {
  ino: bigint
  size: bigint
  mtimeNs: bigint
}): InodeStat => ({
  ino: Number(s.ino),
  size: Number(s.size),
  mtimeNs: String(s.mtimeNs),
})

/** What `lstat` says of `at` as an `InodeStat`; null for nothing there. */
export const readInodeStat = async (at: string): Promise<InodeStat | null> => {
  const s = await lstatBig(at)
  return s === null ? null : inodeStat(s)
}

/** Whether the target is what the read stamped: kind, size, ctime, mode and a link's target. */
async function isAsStamped(at: string, expected: FolderStamp) {
  const s = await lstatBig(at)
  if (s === null) return null
  const kind = s.isFile() ? "file" : s.isSymbolicLink() ? "symlink" : null
  const same =
    kind === expected.kind &&
    Number(s.size) === expected.size &&
    String(s.ctimeNs) === expected.ctimeNs &&
    (kind === "symlink"
      ? (await readlink(at).catch(() => null)) === expected.target
      : ((s.mode & 0o100n) !== 0n) === expected.exec)
  return same ? inodeStat(s) : null
}

/** Directories on `rel`'s way under `root` removed while empty, deepest first; one holding anything stays. */
async function pruneEmpty(root: string, rel: string) {
  for (let dir = path.posix.dirname(rel); dir !== "."; ) {
    const ok = await rmdir(path.join(root, dir)).then(
      () => true,
      () => false,
    )
    if (!ok) return
    dir = path.posix.dirname(dir)
  }
}

/**
 * `steps` carried out in `root`, one at a time, each of `journal`'s paths
 * (in the steps' order) saved before the sub-step it names: the check
 * against the read's stamp, the move aside, the check of the aside by
 * inode, size and mtime (a rename changes ctime), then the link, or for a
 * delete the empty directories it leaves. Answers `AllLinked`, or the
 * path that failed, the journal saved as far as it went.
 */
export async function executeWriteSteps(deps: {
  readonly root: string
  readonly journal: WriteJournal
  readonly steps: readonly WriteStep[]
  readonly save: (journal: WriteJournal) => Promise<void>
  /**
   * Each boundary between a path's sub-steps, as it is reached: the race
   * laws save there. A host passes none.
   */
  readonly reached?: (
    path: string,
    at: "checked" | "moved" | "linked",
  ) => Promise<void>
}): Promise<{ readonly done: WritesDone; readonly journal: WriteJournal }> {
  const { root, steps } = deps
  const reached = deps.reached ?? (async () => {})
  let journal = deps.journal
  const update = async (i: number, change: Partial<WritePath>) => {
    journal = {
      ...journal,
      paths: journal.paths.map((p, j) => (j === i ? { ...p, ...change } : p)),
    }
    await deps.save(journal)
  }
  const failed = (p: string, why: string) => ({
    done: { kind: "failed", path: p, why } as const,
    journal,
  })
  for (const [i, step] of steps.entries()) {
    const entry = journal.paths[i]
    if (entry === undefined || entry.path !== step.path)
      throw new Error(`the journal does not follow the steps at ${step.path}`)
    const target = path.join(root, step.path)
    if (step.kind !== "create") {
      const before = await isAsStamped(target, step.expected)
      if (before === null) return failed(step.path, "changed")
      if (entry.aside === null)
        throw new Error(`${step.path} has no aside to move to`)
      await update(i, { moved: before })
      await reached(step.path, "checked")
      const aside = path.join(root, entry.aside)
      await mkdir(path.dirname(aside), { recursive: true })
      const moved = await rename(target, aside).then(
        () => true,
        () => false,
      )
      if (!moved) return failed(step.path, "moved")
      const after = await lstatBig(aside)
      if (after === null || !isSameInode(inodeStat(after), before))
        return failed(step.path, "changed")
    }
    await reached(step.path, "moved")
    if (step.kind === "delete") {
      await pruneEmpty(root, step.path)
      await update(i, { linked: true })
      await reached(step.path, "linked")
      continue
    }
    await mkdir(path.dirname(target), { recursive: true })
    const linked = await (step.to.kind === "file"
      ? link(path.join(root, step.to.staged), target)
      : symlink(step.to.target, target)
    ).then(
      () => true,
      () => false,
    )
    if (!linked) return failed(step.path, "taken")
    await update(i, { linked: true })
    await reached(step.path, "linked")
  }
  return { done: { kind: "linked", proof: allLinked(journal) }, journal }
}

/** What `lstat` says at `at`; null for nothing there. */
async function targetFact(at: string): Promise<TargetFact | null> {
  const t = await lstatBig(at)
  if (t === null) return null
  return {
    kind: t.isFile() ? "file" : t.isSymbolicLink() ? "symlink" : "other",
    ...inodeStat(t),
    target: t.isSymbolicLink() ? await readlink(at).catch(() => null) : null,
  }
}

/** What the folder holds now at each of `journal`'s paths: its target and its aside. */
const gatherNow = (
  root: string,
  journal: WriteJournal,
): Promise<readonly PathNow[]> =>
  Promise.all(
    journal.paths.map(async p => {
      const a =
        p.aside === null ? null : await lstatBig(path.join(root, p.aside))
      return {
        target: await targetFact(path.join(root, p.path)),
        aside: a === null ? null : inodeStat(a),
      }
    }),
  )

/**
 * A recovery's steps carried out in `root`. Each checks again just before
 * it acts, so a save that came since the gather is never unlinked nor
 * covered: a link back fails where anything stands. Answers whether every
 * step held; one that did not leaves what it found, for a fresh gather.
 */
async function executeRecovery(
  root: string,
  steps: readonly RecoveryStep[],
): Promise<boolean> {
  let held = true
  for (const step of steps) {
    switch (step.kind) {
      case "unlink-own": {
        const at = path.join(root, step.path)
        if (isStillOwn(step.own, await targetFact(at))) await unlink(at)
        else held = false
        break
      }
      case "put-back": {
        const aside = path.join(root, step.aside)
        const at = path.join(root, step.path)
        await mkdir(path.dirname(at), { recursive: true })
        const back = await link(aside, at).then(
          () => true,
          () => false,
        )
        if (back) await unlink(aside)
        else held = false
        break
      }
      case "drop-aside":
        await unlink(path.join(root, step.aside)).catch(() => {})
        break
      case "drop-stage":
        await rm(path.join(root, writeStageDir(step.id)), {
          recursive: true,
          force: true,
        })
        await dropEmptyTree(path.join(root, writeAsideDir(step.id)))
        break
    }
  }
  return held
}

/** `dir` and the directories under it removed where empty, deepest first; a file keeps its own. */
export async function dropEmptyTree(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
  if (entries === null) return
  for (const e of entries)
    if (e.isDirectory()) await dropEmptyTree(path.join(dir, e.name))
  await rmdir(dir).catch(() => {})
}

/** The staging directory, walked by `lstat`: a symlink is never entered. */
export async function walkStage(stage: string): Promise<readonly StageEntry[]> {
  const found: StageEntry[] = []
  const pending = [""]
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    const entries = await readdir(path.join(stage, dir), {
      withFileTypes: true,
    })
    for (const e of entries) {
      const rel = dir === "" ? e.name : `${dir}/${e.name}`
      const s = await lstat(path.join(stage, rel), { bigint: true })
      const kind = s.isFile()
        ? "file"
        : s.isDirectory()
          ? "dir"
          : s.isSymbolicLink()
            ? "symlink"
            : "other"
      if (kind === "dir") pending.push(rel)
      found.push({ path: rel, kind, ...inodeStat(s) })
    }
  }
  return found
}

/**
 * Whether the disk `stage` is on folds case, probed with a file of a name
 * of its own looked up in the other case. `stage` must exist.
 */
export async function isCaseFolding(stage: string): Promise<boolean> {
  const name = `probe-${randomUUID()}`
  const at = path.join(stage, name)
  await writeFile(at, "")
  const folds = (await lstatBig(path.join(stage, name.toUpperCase()))) !== null
  await rm(at, { force: true })
  return folds
}

/** How many gathers a put back makes before it gives up on a folder that keeps changing under it. */
const RECOVERY_TRIES = 5

/** How a write that did not end, ended. */
type Recovered =
  /** Every path was linked: the write is to be committed. */
  | { readonly kind: "finish"; readonly proof: AllLinked }
  /** Put back; the journal as it ends, its kept asides' `keptOn` set. */
  | { readonly kind: "put-back"; readonly journal: WriteJournal }

/**
 * A write that failed or stopped, ended from its journal and what the
 * folder holds (`planRecovery`): finished when every path is linked, else
 * put back, gathered again after any step a save since made fail.
 */
export async function recoverWrite(
  root: string,
  journal: WriteJournal,
): Promise<Recovered> {
  for (let tries = 0; tries < RECOVERY_TRIES; tries++) {
    const plan = planRecovery(journal, await gatherNow(root, journal))
    if (plan.kind === "finish")
      return { kind: "finish", proof: allLinked(journal) }
    if (await executeRecovery(root, plan.steps))
      return { kind: "put-back", journal: plan.journal }
  }
  throw new Error(
    `the write ${journal.id} could not be put back: the project's folder kept changing under it`,
  )
}
