// lanes/host — what the host finds at startup, gathered, then planned by
// `planProjectDir` and `planShared`. What a
// runtime finds is the runtime's own.
//
// These are the one exception to "only `@pinetrie/repo` runs jj on your repo":
// they only read it (`jjIn`, git from its root), at startup, before the owner
// of your repo starts. Their one write is a file, your repo's exclude file
// (`planExclude`): `prepareProjectDir` adds `.pinetrie/` to it, and
// `prepareShared` the shared directories.
//
// Only jj can say where a jj repo is: a secondary workspace's `.jj/repo` is a
// file, and from a jj workspace nested in another repo, git names the outer
// one. So jj is asked first, git only when jj finds nothing, and
// no code looks for `.jj` or `.git` itself.

import {
  mkdir,
  readdir,
  readFile,
  readlink,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { errorText } from "@pinetrie/core"
import {
  type ConfigRead,
  EXCLUDE_LINE,
  IGNORE_FILE,
  LANE_GITCONFIG,
  type Link,
  laneGitConfig,
  laneIgnores,
  PROJECT_DIR,
  type ProjectDir,
  pinetrieDir,
  planExclude,
  planProjectDir,
  planShared,
  type RootFacts,
  type SharedDir,
  sharedCandidates,
} from "./plan.ts"
import { jjIn, lines, run } from "./run.ts"

/** Gather whether `dir` is a directory, then what jj, then git, say from it. */
async function gatherRoot(dir: string): Promise<RootFacts> {
  const none = { dir, jjRoot: null, gitTop: null, home: homedir() }
  const found = await stat(dir).catch(() => null)
  if (found?.isDirectory() !== true) return { ...none, isDirectory: false }
  const root = await jjIn(dir, ["workspace", "root", "--ignore-working-copy"])
  if (root.ok) return { ...none, isDirectory: true, jjRoot: root.stdout.trim() }
  const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd: dir })
  return {
    ...none,
    isDirectory: true,
    gitTop: top.ok ? top.stdout.trim() : null,
  }
}

/**
 * The project's root from `dir`, with `.pinetrie/` excluded in its repo before
 * anything is written there; or why `dir` cannot be a project. Run again on
 * the same folder, it writes nothing.
 */
export async function prepareProjectDir(dir: string): Promise<ProjectDir> {
  const planned = planProjectDir(await gatherRoot(dir))
  if (planned.kind === "refused" || planned.repo === null) return planned
  return (await excludeInYours(planned.root, [EXCLUDE_LINE]))
    ? planned
    : {
        kind: "refused",
        refusal: { kind: "unexcludable", root: planned.root },
      }
}

/**
 * Add `lines` to your repo's exclude file, found with
 * `git rev-parse --git-path info/exclude`, so what they name changes no
 * tracked file. False when the repo has no git directory beside it.
 */
async function excludeInYours(
  root: string,
  lines: readonly string[],
): Promise<boolean> {
  const where = await run("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
  })
  if (!where.ok) return false
  const file = path.resolve(root, where.stdout.trim())
  const next = planExclude(await readFile(file, "utf8").catch(() => ""), lines)
  if (next !== null) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, next)
  }
  return true
}

/** Read a JSON config file. Only a file that does not exist is `missing`. */
export async function readConfigFile(file: string): Promise<ConfigRead> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    return isMissing(error)
      ? { kind: "missing" }
      : { kind: "broken", reason: errorText(error) }
  }
  try {
    return { kind: "read", json: JSON.parse(text) as unknown }
  } catch (error) {
    return { kind: "broken", reason: errorText(error) }
  }
}

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT"

/** The user's lane config file: `$XDG_CONFIG_HOME/pinetrie/config.json`. */
export const userConfigFile = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string =>
  path.join(
    env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "pinetrie",
    "config.json",
  )

/**
 * Gather what `planShared` needs, plan, then execute: create missing
 * directories, add unignored ones to your repo's exclude file, and write the
 * lanes' ignore file (`laneIgnores`) in `pinetrieDir`'s `laneGit`. jj, not git's
 * index, says what is tracked: in a colocated repo the index can lag. Ignore
 * rules are git's, and jj applies them, the global file included.
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
  const ignoreDir = pinetrieDir(root).laneGit
  await mkdir(ignoreDir, { recursive: true })
  await writeFile(
    path.join(ignoreDir, IGNORE_FILE),
    laneIgnores(planned.shared),
  )
  await writeFile(path.join(ignoreDir, LANE_GITCONFIG), laneGitConfig())
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
      else if (depth < 3 && e.name !== PROJECT_DIR) await walk(child, depth + 1)
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
