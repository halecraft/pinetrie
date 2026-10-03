// lanes/host — what the host finds at startup, gathered, then planned by
// `planRoot`, `planHost` and `planShared` (ADR-0034, ADR-0035).
//
// These are the one exception to "only `@pineta/repo` runs jj on your repo":
// they only read it (`jjIn`, git from its root), at startup, before anything
// else runs. Their one write is a file, `.git/info/exclude` (`planExclude`).
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
  decodeLaneConfig,
  type HostFacts,
  IGNORE_FILE,
  type LaneConfig,
  type Link,
  laneIgnoreDir,
  laneIgnores,
  planExclude,
  planHost,
  planRoot,
  planShared,
  type RootFacts,
  type SharedDir,
  sharedCandidates,
} from "./plan.ts"
import { jjIn, lines, run } from "./run.ts"

/** Gather what jj, then git, say from `dir`. */
async function gatherRoot(dir: string): Promise<RootFacts> {
  const root = await jjIn(dir, ["workspace", "root", "--ignore-working-copy"])
  if (root.ok)
    return { dir, jjRoot: root.stdout.trim(), gitTop: null, home: homedir() }
  const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir })
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
const diskPaths = (app: string, root: string): DiskPaths => ({
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
  // Snapshots and the runtime live under `.pineta/`: no tracked file changes.
  const excluded = await excludeInYours(project.root, ["/.pineta/"])
  if (excluded !== null)
    return {
      project: { kind: "direct", root: project.root, reason: excluded },
      paths: null,
    }
  return { project, paths: diskPaths(app, project.root) }
}

/**
 * Add `lines` to your repo's exclude file, found with
 * `git rev-parse --git-path info/exclude`, so what they name changes no
 * tracked file. Returns why it could not, or null.
 */
async function excludeInYours(
  root: string,
  lines: readonly string[],
): Promise<string | null> {
  const where = await run("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
  })
  if (!where.ok)
    return "the repo has no git directory beside it to exclude .pineta/ in"
  const file = path.resolve(root, where.stdout.trim())
  const next = planExclude(await readFile(file, "utf8").catch(() => ""), lines)
  if (next !== null) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, next)
  }
  return null
}

/** A lane config file, read and decoded; an empty one when missing or malformed. */
export async function readLaneConfig(
  file: string,
  root: string,
  pnpmLock: boolean,
): Promise<LaneConfig> {
  const json = await readFile(file, "utf8")
    .then(t => JSON.parse(t) as unknown)
    .catch(() => null)
  return decodeLaneConfig(json, root, pnpmLock)
}

/** The user's lane config file: `$XDG_CONFIG_HOME/pineta/config.json`. */
export const userConfigFile = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string =>
  path.join(
    env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "pineta",
    "config.json",
  )

/**
 * Gather what `planShared` needs, plan, then execute: create missing
 * directories, add unignored ones to your repo's exclude file, and write the
 * lanes' ignore file (`laneIgnores`) in `laneIgnoreDir`. jj, not git's
 * index, says what is tracked: in a colocated repo the index can lag. Ignore
 * rules are git's, and jj applies them, the global file included (S45).
 */
export async function prepareShared(
  root: string,
  entries: {
    readonly user: readonly string[]
    readonly project: readonly string[]
  },
): Promise<{
  readonly shared: readonly SharedDir[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
}> {
  const { candidates } = sharedCandidates(entries)
  const jj = (args: readonly string[]) => jjIn(root, args)
  const git = (args: readonly string[]) => run("git", args, { cwd: root })
  const exists = new Set<string>()
  const tracked = new Set<string>()
  const ignored = new Set<string>()
  for (const p of candidates) {
    if (
      await stat(path.join(root, p)).then(
        () => true,
        () => false,
      )
    )
      exists.add(p)
    const files = await jj([
      "file",
      "list",
      "--ignore-working-copy",
      "-r",
      "@",
      `root:${JSON.stringify(p)}`,
    ])
    if (files.ok && lines(files.stdout).length > 0) tracked.add(p)
    if ((await git(["check-ignore", "-q", "--no-index", `${p}/`])).ok)
      ignored.add(p)
  }
  const planned = planShared({ ...entries, exists, tracked, ignored })
  for (const p of planned.create)
    await mkdir(path.join(root, p), { recursive: true })
  if (planned.exclude.length > 0)
    await excludeInYours(
      root,
      planned.exclude.map(p => `/${p}/`),
    )
  const ignoreDir = laneIgnoreDir(root)
  await mkdir(ignoreDir, { recursive: true })
  await writeFile(
    path.join(ignoreDir, IGNORE_FILE),
    laneIgnores(planned.shared),
  )
  return {
    shared: planned.shared.map(p => ({ path: p, source: path.join(root, p) })),
    refused: planned.refused,
  }
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
