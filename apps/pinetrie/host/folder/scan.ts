// host/folder/scan — your folder's source paths, stamped: a walk by `lstat`
// that reads each directory's `.gitignore` as it enters it and never enters
// a directory that is ignored, so `node_modules` costs nothing. What is
// ignored is the lanes' own rule (`ignoredPaths`, with `laneIgnores`), so a
// read holds what a lane's diff counts as source. Symlinks are stamped,
// never followed. With the watcher (`watch.ts`) and the line (`line.ts`),
// the only code that touches your folder.

import { lstat, readdir, readFile, readlink } from "node:fs/promises"
import path from "node:path"
import type { FolderStamp } from "@pinetrie/core"
import { type IgnoreFile, ignoredPaths } from "@pinetrie/rules/ignores"

/** `rel`'s directory and every one above it, root (`""`) first. */
const dirsOf = (rel: string): readonly string[] => {
  if (rel === "") return [""]
  const parts = rel.split("/")
  return ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))]
}

/** A stamp of what `lstat` and `readlink` say; null for a directory or anything else. */
async function stampOf(at: string): Promise<FolderStamp | null> {
  const s = await lstat(at, { bigint: true }).catch(() => null)
  if (s === null) return null
  const base = { size: Number(s.size), ctimeNs: String(s.ctimeNs) }
  if (s.isFile())
    return { kind: "file", ...base, exec: (s.mode & 0o100n) !== 0n }
  if (s.isSymbolicLink())
    return { kind: "symlink", ...base, exec: false, target: await readlink(at) }
  return null
}

/**
 * Every source path under `root`, from it, with its stamp: what neither a
 * `.gitignore` on its way nor `own` ignores. A path that vanishes during
 * the walk is left out; the next read finds it gone or back.
 */
export async function scanFolder(input: {
  readonly root: string
  /** pine·trie's own patterns (`laneIgnores`), read as an excludes file at the root. */
  readonly own: string
}): Promise<ReadonlyMap<string, FolderStamp>> {
  const stamps = new Map<string, FolderStamp>()
  const ignores = new Map<string, IgnoreFile>()
  const pending = [""]
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    const abs = path.join(input.root, dir)
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
    const text = await readFile(path.join(abs, ".gitignore"), "utf8").catch(
      () => null,
    )
    if (text !== null) ignores.set(dir, { dir, text })
    const under = (name: string) => (dir === "" ? name : `${dir}/${name}`)
    const paths = entries.map(e => under(e.name))
    const dirs = new Set(
      entries.filter(e => e.isDirectory()).map(e => under(e.name)),
    )
    const ignored = ignoredPaths({
      files: dirsOf(dir).flatMap(d => {
        const f = ignores.get(d)
        return f === undefined ? [] : [f]
      }),
      own: input.own,
      paths,
      dirs,
    })
    for (const p of paths) {
      if (ignored.has(p)) continue
      if (dirs.has(p)) {
        pending.push(p)
        continue
      }
      const stamp = await stampOf(path.join(input.root, p))
      if (stamp !== null) stamps.set(p, stamp)
    }
  }
  return stamps
}
