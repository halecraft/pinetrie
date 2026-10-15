// jj/startup — your repo as the host finds it at startup, before its owner
// starts: where the project's root is, and the shared directories excluded
// in it. pine·trie writes nothing else in your repo.
//
// Only jj can say where a jj repo is: a secondary workspace's `.jj/repo` is a
// file, and from a jj workspace nested in another repo, git names the outer
// one. So jj is asked first, git only when jj finds nothing, and
// no code looks for `.jj` or `.git` itself.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import {
  lines,
  type ProjectDir,
  planExclude,
  planProjectDir,
  planShared,
  type RootFacts,
  run,
  type SharedDir,
  sharedCandidates,
} from "@pinetrie/lanes"
import { jjIn } from "./lane/run.ts"

/** A project whose folder is a jj workspace: the only kind jj's adapter starts on. */
export type JjProjectDir = Extract<ProjectDir, { readonly kind: "jj" }>

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
 * The project's root from `dir`, and its kind; or why `dir` cannot be a
 * project. Writes nothing. A jj repo needs a git directory beside it:
 * lanes' history is fetched into your repo through git.
 */
export async function prepareProjectDir(dir: string): Promise<ProjectDir> {
  const planned = planProjectDir(await gatherRoot(dir))
  if (planned.kind !== "jj") return planned
  const git = await run("git", ["rev-parse", "--git-dir"], {
    cwd: planned.root,
  })
  return git.ok
    ? planned
    : {
        kind: "refused",
        refusal: { kind: "not-colocated", root: planned.root },
      }
}

/**
 * Add `lines` to your repo's exclude file, found with
 * `git rev-parse --git-path info/exclude`, so what they name changes no
 * tracked file. Nothing without a git directory, which `prepareProjectDir`
 * refuses a jj project for.
 */
async function excludeInYours(
  root: string,
  lines: readonly string[],
): Promise<void> {
  const where = await run("git", ["rev-parse", "--git-path", "info/exclude"], {
    cwd: root,
  })
  if (!where.ok) return
  const file = path.resolve(root, where.stdout.trim())
  const next = planExclude(await readFile(file, "utf8").catch(() => ""), lines)
  if (next !== null) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, next)
  }
}

/**
 * Gather what `planShared` needs, plan, then execute: create missing
 * directories, and add unignored ones to your repo's exclude file. jj, not
 * git's index, says what is tracked: in a colocated repo the index can lag.
 * Ignore rules are git's, and jj applies them, the global file included.
 */
export async function prepareShared(
  root: string,
  entries: readonly string[],
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
  const planned = planShared({ entries, exists, tracked, ignored })
  for (const p of planned.create)
    await mkdir(path.join(root, p), { recursive: true })
  if (planned.exclude.length > 0)
    await excludeInYours(
      root,
      planned.exclude.map(p => `/${p}/`),
    )
  return {
    shared: planned.shared.map(p => ({ path: p, source: path.join(root, p) })),
    refused: planned.refused,
  }
}
