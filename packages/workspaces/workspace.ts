// workspaces/workspace — a lane's workspace: created, made sure of, forgotten.
//
// jj holds a lane's newest revision in its bookmark, and nothing else does:
// a workspace whose directory is gone is added again at the bookmark.

import { mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { type CommitId, commitId, type LaneName } from "@pineta/core"
import { describeFailure, jj, lines } from "./run.ts"
import { bookmarkName, workspaceDir } from "./where.ts"

/** What `ensureWorkspace` sees. */
export interface EnsureFacts {
  /** jj lists a workspace with the lane's name. */
  readonly listed: boolean
  /** Its directory is on disk. */
  readonly dirExists: boolean
  /** The lane's bookmark, or null if it has none. */
  readonly bookmark: CommitId | null
}

export type EnsureAction =
  /** jj lists it, but its directory is gone: forget it before adding it again. */
  | { readonly kind: "forget" }
  /** A directory jj does not list: clear it before adding. */
  | { readonly kind: "clear" }
  | { readonly kind: "add"; readonly at: CommitId }
  /** The guard at a run's start: a no-op unless someone rewrote the lane. */
  | { readonly kind: "updateStale" }

/**
 * What makes a lane's workspace usable before a run. Healthy, only the stale
 * guard; missing, added again at the bookmark; with no bookmark, nothing can
 * be done, and the caller says so.
 */
export function planEnsure(f: EnsureFacts): readonly EnsureAction[] {
  if (f.listed && f.dirExists) return [{ kind: "updateStale" }]
  if (f.bookmark === null) return []
  return [
    ...(f.listed ? [{ kind: "forget" as const }] : []),
    ...(f.dirExists ? [{ kind: "clear" as const }] : []),
    { kind: "add", at: f.bookmark },
  ]
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  )

/** The commit a lane's bookmark points at, or null. */
export async function bookmarkOf(
  root: string,
  lane: LaneName,
): Promise<CommitId | null> {
  const ran = await jj(root, [
    "log",
    "--ignore-working-copy",
    "--no-graph",
    "-r",
    `present(bookmarks(exact:"${bookmarkName(lane)}"))`,
    "-T",
    'commit_id ++ "\\n"',
  ])
  const id = ran.ok ? lines(ran.stdout)[0] : undefined
  return id === undefined ? null : commitId(id)
}

/** Point a lane's bookmark at `commit`, creating it if need be. */
export async function setBookmark(
  root: string,
  lane: LaneName,
  commit: CommitId,
): Promise<void> {
  const ran = await jj(root, [
    "bookmark",
    "set",
    "--allow-backwards",
    bookmarkName(lane),
    "-r",
    commit,
  ])
  if (!ran.ok) throw new Error(describeFailure("jj bookmark set", ran))
}

export async function gatherEnsure(
  root: string,
  lane: LaneName,
): Promise<EnsureFacts> {
  const list = await jj(root, [
    "workspace",
    "list",
    "--ignore-working-copy",
    "-T",
    'name ++ "\\n"',
  ])
  return {
    listed: list.ok && lines(list.stdout).includes(lane),
    dirExists: await exists(workspaceDir(root, lane)),
    bookmark: await bookmarkOf(root, lane),
  }
}

async function add(root: string, lane: LaneName, at: readonly CommitId[]) {
  const dir = workspaceDir(root, lane)
  await mkdir(path.dirname(dir), { recursive: true })
  const ran = await jj(root, [
    "workspace",
    "add",
    dir,
    "--name",
    lane,
    ...at.flatMap(c => ["-r", c]),
  ])
  if (!ran.ok) throw new Error(describeFailure("jj workspace add", ran))
}

/**
 * Carry out `planEnsure`. Returns whether the workspace was added, so the
 * caller runs setup: a directory added again has no dependencies.
 */
export async function ensureWorkspace(
  root: string,
  lane: LaneName,
): Promise<{ readonly added: boolean; readonly usable: boolean }> {
  const facts = await gatherEnsure(root, lane)
  const actions = planEnsure(facts)
  let added = false
  for (const action of actions) {
    switch (action.kind) {
      case "updateStale": {
        const ran = await jj(workspaceDir(root, lane), [
          "workspace",
          "update-stale",
        ])
        if (!ran.ok)
          throw new Error(describeFailure("jj workspace update-stale", ran))
        break
      }
      case "forget": {
        const ran = await jj(root, ["workspace", "forget", lane])
        if (!ran.ok)
          throw new Error(describeFailure("jj workspace forget", ran))
        break
      }
      case "clear":
        await rm(workspaceDir(root, lane), { recursive: true, force: true })
        break
      case "add":
        await add(root, lane, [action.at])
        added = true
        break
    }
  }
  return { added, usable: actions.length > 0 }
}

/**
 * A new lane's workspace, at `base`. A base with several parents (your `@` is
 * a merge) is committed once, empty, so the lane's base is one commit. The
 * lane's bookmark is set there; the base is returned.
 */
export async function createWorkspace(
  root: string,
  lane: LaneName,
  base: readonly CommitId[],
): Promise<CommitId> {
  await add(root, lane, base)
  const dir = workspaceDir(root, lane)
  let at = base[0]
  if (base.length !== 1 || at === undefined) {
    const commit = await jj(dir, ["commit", "-m", `base: ${lane}`])
    if (!commit.ok) throw new Error(describeFailure("jj commit", commit))
    const parent = await jj(dir, [
      "log",
      "--no-graph",
      "-r",
      "@-",
      "-T",
      'commit_id ++ "\\n"',
    ])
    const id = parent.ok ? lines(parent.stdout)[0] : undefined
    if (id === undefined)
      throw new Error(describeFailure("reading the base", parent))
    at = commitId(id)
  }
  await setBookmark(root, lane, at)
  return at
}

/** Forget a lane's workspace, remove its directory, and delete its bookmark. */
export async function forgetWorkspace(
  root: string,
  lane: LaneName,
): Promise<void> {
  const facts = await gatherEnsure(root, lane)
  if (facts.listed) {
    const ran = await jj(root, ["workspace", "forget", lane])
    if (!ran.ok) throw new Error(describeFailure("jj workspace forget", ran))
  }
  await rm(workspaceDir(root, lane), { recursive: true, force: true })
  if (facts.bookmark !== null) {
    const ran = await jj(root, ["bookmark", "delete", bookmarkName(lane)])
    if (!ran.ok) throw new Error(describeFailure("jj bookmark delete", ran))
  }
}
