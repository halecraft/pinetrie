// workspaces/setup — a new workspace's dependencies (ADR-0032, S36).
//
// A pnpm repo installs from pnpm's own store, offline: 2–3 s here, from the
// lane's own lockfile, copy-on-write where the platform can (S36 item 27).
// Any other repo gets a copy-on-write clone of your working copy's
// `node_modules` directories. Either way, symlinks whose relative targets
// leave the workspace (`link:` dependencies outside the repo) are re-pointed
// to where they led from your working copy (S36 items 5 and 27).

import {
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { lines, run } from "./run.ts"

export type Setup =
  | { readonly kind: "pnpm" }
  /** Directories (relative to the project) to clone from your working copy. */
  | { readonly kind: "clone"; readonly dirs: readonly string[] }
  | { readonly kind: "none" }

/** How a workspace gets its dependencies. */
export function planSetup(input: {
  readonly pnpmLock: boolean
  readonly nodeModules: readonly string[]
}): Setup {
  if (input.pnpmLock) return { kind: "pnpm" }
  return input.nodeModules.length === 0
    ? { kind: "none" }
    : { kind: "clone", dirs: input.nodeModules }
}

export interface Link {
  /** The symlink, relative to the workspace. */
  readonly path: string
  /** What it points at, as stored. */
  readonly target: string
}

/**
 * The symlinks to re-point: each relative target that leads outside the
 * workspace, re-pointed absolutely to where it led from your working copy's
 * matching location. Targets inside the workspace, and absolute ones, stay.
 */
export function planRelink(
  links: readonly Link[],
  source: string,
  workspace: string,
): readonly Link[] {
  const inside = (p: string) =>
    p === workspace || p.startsWith(workspace + path.sep)
  return links.flatMap(link => {
    if (path.isAbsolute(link.target)) return []
    const from = path.dirname(link.path)
    if (inside(path.resolve(workspace, from, link.target))) return []
    return [
      { path: link.path, target: path.resolve(source, from, link.target) },
    ]
  })
}

const exists = (p: string) =>
  lstat(p).then(
    () => true,
    () => false,
  )

/** Every `node_modules` directory up to three levels down, never inside another. */
export async function findNodeModules(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(rel: string, depth: number): Promise<void> {
    const entries = await readdir(path.join(root, rel), {
      withFileTypes: true,
    }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".jj" || e.name === ".git") continue
      const child = path.join(rel, e.name)
      if (e.name === "node_modules") out.push(child)
      else if (depth < 3 && e.name !== "workspace") await walk(child, depth + 1)
    }
  }
  await walk("", 1)
  return out.sort()
}

/** Every symlink under the `node_modules` directories, except pnpm's own store links. */
async function gatherLinks(workspace: string): Promise<Link[]> {
  const out: Link[] = []
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(path.join(workspace, rel), {
      withFileTypes: true,
    }).catch(() => [])
    for (const e of entries) {
      const child = path.join(rel, e.name)
      if (e.isSymbolicLink())
        out.push({
          path: child,
          target: await readlink(path.join(workspace, child)),
        })
      else if (e.isDirectory() && e.name !== ".pnpm") await walk(child)
    }
  }
  for (const dir of await findNodeModules(workspace)) await walk(dir)
  return out
}

/** A copy-on-write copy of a directory tree: the one step that differs by platform. */
export const cloneTree = (src: string, dst: string) =>
  process.platform === "darwin"
    ? run("/bin/cp", ["-c", "-R", src, dst])
    : run("cp", ["-R", "--reflink=auto", src, dst])

/** Whether a clone here shares blocks: a forced copy-on-write copy of a small file. */
export async function probeClone(dir: string): Promise<boolean> {
  await mkdir(dir, { recursive: true })
  const a = path.join(dir, ".clone-probe")
  const b = path.join(dir, ".clone-probe-copy")
  await writeFile(a, "probe")
  const ran =
    process.platform === "darwin"
      ? await run("/bin/cp", ["-c", a, b])
      : await run("cp", ["--reflink=always", a, b])
  await rm(a, { force: true })
  await rm(b, { force: true })
  return ran.ok
}

/**
 * Give a new workspace its dependencies, then re-point links that leave it.
 * `source` is your working copy. Throws on a failure it cannot recover from;
 * the lane's tools then fail with that error rather than run half set up.
 */
export async function setUpWorkspace(
  source: string,
  workspace: string,
  log: (m: string) => void,
): Promise<void> {
  const plan = planSetup({
    pnpmLock: await exists(path.join(workspace, "pnpm-lock.yaml")),
    nodeModules: await findNodeModules(source),
  })
  if (plan.kind === "pnpm") {
    const store = await run("pnpm", ["store", "path"], { cwd: source })
    const storeArgs = store.ok
      ? ["--store-dir", lines(store.stdout)[0] ?? ""]
      : []
    const install = (offline: boolean) =>
      run(
        "pnpm",
        [
          "install",
          "--frozen-lockfile",
          ...(offline ? ["--offline"] : []),
          ...storeArgs,
        ],
        { cwd: workspace },
      )
    const offline = await install(true)
    if (!offline.ok) {
      log(`[host] offline install failed in ${workspace}; installing online`)
      const online = await install(false)
      if (!online.ok)
        throw new Error(`pnpm install failed: ${lines(online.stderr)[0] ?? ""}`)
    }
  } else if (plan.kind === "clone") {
    for (const dir of plan.dirs) {
      const dst = path.join(workspace, dir)
      await mkdir(path.dirname(dst), { recursive: true })
      const ran = await cloneTree(path.join(source, dir), dst)
      if (!ran.ok)
        throw new Error(`cloning ${dir} failed: ${lines(ran.stderr)[0] ?? ""}`)
    }
  }
  for (const link of planRelink(
    await gatherLinks(workspace),
    source,
    workspace,
  )) {
    const at = path.join(workspace, link.path)
    await rm(at, { force: true })
    await symlink(link.target, at)
  }
}
