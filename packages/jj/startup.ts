// jj/startup — your repo as the host finds it at startup, before its owner
// starts: where the project's root is, the shared directories excluded in
// it, and a git repo made colocated. pine·trie writes nothing else in your
// repo.
//
// Only jj can say where a jj repo is: a secondary workspace's `.jj/repo` is a
// file, and from a jj workspace nested in another repo, git names the outer
// one. So jj is asked first, git only when jj finds nothing. A `.jj` or
// `.git` is looked for only when jj or git does not run, and then says only
// that version control is there, never where its root is.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import {
  hostJjVersion,
  jjRootAnswer,
  lines,
  type ProjectDir,
  type ProjectPlan,
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

/** The nearest `.jj` or `.git` in `dir` or above it, or null. */
async function vcsMarker(dir: string): Promise<string | null> {
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    for (const name of [".jj", ".git"]) {
      const marker = path.join(at, name)
      if (
        await stat(marker).then(
          () => true,
          () => false,
        )
      )
        return marker
    }
    if (path.dirname(at) === at) return null
  }
}

/** Gather whether `dir` is a directory, then what jj, then git, say from it. */
async function gatherRoot(dir: string): Promise<RootFacts> {
  const none = {
    dir,
    home: homedir(),
    jjVersion: null,
    jj: null,
    git: false,
    gitTop: null,
    gitBesideJj: false,
    vcsMarker: null,
  }
  const found = await stat(dir).catch(() => null)
  if (found?.isDirectory() !== true) return { ...none, isDirectory: false }
  const [jjVersion, git] = await Promise.all([
    hostJjVersion(),
    run("git", ["--version"]).then(ran => ran.ok),
  ])
  const jj =
    jjVersion === null
      ? null
      : jjRootAnswer(
          await jjIn(dir, ["workspace", "root", "--ignore-working-copy"]),
        )
  const jjRoot = jj?.kind === "root" ? jj.root : null
  const gitAsk = (args: readonly string[], cwd: string) =>
    git ? run("git", args, { cwd }) : null
  const top =
    jjRoot === null ? await gitAsk(["rev-parse", "--show-toplevel"], dir) : null
  const beside =
    jjRoot === null ? null : await gitAsk(["rev-parse", "--git-dir"], jjRoot)
  return {
    ...none,
    isDirectory: true,
    jjVersion,
    jj,
    git,
    gitTop: top?.ok === true ? top.stdout.trim() : null,
    gitBesideJj: beside?.ok === true,
    vcsMarker: jjVersion === null || !git ? await vcsMarker(dir) : null,
  }
}

/**
 * The project's root from `dir`, its kind, and what must happen before it is
 * one; or why `dir` cannot be a project. Writes nothing. A jj repo needs a git
 * directory beside it: lanes' history is fetched into your repo through git.
 */
export const prepareProjectDir = async (
  dir: string,
  options: { readonly tools: boolean },
): Promise<ProjectPlan> => planProjectDir(await gatherRoot(dir), options)

/**
 * Carry out `plan`: a git repo it names is made colocated, so it is a jj
 * project; or refused in jj's words, a git worktree among them.
 */
export async function settleProjectDir(plan: ProjectPlan): Promise<ProjectDir> {
  if (plan.kind === "refused") return plan
  if (plan.kind === "folder") return { kind: "folder", root: plan.root }
  if (!plan.colocate) return { kind: "jj", root: plan.root }
  const ran = await jjIn(plan.root, ["git", "init", "--colocate"])
  return ran.ok
    ? { kind: "jj", root: plan.root }
    : {
        kind: "refused",
        refusal: {
          kind: "colocate-failed",
          root: plan.root,
          said: lines(ran.stderr)[0] ?? `exit ${ran.code}`,
        },
      }
}

/**
 * Add `lines` to your repo's exclude file, found with
 * `git rev-parse --git-path info/exclude`, so what they name changes no
 * tracked file. Nothing without a git directory, which `prepareProjectDir`
 * refuses a jj project for.
 */
async function excludeInRepo(
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
    await excludeInRepo(
      root,
      planned.exclude.map(p => `/${p}/`),
    )
  return {
    shared: planned.shared.map(p => ({ path: p, source: path.join(root, p) })),
    refused: planned.refused,
  }
}
