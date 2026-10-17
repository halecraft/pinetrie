// folder/merge — the path merge of two states into a disk, decided from what
// each side changed since their base and what each holds at those paths.
// The receiving disk holds `ours`; `theirs` is merged in. Gathered in two
// rounds: the paths whose facts are read (`pathsToGather`), then the paths
// whose content is compared (`pathsToCompare`), then planned.

import type { DiskChange, MergeStep, PathFact } from "@pinetrie/core"

/** What base, ours and theirs hold at one path. */
export interface PathFacts {
  readonly base: PathFact
  readonly ours: PathFact
  readonly theirs: PathFact
}

export interface MergeFacts {
  /** The paths base→ours changed. */
  readonly ours: readonly DiskChange[]
  /** The paths base→theirs changed. */
  readonly theirs: readonly DiskChange[]
  /** Each path `pathsToGather` names. */
  readonly facts: ReadonlyMap<string, PathFacts>
  /** The paths `pathsToCompare` names whose content ours and theirs hold alike. */
  readonly same: ReadonlySet<string>
}

export interface MergePlanned {
  readonly steps: readonly MergeStep[]
  /** Paths kept as ours, each the topmost of what clashed. */
  readonly conflicts: readonly string[]
}

const ABSENT: PathFact = { kind: "absent" }

/** `p`'s ancestors, nearest last: `a/b/c` gives `a`, `a/b`. */
const above = (p: string): readonly string[] => {
  const parts = p.split("/")
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"))
}

/**
 * The paths whose facts the plan reads: every path theirs changed, and
 * every path ours changed at one of them, above one or under one. A path
 * only ours changed, far from theirs, needs nothing: the disk holds it.
 */
export function pathsToGather(
  ours: readonly DiskChange[],
  theirs: readonly DiskChange[],
): readonly string[] {
  const t = new Set(theirs.map(c => c.path))
  const aboveT = new Set([...t].flatMap(above))
  const near = ours
    .map(c => c.path)
    .filter(p => t.has(p) || aboveT.has(p) || above(p).some(a => t.has(a)))
  return [...new Set([...t, ...near])].sort()
}

/**
 * The paths theirs changed where ours and theirs both hold a file of one
 * size: whether their content is alike decides between a step and none.
 */
export function pathsToCompare(
  theirs: readonly DiskChange[],
  facts: ReadonlyMap<string, PathFacts>,
): readonly string[] {
  return theirs
    .map(c => c.path)
    .filter(p => {
      const f = facts.get(p)
      return (
        f?.ours.kind === "file" &&
        f.theirs.kind === "file" &&
        f.ours.size === f.theirs.size
      )
    })
}

const isExec = (f: PathFact) => f.kind === "file" && f.exec

/** The mode step a file both sides hold needs: theirs' bit, when only theirs changed it. */
const modeStep = (p: string, f: PathFacts): MergeStep[] =>
  isExec(f.theirs) !== isExec(f.base) && isExec(f.ours) === isExec(f.base)
    ? [{ kind: "mode", path: p, exec: isExec(f.theirs) }]
    : []

type Decided =
  | { readonly kind: "steps"; readonly steps: readonly MergeStep[] }
  /** Its steps, and nothing under it is planned on its own: a tree taken whole, or gone. */
  | { readonly kind: "whole"; readonly steps: readonly MergeStep[] }
  | { readonly kind: "conflict"; readonly path: string }

/** A path theirs changed and ours did not, though ours may have changed under it. */
function theirsOnly(
  p: string,
  f: PathFacts,
  oursUnder: boolean,
  same: boolean,
): Decided {
  const t = f.theirs
  if (oursUnder && t.kind !== "dir") return { kind: "conflict", path: p }
  switch (t.kind) {
    case "absent":
      return { kind: "whole", steps: [{ kind: "delete", path: p }] }
    case "file":
      return same
        ? { kind: "steps", steps: modeStep(p, f) }
        : { kind: "steps", steps: [{ kind: "take", path: p }] }
    case "symlink":
      return { kind: "steps", steps: [{ kind: "take", path: p }] }
    case "dir":
      // A directory theirs made is taken whole: a renamed one is named in
      // a diff by its path alone, nothing under it.
      return f.base.kind === "dir" || oursUnder
        ? { kind: "steps", steps: [] }
        : { kind: "whole", steps: [{ kind: "take", path: p }] }
    case "other":
      return { kind: "conflict", path: p }
  }
}

/** A path both sides changed. */
function bothChanged(p: string, f: PathFacts, same: boolean): Decided {
  const { base, ours, theirs } = f
  const conflict: Decided = { kind: "conflict", path: p }
  if (ours.kind === "absent" && theirs.kind === "absent")
    return { kind: "steps", steps: [] }
  if (ours.kind === "dir" && theirs.kind === "dir")
    // Two directories made at one path: theirs' may be named alone, as a
    // renamed one is, so what is under it cannot be merged path by path.
    return base.kind === "dir" ? { kind: "steps", steps: [] } : conflict
  if (ours.kind === "symlink" && theirs.kind === "symlink")
    return ours.target === theirs.target
      ? { kind: "steps", steps: [] }
      : conflict
  if (ours.kind === "file" && theirs.kind === "file") {
    const mode = modeStep(p, f)
    if (same) return { kind: "steps", steps: mode }
    if (ours.content !== "text" || theirs.content !== "text") return conflict
    return { kind: "steps", steps: [{ kind: "text", path: p }, ...mode] }
  }
  return conflict
}

/**
 * What each path becomes: a path one side changed takes
 * that side (nothing, when it is ours); changed alike on both, nothing;
 * text changed on both, `git merge-file`; the executable bit, its own
 * field, from the side that changed it; anything else changed on both a
 * conflict, ours kept. The tree check: theirs changing what ours made no
 * longer a directory, or ours changing under what theirs made no longer
 * one, conflicts at the topmost path. A take of content ours holds already
 * is dropped, so the merge writes nothing the disk has.
 */
export function planPathMerge(facts: MergeFacts): MergePlanned {
  const oursChanged = new Set(facts.ours.map(c => c.path))
  const steps: MergeStep[] = []
  const conflicts: string[] = []
  /** Paths nothing under is planned: conflicted, taken whole, or deleted. */
  const done = new Set<string>()
  const factsAt = (p: string): PathFacts =>
    facts.facts.get(p) ?? { base: ABSENT, ours: ABSENT, theirs: ABSENT }
  /** Every directory above a path ours changed. */
  const aboveOurs = new Set([...oursChanged].flatMap(above))

  for (const p of [...new Set(facts.theirs.map(c => c.path))].sort()) {
    if (above(p).some(a => done.has(a))) continue
    // Ours made something above no longer a directory: what theirs changed
    // under it has nowhere to go.
    const clash = above(p).find(
      a => oursChanged.has(a) && factsAt(a).ours.kind !== "dir",
    )
    const decided: Decided =
      clash !== undefined
        ? { kind: "conflict", path: clash }
        : oursChanged.has(p)
          ? bothChanged(p, factsAt(p), facts.same.has(p))
          : theirsOnly(p, factsAt(p), aboveOurs.has(p), facts.same.has(p))
    if (decided.kind === "conflict") {
      if (!conflicts.includes(decided.path)) conflicts.push(decided.path)
      done.add(decided.path)
      continue
    }
    steps.push(...decided.steps)
    if (decided.kind === "whole") done.add(p)
  }
  return { steps, conflicts }
}
