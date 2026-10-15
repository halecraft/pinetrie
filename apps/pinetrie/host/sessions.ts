// host/sessions — the session a host serves: its folder's real path looked
// up in the registry (`sessions.json` in pine·trie's data directory), under
// a lock, so hosts starting together each see the others' entries; and a
// session renamed (`pnpm session rename`). The rules are
// `@pinetrie/config`'s; this gathers, plans and writes.

import { randomUUID } from "node:crypto"
import { realpath as realpathCallback } from "node:fs"
import {
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises"
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

/**
 * realpath(3): through symlinks and, on a disk that ignores case, in the case
 * on disk, which Node's own walk of the path does not give.
 */
const realPath = promisify(realpathCallback.native)

/** How often a held lock is tried again, and for how long, in ms. */
const LOCK_RETRY = 50
const LOCK_WAIT = 5000

/** The registry and its lock, in pine·trie's data directory. */
export const registryFiles = (data: string) => ({
  registry: path.join(data, "sessions.json"),
  lock: path.join(data, "sessions.json.lock"),
  temp: path.join(data, "sessions.json.tmp"),
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

/** The pid file a served session holds, in its data directory. */
export const hostPidFile = (sessionDir: string): string =>
  path.join(sessionDir, "host.pid")

/**
 * Whether `pid` names a process. `EPERM` is another user's process: alive.
 * A pid the system has since reused for another process reads as alive.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

const readPid = async (file: string): Promise<number | null> => {
  const text = await readFile(file, "utf8").catch(() => null)
  const pid = text === null ? Number.NaN : Number.parseInt(text, 10)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

/** The live pid in `file`, or null when there is none or it names no process. */
export async function livePid(file: string): Promise<number | null> {
  const pid = await readPid(file)
  return pid !== null && isAlive(pid) ? pid : null
}

/**
 * Run `work` holding the registry's lock: a file holding this process's
 * pid, linked into place so it is never seen empty. A lock whose pid is
 * not alive is taken over; two processes taking one over at once can both
 * hold it, which needs a host to have died holding it first. Held for
 * longer than `LOCK_WAIT`, it is a problem, naming the lock's file.
 */
export async function withRegistryLock<T>(
  data: string,
  work: () => Promise<T>,
): Promise<T | { readonly refused: RegistryProblem }> {
  const { lock } = registryFiles(data)
  await mkdir(data, { recursive: true })
  // Unique even within one process, which may open two sessions at once.
  const mine = `${lock}.${process.pid}.${randomUUID()}`
  await writeFile(mine, `${process.pid}\n`)
  try {
    const until = Date.now() + LOCK_WAIT
    for (;;) {
      const taken = await link(mine, lock).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "EEXIST") return false
          throw error
        },
      )
      if (taken) break
      const holder = await readPid(lock)
      // A holder that died, or a file no pid is in, is stale.
      if (holder === null || !isAlive(holder)) {
        await rm(lock, { force: true })
        continue
      }
      if (Date.now() >= until)
        return { refused: { kind: "locked", file: lock, pid: holder } }
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY))
    }
  } finally {
    await rm(mine, { force: true })
  }
  try {
    return await work()
  } finally {
    await rm(lock, { force: true })
  }
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

/** Write the registry whole: a temporary file renamed over it, so no reader sees half. Under the lock only. */
export async function writeRegistry(
  data: string,
  registry: Registry,
): Promise<void> {
  const files = registryFiles(data)
  await writeFile(files.temp, encodeSessions(registry))
  await rename(files.temp, files.registry)
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
  /** Let go of `host.pid`, at the host's shutdown. */
  release(): Promise<void>
}

/** The entries of `dir`, or none when it does not exist. */
const entriesIn = (dir: string): Promise<readonly string[]> =>
  readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })

