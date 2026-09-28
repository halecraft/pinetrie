// lanes/host — what the host finds at startup, gathered, then planned by
// `planRoot` and `planHost` (ADR-0034).
//
// Only jj can say where a jj repo is: a secondary workspace's `.jj/repo` is a
// file, and from a jj workspace nested in another repo, git names the outer
// one (S36 item 17). So jj is asked first, git only when jj finds nothing, and
// no code looks for `.jj` or `.git` itself.

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { ProjectRecord } from "@pineta/core"
import {
  type DiskPaths,
  extendImmutable,
  type HostFacts,
  type Link,
  PINETA_HEADS,
  planExclude,
  planHost,
  planRoot,
  type RootFacts,
} from "./plan.ts"
import {
  describeFailure,
  hostGit,
  hostJj,
  jjIn,
  type Runner,
  run,
} from "./run.ts"

/** Gather what jj, then git, say from `dir`. */
export async function gatherRoot(dir: string): Promise<RootFacts> {
  const root = await jjIn(dir, ["workspace", "root", "--ignore-working-copy"])
  if (root.ok)
    return { dir, jjRoot: root.stdout.trim(), gitTop: null, home: homedir() }
  const top = await hostGit(dir)(["rev-parse", "--show-toplevel"])
  return {
    dir,
    jjRoot: null,
    gitTop: top.ok ? top.stdout.trim() : null,
    home: homedir(),
  }
}

/** `container`'s own directory, from its status; null when it is not running. */
async function appRoot(): Promise<string | null> {
  const status = await run("container", [
    "system",
    "status",
    "--format",
    "json",
  ])
  if (!status.ok) return null
  try {
    const parsed = JSON.parse(status.stdout) as {
      status?: unknown
      paths?: { appRoot?: unknown }
    }
    return parsed.status === "running" &&
      typeof parsed.paths?.appRoot === "string"
      ? parsed.paths.appRoot
      : null
  } catch {
    return null
  }
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/**
 * Whether a clone into `dir` shares blocks: `/bin/cp -c` of a small file
 * fails across APFS volumes, where it cannot clone.
 */
async function probeClone(dir: string, near: string): Promise<boolean> {
  await mkdir(dir, { recursive: true })
  const a = path.join(near, ".pineta-clone-probe")
  const b = path.join(dir, ".clone-probe")
  try {
    await writeFile(a, "probe")
    return (await run("/bin/cp", ["-c", a, b])).ok
  } catch {
    return false
  } finally {
    await rm(a, { force: true })
    await rm(b, { force: true })
  }
}

/** Where lanes' disks and snapshots are, once `container` is known. */
export const diskPaths = (app: string, root: string): DiskPaths => ({
  volumes: path.join(app, "volumes"),
  snapshots: path.join(root, ".pineta", "snapshots"),
})

/**
 * What the host found, and where lanes' disks are when they have their own.
 * Any step that fails makes the project `direct`, naming the first failure.
 */
export async function prepareHost(dir: string): Promise<{
  readonly project: ProjectRecord
  readonly paths: DiskPaths | null
}> {
  const root = planRoot(await gatherRoot(dir))
  const installed = (await run("container", ["--version"])).ok
  const app = installed ? await appRoot() : null
  const facts: HostFacts = {
    root,
    installed,
    running: app !== null,
    kernel:
      app !== null &&
      (await lstat(path.join(app, "kernels", "default.kernel-arm64")).then(
        () => true,
        () => false,
      )),
    clones:
      app !== null &&
      "ok" in root &&
      (await exists(path.join(app, "volumes"))) &&
      (await probeClone(
        diskPaths(app, root.ok).snapshots,
        path.join(app, "volumes"),
      )),
  }
  const project = planHost(facts)
  if (project.kind === "direct" || app === null) return { project, paths: null }
  const excluded = await excludePineta(project.root)
  if (excluded !== null)
    return {
      project: { kind: "direct", root: project.root, reason: excluded },
      paths: null,
    }
  try {
    await protectLaneBookmarks(hostJj(project.root))
  } catch (error) {
    return {
      project: {
        kind: "direct",
        root: project.root,
        reason: error instanceof Error ? error.message : String(error),
      },
      paths: null,
    }
  }
  return { project, paths: diskPaths(app, project.root) }
}

/**
 * Add `/.pineta/` to git's exclude file, found with
 * `git rev-parse --git-path info/exclude`, so snapshots and the runtime change
 * no tracked file. Returns why it could not, or null.
 */
async function excludePineta(root: string): Promise<string | null> {
  const where = await hostGit(root)(["rev-parse", "--git-path", "info/exclude"])
  if (!where.ok)
    return "the repo has no git directory beside it to exclude .pineta/ in"
  const file = path.resolve(root, where.stdout.trim())
  const next = planExclude(await readFile(file, "utf8").catch(() => ""))
  if (next !== null) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, next)
  }
  return null
}

/**
 * Extend your repo's `immutable_heads()` with the lanes' bookmarks, keeping
 * whatever it was. `jj config get` returns the effective value, jj's
 * built-in default included.
 */
export async function protectLaneBookmarks(jj: Runner): Promise<void> {
  const heads = await jj([
    "config",
    "get",
    'revset-aliases."immutable_heads()"',
  ])
  const next = extendImmutable(heads.ok ? heads.stdout : "", PINETA_HEADS)
  if (next === null) return
  const set = await jj([
    "config",
    "set",
    "--repo",
    'revset-aliases."immutable_heads()"',
    next,
  ])
  if (!set.ok) throw new Error(describeFailure("jj config set", set))
}

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
      else if (depth < 3 && e.name !== ".pineta") await walk(child, depth + 1)
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
