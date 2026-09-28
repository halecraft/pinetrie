// workspaces/project — finding the project, and initializing it (ADR-0032).
//
// Only jj can say where a jj repo is: a secondary workspace's `.jj/repo` is a
// file, and from a jj workspace nested in another repo, git names the outer
// one (S36 item 17). So jj is asked first, git only when jj finds nothing, and
// no code looks for `.jj` or `.git` itself.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { ProjectRecord } from "@pineta/core"
import { describeFailure, git, jj, jjIn, lines } from "./run.ts"

/** What the host sees from where it runs. */
export interface ProjectFacts {
  /** The directory the host runs from. */
  readonly dir: string
  /** The jj workspace root jj names from `dir`, or null. */
  readonly jjRoot: string | null
  /** git's top level from `dir`, asked only when jj names nothing. */
  readonly gitTop: string | null
  readonly home: string
}

export type ProjectPlan =
  | { readonly kind: "use"; readonly root: string }
  /** `jj git init --colocate` in `dir`: git keeps working, and removing `.jj` undoes it. */
  | { readonly kind: "init"; readonly dir: string }
  | { readonly kind: "direct"; readonly root: string; readonly reason: string }

const unsafe = (dir: string, home: string): boolean =>
  path.resolve(dir) === path.resolve(home) ||
  path.resolve(dir) === path.parse(dir).root

/**
 * Where lanes' workspaces come from. Never your home directory or `/`,
 * whichever step would reach it: a home directory that is a dotfiles repo is
 * what git would name for any project below it with no repo of its own.
 */
export function planProject(f: ProjectFacts): ProjectPlan {
  const target = f.jjRoot ?? f.gitTop ?? f.dir
  if (unsafe(target, f.home))
    return {
      kind: "direct",
      root: f.dir,
      reason: `${target} is your home directory or the file system's root`,
    }
  if (f.jjRoot !== null) return { kind: "use", root: f.jjRoot }
  return { kind: "init", dir: target }
}

const EXCLUDE_LINE = "/workspace/"

/** git's exclude file with `/workspace/` in it, or null when it is already there. */
export function planExclude(current: string): string | null {
  if (lines(current).includes(EXCLUDE_LINE)) return null
  const base =
    current === "" || current.endsWith("\n") ? current : `${current}\n`
  return `${base}${EXCLUDE_LINE}\n`
}

export const PINETA_HEADS = 'bookmarks(glob:"pineta/*")'

/**
 * The repo's `immutable_heads()` with the lanes' bookmarks added, keeping
 * whatever it already was; null when they are already there.
 */
export function planImmutable(current: string): string | null {
  const now = current.trim()
  if (now.includes(PINETA_HEADS)) return null
  return now === "" ? PINETA_HEADS : `(${now}) | ${PINETA_HEADS}`
}

/** Gather what jj, then git, say from `dir`. */
export async function gatherProject(dir: string): Promise<ProjectFacts> {
  const root = await jjIn(dir, ["workspace", "root", "--ignore-working-copy"])
  if (root.ok)
    return { dir, jjRoot: root.stdout.trim(), gitTop: null, home: homedir() }
  const top = await git(dir, ["rev-parse", "--show-toplevel"])
  return {
    dir,
    jjRoot: null,
    gitTop: top.ok ? top.stdout.trim() : null,
    home: homedir(),
  }
}

/**
 * Find or initialize the project, then prepare it for workspaces: exclude
 * `workspace/` through git (so no tracked file changes, S36 item 16) and make
 * the lanes' bookmarks immutable. Any step jj or git refuses makes the project
 * `direct`, with the refusal as the reason: lanes then work in its root.
 */
export async function prepareProject(
  dir: string,
  log: (m: string) => void,
): Promise<ProjectRecord> {
  let plan = planProject(await gatherProject(dir))
  if (plan.kind === "init") {
    const init = await jjIn(plan.dir, ["git", "init", "--colocate"])
    if (!init.ok) return direct(dir, describeFailure("jj git init", init))
    log(`[host] initialized a jj repo in ${plan.dir}, colocated with git`)
    plan = planProject(await gatherProject(dir))
  }
  if (plan.kind === "direct") return plan
  if (plan.kind === "init")
    return direct(dir, "jj still finds no repo after initializing one")
  const root = plan.root

  const excludePath = await git(root, [
    "rev-parse",
    "--git-path",
    "info/exclude",
  ])
  if (!excludePath.ok)
    return direct(
      root,
      "the repo has no git directory beside it to exclude workspace/ in",
    )
  const file = path.resolve(root, excludePath.stdout.trim())
  const current = await readFile(file, "utf8").catch(() => "")
  const excluded = planExclude(current)
  if (excluded !== null) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, excluded)
  }

  const heads = await jj(root, [
    "config",
    "get",
    'revset-aliases."immutable_heads()"',
  ])
  const next = planImmutable(heads.ok ? heads.stdout : "")
  if (next !== null) {
    const set = await jj(root, [
      "config",
      "set",
      "--repo",
      'revset-aliases."immutable_heads()"',
      next,
    ])
    if (!set.ok) return direct(root, describeFailure("jj config set", set))
  }
  return { kind: "workspaces", root, rootDefault: "own" }
}

const direct = (root: string, reason: string): ProjectRecord => ({
  kind: "direct",
  root,
  reason,
})
