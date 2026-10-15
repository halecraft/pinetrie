// lanes/host — what the host reads of its own machine at startup: the links
// under your working copy's `node_modules` (`gatherLinks`). Your repo's own
// reads and writes at startup are `@pinetrie/jj`'s (`startup.ts`).

import { readdir, readlink } from "node:fs/promises"
import path from "node:path"
import type { Link } from "./plan.ts"

/** Every `node_modules` directory up to three levels down, never inside another. */
async function findNodeModules(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(rel: string, depth: number): Promise<void> {
    const entries = await readdir(path.join(root, rel), {
      withFileTypes: true,
    }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".jj" || e.name === ".git") continue
      const child = path.join(rel, e.name)
      if (e.name === "node_modules") out.push(child)
      else if (depth < 3) await walk(child, depth + 1)
    }
  }
  await walk("", 1)
  return out.sort()
}

/**
 * Every symlink under your working copy's `node_modules` directories, except
 * pnpm's own store links: what `planLinks` looks through for `link:`
 * dependencies outside the project.
 */
export async function gatherLinks(root: string): Promise<Link[]> {
  const out: Link[] = []
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(path.join(root, rel), {
      withFileTypes: true,
    }).catch(() => [])
    for (const e of entries) {
      const child = path.join(rel, e.name)
      if (e.isSymbolicLink())
        out.push({
          path: child,
          target: await readlink(path.join(root, child)),
        })
      else if (e.isDirectory() && e.name !== ".pnpm") await walk(child)
    }
  }
  for (const dir of await findNodeModules(root)) await walk(dir)
  return out
}
