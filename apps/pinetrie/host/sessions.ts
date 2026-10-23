// host/sessions — the session a host serves: its folder's real path looked
// up in the registry (`sessions.json` in pine·trie's data directory), under
// the registry's lock, so hosts starting together each see the others'
// entries, and the session's own lock held for the host's life; and a
// session renamed (`pnpm session rename`). The rules are
// `@pinetrie/config`'s; this gathers, plans and writes.

import { realpath as realpathCallback } from "node:fs"
import { mkdir, readdir, readFile, rename, rmdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import {
  decodeSessions,
  EMPTY_REGISTRY,
  encodeSessions,
  planRename,
  planSession,
  type Registry,
  type RegistryProblem,
  type RenamePlan,
  type SessionName,
  type SessionPlan,
  type SessionRefusal,
} from "@pinetrie/config"
import {
  type HeldLock,
  holderPid,
  type LockAttempt,
  type OnWaiting,
  removeLockFile,
  tryLock,
  withLock,
} from "@pinetrie/lock"
import { replaceFile } from "./replace-file.ts"

/**
 * realpath(3): through symlinks and, on a disk that ignores case, in the case
 * on disk, which Node's own walk of the path does not give.
 */
const realPath = promisify(realpathCallback.native)

/** The registry and its lock, in pine·trie's data directory. */
export const registryFiles = (data: string) => ({
  registry: path.join(data, "sessions.json"),
  lock: path.join(data, "sessions.json.lock"),
})

/** pine·trie's own directories (`places.dirs`). */
export interface PinetrieDirs {
  readonly data: string
  readonly config: string
}

/** A session's two directories: its data, and its local config's. */
export const sessionDirs = (
  dirs: PinetrieDirs,
  name: SessionName,
): PinetrieDirs => ({
  data: path.join(dirs.data, "sessions", name),
  config: path.join(dirs.config, "sessions", name),
})

/**
 * A served session's lock, in its data directory. Its file is `host.pid`,
 * as it was when it held only a pid: a new name would leave the old file in
 * every session's directory, which an attach would count as kept.
 */
export const sessionLockFile = (sessionDir: string): string =>
  path.join(sessionDir, "host.pid")

declare const registryLockedBrand: unique symbol
/** Proof the registry's lock is held: made only by `withRegistryLock`. */
export type RegistryLocked = { readonly [registryLockedBrand]: true }
const REGISTRY_LOCKED = {} as RegistryLocked

/**
 * Run `work` holding the registry's lock, waited for: `onWaiting` is told
 * once whom for. No timeout: a holder that hangs is named instead.
 */
async function withRegistryLock<T>(
  data: string,
  onWaiting: OnWaiting,
  work: (locked: RegistryLocked) => Promise<T>,
): Promise<T | { readonly refused: RegistryProblem }> {
  const { lock } = registryFiles(data)
  await mkdir(data, { recursive: true })
  const done = await withLock(
    lock,
    { platform: process.platform, writePid: true, onWaiting },
    () => work(REGISTRY_LOCKED),
  )
  return done.kind === "done"
    ? done.value
    : { refused: { kind: "lock-failed", file: lock, detail: done.detail } }
}

/**
 * The session's lock in `sessionDir` tried, which only a holder of the
 * registry's takes: so a rename never moves a session while it is taken.
 */
async function trySessionLock(
  _locked: RegistryLocked,
  sessionDir: string,
): Promise<LockAttempt> {
  await mkdir(sessionDir, { recursive: true })
  return tryLock(sessionLockFile(sessionDir), {
    platform: process.platform,
    heldWhile: "until-released",
    writePid: true,
  })
}

/** The registry in `data`: empty when there is none, a problem when it is not one. */
export async function readRegistry(
  data: string,
): Promise<Registry | { readonly refused: RegistryProblem }> {
  const { registry } = registryFiles(data)
  const text = await readFile(registry, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    },
  )
  if (text === null) return EMPTY_REGISTRY
  const decoded = decodeSessions(text)
  return "broken" in decoded
    ? { refused: { kind: "broken", file: registry, why: decoded.broken } }
    : decoded
}

/**
 * The session the folder at `folder` is registered as, its data directory
 * with it; null when no host has served it. Reads the registry, never
 * writes it, and takes no lock: a host opening the folder meanwhile registers
 * it, and is then refused by whatever the caller holds of the session.
 */
