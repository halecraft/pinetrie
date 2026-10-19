// lanes/shared — which shared directories apply to a project's lanes, and
// what the host does for each; and the links under the working copy that
// leave it, mounted where they resolve.

import path from "node:path"
import { WORKSPACE_ROOT } from "@pinetrie/core"
import type { Mount } from "./spec.ts"

/** Where a shared directory may never be: repos, pine·trie's own, dependencies. */
const NEVER_SHARED = [".git", ".jj", "node_modules"]

/**
 * Which shared directories apply, and what to do for them on the host, from
 * the settled list (the person's entries first, as the join puts them),
 * normalized and without duplicates. Refused: absolute paths, paths that leave the project, those
 * in `.git`, `.jj` or `node_modules`, and those holding files jj
 * tracks. A missing directory is created; one your repo does not already
 * ignore is added to its exclude file.
 */
export function planShared(facts: {
  readonly entries: readonly string[]
  /** Normalized paths that exist. */
  readonly exists: ReadonlySet<string>
  /** Normalized paths holding files jj tracks. */
  readonly tracked: ReadonlySet<string>
  /** Normalized paths your repo already ignores. */
  readonly ignored: ReadonlySet<string>
}): {
  readonly shared: readonly string[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
  readonly create: readonly string[]
  readonly exclude: readonly string[]
} {
  const { candidates, refused } = sharedCandidates(facts.entries)
  const shared = candidates.filter(p => !facts.tracked.has(p))
  return {
    shared,
    refused: [
      ...refused,
      ...candidates
        .filter(p => facts.tracked.has(p))
        .map(p => ({ path: p, reason: "it holds files jj tracks" })),
    ],
    create: shared.filter(p => !facts.exists.has(p)),
    exclude: shared.filter(p => !facts.ignored.has(p)),
  }
}

/**
 * The entries whose paths may be shared, normalized and each once, in order;
 * and those refused by their path alone. What they hold is for `planShared`
 * to judge, from what the host gathers of these candidates.
 */
export function sharedCandidates(entries: readonly string[]): {
  readonly candidates: readonly string[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
} {
  const candidates: string[] = []
  const refused: { path: string; reason: string }[] = []
  for (const given of entries) {
    const reason = sharedRefusal(given)
    if (reason !== null) refused.push({ path: given, reason })
    else if (!candidates.includes(normalShared(given)))
      candidates.push(normalShared(given))
  }
  return { candidates, refused }
}

/** A shared path as relative, normalized, with no trailing slash. */
export const normalShared = (given: string): string =>
  path.posix.normalize(given).replace(/\/+$/, "")

function sharedRefusal(given: string): string | null {
  if (given.trim() === "") return "it is empty"
  if (path.posix.isAbsolute(given)) return "it is absolute"
  const p = normalShared(given)
  if (p === "." || p === ".." || p.startsWith("../"))
    return "it leaves the project"
  const top = p.split("/")[0] ?? ""
  return NEVER_SHARED.includes(top) ? `it is inside ${top}` : null
}

/** A symlink in your working copy, relative to its root, and its stored target. */
export interface Link {
  readonly path: string
  readonly target: string
}

/**
 * The read-only mounts that let links leaving the project resolve in a lane.
 * For each relative target outside the root, the directory beside the
 * project's that holds it is mounted where it resolves from `/workspace`: the
 * whole directory, since a linked package resolves its own dependencies
 * through the `node_modules` of its repo. pinetrie's `link:` dependencies on
 * Kyneta resolve this way.
 */
export function planLinks(root: string, links: readonly Link[]): Mount[] {
  const found = new Map<string, string>()
  for (const link of links) {
    if (path.isAbsolute(link.target)) continue
    const source = path.resolve(root, path.dirname(link.path), link.target)
    const rel = path.relative(root, source)
    if (!rel.startsWith("..")) continue
    // `../../x/y` from the root: the top is `../../x`, beside an ancestor.
    const parts = rel.split(path.sep)
    const ups = parts.findIndex(p => p !== "..")
    if (ups < 0) continue
    const top = path.resolve(root, ...parts.slice(0, ups + 1))
    found.set(
      top,
      path.posix.resolve(WORKSPACE_ROOT, ...parts.slice(0, ups + 1)),
    )
  }
  return [...found.keys()].sort().map(source => ({
    source,
    target: found.get(source) ?? source,
    readonly: true,
  }))
}
