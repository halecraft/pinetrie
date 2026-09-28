// core/work — where a lane works, and which files an entry had (ADR-0032).
//
// Every run's prompt, and every assistant message whose tool calls changed
// files, has a revision record. So one walk up from an entry finds both the
// lane it belongs to (the nearest record's) and its files (the nearest record
// with a commit). A lane that works directly records its prompts with no
// commit: it still counts as the lane above, but the walk passes it for files.

import type {
  CommitId,
  LaneName,
  LaneRecord,
  Position,
  ProjectRecord,
  RevisionRecord,
  WorkSetting,
} from "./index.ts"
import { ancestry, type TreeIndex } from "./tree.ts"

/** What is above an entry: the lane it belongs to, and the files it had. */
export interface Above {
  /** The nearest record's lane; null where no run has been. */
  readonly lane: LaneName | null
  /** The nearest recorded commit; null means your `@-`. */
  readonly commit: CommitId | null
}

/** The lane and files at `at`, from the revision records above it. */
export function nearestRevision(
  index: TreeIndex,
  revisions: ReadonlyMap<string, RevisionRecord>,
  at: Position,
): Above {
  if (at.kind === "root") return { lane: null, commit: null }
  let lane: LaneName | null = null
  for (const id of ancestry(index, at.id).path) {
    const record = revisions.get(id)
    if (record === undefined) continue
    lane ??= record.lane
    if (record.commit !== null) return { lane, commit: record.commit }
  }
  return { lane, commit: null }
}

/**
 * Where a new lane works: the send's choice, else the setting of the lane
 * above its fork point, else the project's default for a root lane. A project that cannot
 * have workspaces makes any "own copy" work directly in its root. Null with
 * no project: the host has no tools.
 */
export function workFor(input: {
  readonly choice: WorkSetting | null
  readonly above: LaneName | null
  readonly lanes: ReadonlyMap<string, LaneRecord>
  readonly project: ProjectRecord | null
}): WorkSetting | null {
  const { project } = input
  if (project === null) return null
  const wanted =
    input.choice ??
    (input.above === null ? undefined : input.lanes.get(input.above)?.work) ??
    null
  if (project.kind === "direct")
    return wanted?.kind === "direct"
      ? wanted
      : { kind: "direct", dir: project.root }
  if (wanted !== null) return wanted
  return project.rootDefault === "own"
    ? { kind: "own" }
    : { kind: "direct", dir: project.root }
}

/** Characters that may continue a path segment: a root followed by one is a longer name. */
const PATH_CHAR = /[\p{L}\p{N}._\-~@+]/u

/**
 * `text` with each root in `from` replaced by `to` where it is a whole path
 * prefix: not preceded by a path character, and followed by `/` or by a
 * character a path segment cannot continue with. A root inside a longer name
 * (`…/t-ab` for `…/t-a`), or inside a longer path (`/x/a/b` for `/a/b`), is
 * left alone. The longest root wins, and `to` takes part mapped to itself: a
 * lane's workspace lies inside the project, so without it the project's root
 * would claim the lane's own paths.
 */
export function rewritePaths(
  text: string,
  from: readonly string[],
  to: string,
): string {
  if (!from.some(r => r !== "" && r !== to)) return text
  const roots = [...new Set([...from, to])].filter(r => r !== "")
  roots.sort((a, b) => b.length - a.length)
  let out = ""
  let i = 0
  while (i < text.length) {
    const before = text[i - 1]
    const root =
      before !== undefined && PATH_CHAR.test(before)
        ? undefined
        : roots.find(r => text.startsWith(r, i))
    if (root !== undefined) {
      const next = text[i + root.length]
      if (next === undefined || !PATH_CHAR.test(next)) {
        out += to
        i += root.length
        continue
      }
    }
    out += text[i]
    i += 1
  }
  return out
}

/** Whether `root` is `path`'s directory or an ancestor of it. */
const under = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`)

/**
 * Whether an absolute `path` belongs to one of `others` rather than to `own`:
 * the longest root that holds it decides, as `rewritePaths` does, so a path in
 * a lane's workspace inside the project is the lane's own. A lane's file
 * tools refuse such a path, naming the same one under `own`.
 */
export function foreignRoot(
  path: string,
  others: readonly string[],
  own: string,
): string | null {
  let best: string | null = null
  for (const root of [...others, own])
    if (
      root !== "" &&
      under(path, root) &&
      (best === null || root.length > best.length)
    )
      best = root
  return best === null || best === own ? null : best
}