export async function sessionOfFolder(
  dirs: PinetrieDirs,
  folder: string,
): Promise<
  | { readonly name: SessionName; readonly dir: string }
  | null
  | { readonly refused: RegistryProblem }
> {
  const registry = await readRegistry(dirs.data)
  if ("refused" in registry) return registry
  const real = await realPath(folder)
  const entry = registry.entries.find(e => e.path === real)
  return entry === undefined
    ? null
    : { name: entry.name, dir: sessionDirs(dirs, entry.name).data }
}

/** Write the registry whole (`replaceFile`). */
export async function writeRegistry(
  _locked: RegistryLocked,
  data: string,
  registry: Registry,
): Promise<void> {
  await replaceFile(registryFiles(data).registry, encodeSessions(registry))
}

/** The paths of `registry`'s entries whose folder is gone, or no longer has that real path. */
async function gonePaths(registry: Registry): Promise<ReadonlySet<string>> {
  const gone = await Promise.all(
    registry.entries.map(async e =>
      (await realPath(e.path).catch(() => null)) === e.path ? null : e.path,
    ),
  )
  return new Set(gone.filter(p => p !== null))
}

export type OpenedPlan = Exclude<SessionPlan, { kind: "refused" }>

export interface OpenedSession {
  readonly name: SessionName
  /** The folder's real path. */
  readonly path: string
  /** The session's data directory. */
  readonly dir: string
  readonly plan: OpenedPlan
  /** Let go of the session's lock, at the host's shutdown. */
  releaseLock(): Promise<void>
  /** Settles if the session's lock went from under the host: it must stop. */
  readonly lockLost: Promise<void>
}

/** The entries of `dir`, or none when it does not exist. */
const entriesIn = (dir: string): Promise<readonly string[]> =>
  readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })

/** A file the session's directories keep, its lock's file aside; null when they keep none. */
async function keptSessionFile(dirs: PinetrieDirs): Promise<string | null> {
  for (const dir of [dirs.data, dirs.config])
    for (const name of await entriesIn(dir)) {
      const file = path.join(dir, name)
      if (file !== sessionLockFile(dirs.data)) return file
    }
  return null
}

/**
 * Remove a session's directories, which must keep nothing but its lock's
 * file, removed by `held`, its holder: `rmdir`, never a recursive delete, so
 * a file written since `keptSessionFile` looked is kept, and named. Returns
 * that file's directory, or null once both are gone.
 */
export async function dropSessionDirs(
  _locked: RegistryLocked,
  held: HeldLock,
  dirs: PinetrieDirs,
): Promise<string | null> {
  await removeLockFile(held)
  for (const dir of [dirs.data, dirs.config]) {
    const kept = await rmdir(dir).then(
      () => false,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false
        if (error.code === "ENOTEMPTY" || error.code === "EEXIST") return true
        throw error
      },
    )
    if (kept) return dir
  }
  return null
}

/**
 * The session for the folder at `root`, `env.PINETRIE_SESSION` attaching
 * it to one by name: the registry written, its data directory made, and its
 * lock held, all under the registry's lock so a rename cannot move it in
 * between. Each session the plan may pick or drop has its lock tried once,
 * before the plan: one another host holds is `served`. A refusal leaves
 * at most a session's directory made and its lock's file, and holds
 * nothing after it.
 */
export async function openSession(input: {
  readonly root: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly dirs: PinetrieDirs
  readonly onWaiting: OnWaiting
  readonly now?: () => number
}): Promise<
  OpenedSession | { readonly refused: SessionRefusal | RegistryProblem }
