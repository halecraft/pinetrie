// host/work/shared-watch — your writes to the shared directories, seen as
// they are made. Each directory is watched on the host (`watch-dir.ts`, with
// no quiet window), and each file an event names is stat'ed into a stamp,
// which a lane reads alike (`stampTimeUs`): a version on its lineage, yours until a lane's turn reports the same stamp
// (`planSharedLineages`). Lanes' writes come by here too, through virtiofs or
// a bind mount; they are claimed when their turns are recorded. A dropped
// events error, and the start, scan each directory instead: what changed
// unseen is then a version too, and a file the scan does not find has its
// lineage let go (`SharedLineages.scanned`). A delete event lets nothing go:
// the next scan does, at the latest the next host's.

import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import { type Stamp, statStamp } from "@pinetrie/core"
import type { SharedDir } from "@pinetrie/lanes"
import type { SharedRead } from "@pinetrie/rules"
import { watchDir } from "../watch-dir.ts"
import type { SharedLineages } from "./shared.ts"

/** `file`'s path from the disk's root, under the shared directory holding it; null outside them. */
export function sharedPath(
  dirs: readonly SharedDir[],
  file: string,
): string | null {
  for (const d of dirs) {
    const rel = path.relative(d.source, file)
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel))
      return path.posix.join(d.path, ...rel.split(path.sep))
  }
  return null
}

/** A file's stamp as a lane reads it: its size and ctime. Null for no regular file. */
async function fileStamp(file: string): Promise<Stamp | null> {
  const st = await lstat(file, { bigint: true }).catch(() => null)
  return st?.isFile() ? statStamp(st) : null
}

/**
 * Every regular file under `dir`; none when `dir` is gone. Any other failure
 * throws: a listing that failed must never read as every file gone.
 */
export async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isMissing(error)) return []
    throw error
  })
  return entries
    .filter(e => e.isFile())
    .map(e => path.join(e.parentPath, e.name))
}

const isMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT"

interface SharedWatch {
  /** Watch `dirs`, and only them: at the start, and when accepted work's list moves. */
  sync(dirs: readonly SharedDir[]): Promise<void>
  close(): Promise<void>
}

export function startSharedWatch(deps: {
  readonly lineages: Pick<SharedLineages, "seen" | "scanned">
  readonly failed: (what: string) => (error: unknown) => void
}): SharedWatch {
  const watching = new Map<string, { unsubscribe(): Promise<void> }>()
  let dirs: readonly SharedDir[] = []

  /** Each of `files` under a shared directory, stamped; a file gone by now is left out. */
  async function stamped(files: readonly string[]): Promise<SharedRead[]> {
    const seen: SharedRead[] = []
    for (const file of files) {
      const at = sharedPath(dirs, file)
      const s = at === null ? null : await fileStamp(file)
      if (at !== null && s !== null) seen.push({ path: at, stamp: s })
    }
    return seen
  }

  const scan = (d: SharedDir) =>
    filesUnder(d.source)
      .then(stamped)
      .then(seen => deps.lineages.scanned(d.path, seen))
      .catch(deps.failed(`scanning ${d.path}/`))

  return {
    async sync(next) {
      dirs = next
      for (const [source, sub] of [...watching])
        if (!next.some(d => d.source === source)) {
          watching.delete(source)
          await sub.unsubscribe()
        }
      for (const d of next) {
        if (watching.has(d.source)) continue
        const sub = await watchDir({
          dir: d.source,
          quietMs: 0,
          onChange: change => {
            if (change.kind === "dropped") {
              void scan(d)
              return
            }
            void stamped(
              change.events.filter(e => e.type !== "delete").map(e => e.path),
            )
              .then(seen => deps.lineages.seen(seen))
              .catch(deps.failed(`watching ${d.path}/`))
          },
        })
        watching.set(d.source, sub)
        void scan(d)
      }
    },
    async close() {
      for (const sub of watching.values()) await sub.unsubscribe()
      watching.clear()
    },
  }
}