/** A file the session's directories hold, a `host.pid` naming no process aside; null when they hold none. */
async function heldFile(dirs: PinetrieDirs): Promise<string | null> {
  for (const dir of [dirs.data, dirs.config])
    for (const name of await entriesIn(dir)) {
      const file = path.join(dir, name)
      if (dir === dirs.data && name === "host.pid" && !(await livePid(file)))
        continue
      return file
    }
  return null
}

/**
 * Remove a session's directories, which must hold nothing but a stale
 * `host.pid`: `rmdir`, never a recursive delete, so a file written since
 * `heldFile` looked is kept, and named. Returns that file's directory, or
 * null once both are gone.
 */
export async function dropSessionDirs(
  dirs: PinetrieDirs,
): Promise<string | null> {
  await rm(hostPidFile(dirs.data), { force: true })
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
 * `host.pid` taken, all under the registry's lock so a rename cannot move
 * it in between. A refusal changes nothing but an empty directory.
 */
export async function openSession(input: {
  readonly root: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly dirs: PinetrieDirs
  readonly now?: () => number
}): Promise<
  OpenedSession | { readonly refused: SessionRefusal | RegistryProblem }
> {
  const { dirs, env, now = Date.now } = input
  const real = await realPath(input.root)
  const asked = env.PINETRIE_SESSION
  return withRegistryLock(dirs.data, async () => {
    const registry = await readRegistry(dirs.data)
    if ("refused" in registry) return registry
    const own = registry.entries.find(e => e.path === real)
    const plan = planSession(registry, {
      path: real,
      asked: asked === undefined || asked === "" ? null : asked,
      now: now(),
      gone: await gonePaths(registry),
      ownHolds:
        own === undefined ? null : await heldFile(sessionDirs(dirs, own.name)),
    })
    if (plan.kind === "refused") return { refused: plan.why }
    if (plan.kind === "attached" && plan.dropped !== null) {
      const kept = await dropSessionDirs(sessionDirs(dirs, plan.dropped))
      if (kept !== null)
        return {
          refused: {
            kind: "own-holds",
            asked: plan.entry.name,
            own: plan.dropped,
            file: kept,
          },
        }
    }
    await writeRegistry(dirs.data, plan.write)
    const dir = sessionDirs(dirs, plan.entry.name).data
    await mkdir(dir, { recursive: true })
    const release = await takeHostPid(hostPidFile(dir))
    return { name: plan.entry.name, path: real, dir, plan, release }
  })
}

/**
 * Write this process's pid to `file`, unless a live process holds it: a
 * second host on one folder is the store's to refuse, not this file's.
 * Returns what removes it again, which is nothing when another holds it.
 */
async function takeHostPid(file: string): Promise<() => Promise<void>> {
  if ((await livePid(file)) !== null) return async () => {}
  await rm(file, { force: true })
  await writeFile(file, `${process.pid}\n`, { flag: "wx" })
  return async () => {
    if ((await readPid(file)) === process.pid) await unlink(file)
  }
}

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
 * registry's lock, unless a live host holds its `host.pid`. The registry is
 * written last: a move that fails moves the first back, and the registry
 * still names the old name.
 */
export async function renameSession(
  dirs: PinetrieDirs,
  old: string,
  next: string,
): Promise<RenamePlan | { readonly refused: RegistryProblem }> {
  return withRegistryLock(dirs.data, async () => {
    const registry = await readRegistry(dirs.data)
    if ("refused" in registry) return registry
    const known = registry.entries.find(e => e.name === old)
    const servedBy =
      known === undefined
        ? null
        : await livePid(hostPidFile(sessionDirs(dirs, known.name).data))
    const plan = planRename(registry, old, next, servedBy)
    if (plan.kind === "refused") return plan
    const from = sessionDirs(dirs, plan.from)
    const to = sessionDirs(dirs, plan.to)
    await rm(hostPidFile(from.data), { force: true })
    const movedData = await moveDir(from.data, to.data)
    try {
      await moveDir(from.config, to.config)
    } catch (error) {
      if (movedData) await rename(to.data, from.data)
      throw error
    }
    await writeRegistry(dirs.data, plan.write)
    return plan
  })
}