> {
  const { dirs, env, now = Date.now } = input
  const real = await realPath(input.root)
  const asked = env.PINETRIE_SESSION
  return withRegistryLock(dirs.data, input.onWaiting, async locked => {
    const registry = await readRegistry(dirs.data)
    if ("refused" in registry) return registry
    const own = registry.entries.find(e => e.path === real)
    const named = registry.entries.find(e => e.name === asked)
    const holds = new Map<SessionName, HeldLock>()
    let kept: SessionName | null = null
    try {
      const served = new Map<SessionName, number | null>()
      for (const name of new Set([own?.name, named?.name])) {
        if (name === undefined) continue
        const dir = sessionDirs(dirs, name).data
        const attempt = await trySessionLock(locked, dir)
        if (attempt.kind === "failed")
          return { refused: lockFailed(dir, attempt.detail) }
        if (attempt.kind === "held") holds.set(name, attempt)
        else served.set(name, await saidPidIn(dir))
      }
      const plan = planSession(registry, {
        path: real,
        asked: asked === undefined || asked === "" ? null : asked,
        now: now(),
        gone: await gonePaths(registry),
        ownHolds:
          own === undefined
            ? null
            : await keptSessionFile(sessionDirs(dirs, own.name)),
        served,
      })
      if (plan.kind === "refused") return { refused: plan.why }
      const dropped = plan.kind === "attached" ? plan.dropped : null
      const droppedHold = dropped === null ? undefined : holds.get(dropped)
      if (dropped !== null && droppedHold !== undefined) {
        holds.delete(dropped)
        const left = await dropSessionDirs(
          locked,
          droppedHold,
          sessionDirs(dirs, dropped),
        )
        if (left !== null)
          return {
            refused: {
              kind: "own-holds",
              asked: plan.entry.name,
              own: dropped,
              file: left,
            },
          }
      }
      const { name } = plan.entry
      const dir = sessionDirs(dirs, name).data
      // A new session's lock is first tried here, its directory new.
      const attempt = holds.get(name) ?? (await trySessionLock(locked, dir))
      if (attempt.kind === "failed")
        return { refused: lockFailed(dir, attempt.detail) }
      if (attempt.kind === "held-by-another")
        return {
          refused: {
            kind: "served",
            name,
            pid: await saidPidIn(dir),
          },
        }
      holds.set(name, attempt)
      await writeRegistry(locked, dirs.data, plan.write)
      kept = name
      return {
        name,
        path: real,
        dir,
        plan,
        releaseLock: () => attempt.release(),
        lockLost: attempt.lockLost,
      }
    } finally {
      // Every hold but the session's own, which the host keeps.
      for (const [name, held] of holds) if (name !== kept) await held.release()
    }
  })
}

/** The pid the session's lock holder wrote, as a refusal's words take it. */
const saidPidIn = async (dir: string): Promise<number | null> =>
  (await holderPid(sessionLockFile(dir)))?.saidPid ?? null

const lockFailed = (dir: string, detail: string): RegistryProblem => ({
  kind: "lock-failed",
  file: sessionLockFile(dir),
  detail,
})

/** Move `from` to `to`, unless `from` does not exist. Whether it moved. */
const moveDir = (from: string, to: string): Promise<boolean> =>
  mkdir(path.dirname(to), { recursive: true })
    .then(() => rename(from, to))
    .then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false
        throw error
      },
    )

/**
 * Rename the session `old` to `next`, with its two directories, under the
 * registry's lock, unless another host holds the session's lock. It holds
 * that lock while it moves the directories, and its file moves with the
 * data directory, held. The registry is written last: a move that fails
 * moves the first back, and the registry still names the old name.
 */
export async function renameSession(
  dirs: PinetrieDirs,
  old: string,
  next: string,
  onWaiting: OnWaiting,
): Promise<RenamePlan | { readonly refused: RegistryProblem }> {
  return withRegistryLock(dirs.data, onWaiting, async locked => {
    const registry = await readRegistry(dirs.data)
    if ("refused" in registry) return registry
    const known = registry.entries.find(e => e.name === old)
    const dir = known === undefined ? null : sessionDirs(dirs, known.name).data
    const attempt = dir === null ? null : await trySessionLock(locked, dir)
    if (dir !== null && attempt?.kind === "failed")
      return { refused: lockFailed(dir, attempt.detail) }
    try {
      const plan = planRename(
        registry,
        old,
        next,
        dir !== null && attempt?.kind === "held-by-another"
          ? { pid: await saidPidIn(dir) }
          : null,
      )
      if (plan.kind === "refused") return plan
      const from = sessionDirs(dirs, plan.from)
      const to = sessionDirs(dirs, plan.to)
      const movedData = await moveDir(from.data, to.data)
      try {
        await moveDir(from.config, to.config)
      } catch (error) {
        if (movedData) await rename(to.data, from.data)
        throw error
      }
      await writeRegistry(locked, dirs.data, plan.write)
      return plan
    } finally {
      if (attempt?.kind === "held") await attempt.release()
    }
  })
}
