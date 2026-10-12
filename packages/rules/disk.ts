// disk — what a turn did to its lane's disk, from its runs: each path's
// class, the recipes that made derived files, and the registry that keeps
// them on the disk. `.gitignore` says whether a path is source; the runs say
// whether an ignored path is derived or local. Nothing else is consulted.

import {
  type DerivedRoot,
  DISK_LISTED,
  DISK_OWN_ROOTS,
  type DiskDiff,
  type DiskPath,
  diskPath,
  EMPTY_REGISTRY,
  type FileHashes,
  isCache,
  isUnderAny,
  LANE_HOME_PATH,
  type ListedPaths,
  NO_SHARED,
  type Recipe,
  type RecipeCheck,
  type Registry,
  type RootEvidence,
  type RunRecord,
  type Stamp,
  stamp,
  type ToolWrites,
  type TurnDisk,
} from "@pinetrie/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"

/** What a path a turn wrote is. */
export type PathClass = "source" | "derived" | "local"

/** Paths never classed: pine·trie's own and the repos', but the lane's home (`LANE_HOME_PATH`). */
const isSkipped = (p: string, shared: readonly string[]): boolean =>
  isUnderAny(p, shared) ||
  (isUnderAny(p, DISK_OWN_ROOTS) && !isUnderAny(p, [LANE_HOME_PATH]))

const parentOf = (p: string): string | null => {
  const slash = p.lastIndexOf("/")
  return slash < 0 ? null : p.slice(0, slash)
}

/** `paths` with none under another, sorted. */
export function topmost(paths: Iterable<string>): string[] {
  const all = new Set(paths)
  return [...all]
    .filter(p => {
      for (let up = parentOf(p); up !== null; up = parentOf(up))
        if (all.has(up)) return false
      return true
    })
    .sort()
}

const listed = (paths: readonly string[]): ListedPaths => ({
  paths: paths.slice(0, DISK_LISTED),
  more: Math.max(0, paths.length - DISK_LISTED),
})

/**
 * The root a derived path is under: its topmost ignored directory, short of
 * the lane's home, whose top directories are each a root of their own.
 */
function derivedRoot(p: string, isIgnored: (p: string) => boolean): string {
  let root = p
  for (let up = parentOf(p); up !== null; up = parentOf(up)) {
    if (up === LANE_HOME_PATH || !isIgnored(up)) break
    root = up
  }
  return root
}

/**
 * The paths classing a turn's writes needs `.gitignore`'s answer for: what
 * its runs wrote (and the directories above, where a root may be), read
 * and looked for, and what its tools wrote.
 */
function pathsToCheck(input: {
  readonly runs: readonly RunRecord[]
  readonly toolWrites: ToolWrites
  readonly shared: readonly string[]
}): string[] {
  const all = new Set<string>(input.toolWrites)
  for (const run of input.runs) {
    for (const w of run.writes)
      for (let p: string | null = w.path; p !== null; p = parentOf(p))
        all.add(p)
    for (const p of run.reads) all.add(p)
    for (const p of run.missing) all.add(p)
  }
  return [...all].filter(p => !isSkipped(p, input.shared)).sort()
}

/** A run that made derived files, before its inputs are hashed. */
export interface MadeRecipe {
  readonly run: string
  readonly command: string
  readonly outputs: readonly DiskPath[]
  /** Files whose content keys it: hashed before the registry is written. */
  readonly inputs: readonly string[]
  readonly missing: readonly string[]
  readonly shared: Readonly<Record<string, Stamp>>
}

/** What a turn wrote, classed, and what the registry needs next. */
export interface ClassedWrites {
  readonly classes: ReadonlyMap<string, PathClass>
  readonly made: readonly MadeRecipe[]
  /** Each derived root the turn wrote under, with what it showed of it. */
  readonly roots: ReadonlyMap<string, RootEvidence>
  /** Registry roots the turn deleted whole. */
  readonly gone: readonly string[]
  readonly unignored: readonly string[]
  readonly leftovers: readonly string[]
}

/** What a turn wrote, to class: the paths to ask `.gitignore` about, then the classes. */
export interface WritesToClass {
  readonly paths: readonly string[]
  /**
   * The classes, given which of `paths` are ignored. Asking about a path
   * not among them throws: the two can never drift apart unseen.
   */
  classify(ignored: ReadonlySet<string>): ClassedWrites
}

/** A turn's runs and tool writes, to class (`classifyWrites`). */
export function writesToClass(input: {
  readonly runs: readonly RunRecord[]
  readonly toolWrites: ToolWrites
  readonly registry: Registry
  readonly shared: readonly string[]
  /** Paths the turn's commit changed. */
  readonly changed: readonly string[]
}): WritesToClass {
  const paths = pathsToCheck(input)
  const asked = new Set(paths)
  return {
    paths,
    classify: ignored =>
      classifyWrites({
        ...input,
        isIgnored: p => {
          if (!asked.has(p))
            throw new Error(`${p}: its .gitignore standing was never asked`)
          return ignored.has(p)
        },
      }),
  }
}

/** A run whose every event arrived: the only kind a recipe is made from. */
type CompleteRun = RunRecord & {
  readonly observed: { readonly kind: "complete" }
}

const isComplete = (run: RunRecord): run is CompleteRun =>
  run.observed.kind === "complete"

/** A recipe's run, command and shared reads, from a complete run only. */
const madeFrom = (run: CompleteRun) => ({
  run: run.id,
  command: run.command ?? "",
  shared: Object.fromEntries(
    run.shared.flatMap(a =>
      a.kind === "open" && !a.writable && a.stamp !== null
        ? [[a.path, a.stamp] as const]
        : [],
    ),
  ),
})

/**
 * Each path the turn's runs and tools wrote, classed:
 * - not ignored: source;
 * - ignored, written by a run that read source, and not edited in place by
 *   it (read before it wrote it): derived;
 * - ignored, and under a root the registry already holds: derived, as a
 *   later run rewriting an output leaves it its recipe's;
 * - otherwise local, and a write tool's ignored write always is, inside a
 *   derived root too.
 * A run's derived paths are made into roots: under a registry root, that
 * root; else their topmost ignored directory (`derivedRoot`).
 */
function classifyWrites(input: {
  readonly runs: readonly RunRecord[]
  readonly toolWrites: ToolWrites
  /** Whether `.gitignore` ignores a path `pathsToCheck` named. */
  readonly isIgnored: (p: string) => boolean
  readonly registry: Registry
  readonly shared: readonly string[]
  /** Paths the turn's commit changed. */
  readonly changed: readonly string[]
}): ClassedWrites {
  const { isIgnored, registry, shared } = input
  const known = Object.keys(registry.roots)
  const rootIn = (p: string, roots: readonly string[]) =>
    roots.find(r => p === r || p.startsWith(`${r}/`))
  const classes = new Map<string, PathClass>()
  const made: MadeRecipe[] = []
  const evidence = new Map<string, RootEvidence>()
  const unignored = new Set<string>()
  const sourceWritten = new Set<string>()
  const gone = new Set<string>()
  const deleted = new Set<string>()

  const show = (root: string, seen: RootEvidence) => {
    const was = evidence.get(root) ?? registry.roots[root]?.evidence ?? "none"
    evidence.set(
      root,
      was === "changed" || seen === "changed"
        ? "changed"
        : seen === "added" || was === "added"
          ? "added"
          : "none",
    )
  }

  for (const run of input.runs) {
    // A run that lost events derives nothing: its key could miss what it read.
    const complete = isComplete(run) ? run : null
    const readSource = run.reads.some(
      p => !isSkipped(p, shared) && !isIgnored(p),
    )
    const readFirst = new Set(run.reads)
    const derived: string[] = []
    for (const w of run.writes) {
      if (isSkipped(w.path, shared)) continue
      if (!isIgnored(w.path)) {
        classes.set(w.path, "source")
        if (!w.dir) sourceWritten.add(w.path)
        // A directory the run made, from source, that nothing ignores: named
        // at its top.
        if (readSource && w.dir && w.created) unignored.add(w.path)
        continue
      }
      const underKnown = rootIn(w.path, known)
      const isDerived =
        complete !== null &&
        ((readSource && !(readFirst.has(w.path) && !w.created)) ||
          underKnown !== undefined)
      classes.set(w.path, isDerived ? "derived" : "local")
      if (isDerived) derived.push(w.path)
    }
    for (const p of run.deletions) {
      if (isSkipped(p, shared)) continue
      deleted.add(p)
      if (known.includes(p)) gone.add(p)
      const root = rootIn(p, known)
      if (root !== undefined && root !== p) show(root, "changed")
    }
    if (derived.length === 0 || complete === null) continue
    const outputs = new Set<string>()
    const writeOf = new Map(run.writes.map(w => [w.path, w]))
    for (const p of derived) {
      const root = rootIn(p, known) ?? derivedRoot(p, isIgnored)
      outputs.add(root)
      const w = writeOf.get(p)
      // A root this run made shows nothing of a cache; one it found does.
      const rootMade =
        writeOf.get(root)?.created === true && !known.includes(root)
      if (!rootMade) show(root, w?.created === true ? "added" : "changed")
      else if (!evidence.has(root)) evidence.set(root, "none")
    }
    const isInput = (p: string) =>
      !isSkipped(p, shared) &&
      (!isIgnored(p) ||
        (isUnderAny(p, [LANE_HOME_PATH]) &&
          rootIn(p, [...known, ...outputs]) === undefined))
    made.push({
      ...madeFrom(complete),
      outputs: topmost(outputs).flatMap(o => diskPath(o) ?? []),
      inputs: complete.reads.filter(isInput).sort(),
      missing: complete.missing.filter(isInput).sort(),
    })
  }
  for (const p of input.toolWrites) {
    if (isSkipped(p, shared)) continue
    if (isIgnored(p)) classes.set(p, "local")
    else {
      classes.set(p, "source")
      sourceWritten.add(p)
    }
  }
  const changed = new Set(input.changed)
  return {
    classes,
    made,
    roots: evidence,
    gone: [...gone].sort(),
    unignored: topmost(unignored),
    leftovers: [...sourceWritten]
      .filter(p => !changed.has(p) && !deleted.has(p))
      .sort(),
  }
}

/** The file whose presence marks a directory a cache, by the Cache Directory Tagging specification. */
const CACHEDIR_TAG = "CACHEDIR.TAG"

/** A turn's registry, to key: the paths to hash, then the registry. */
export interface RegistryToKey {
  readonly paths: readonly string[]
  /**
   * The registry, given a hash or null for each of `paths`, as the helper
   * answers every path it is asked. A path missing from `hashes` throws:
   * an input never hashed would key as a failed lookup.
   */
  next(hashes: FileHashes): Registry
}

/**
 * The registry after a turn, to key: its new recipes' inputs, and each new
 * root's `CACHEDIR.TAG`, which marks it a cache.
 */
export function registryAfter(input: {
  readonly registry: Registry
  readonly writes: ClassedWrites
  /** The lane's image, by its tag. */
  readonly image: string
}): RegistryToKey {
  const roots = [...new Set(input.writes.made.flatMap(m => m.outputs))].sort()
  const tags = roots.map(r => `${r}/${CACHEDIR_TAG}`)
  const inputs = [...new Set(input.writes.made.flatMap(m => m.inputs))].sort()
  const paths = [...inputs, ...tags]
  return {
    paths,
    next: hashes => {
      const unasked = paths.find(p => !(p in hashes))
      if (unasked !== undefined) throw new Error(`${unasked} was never hashed`)
      return nextRegistry({
        ...input,
        hashes,
        tagged: new Set(
          roots.filter((_, i) => typeof hashes[tags[i] ?? ""] === "string"),
        ),
      })
    },
  }
}

/**
 * The registry after a turn: its new recipes keyed, each taking its outputs
 * from older recipes, which go once they have none; its roots' evidence;
 * and what the turn deleted whole gone from both. An input with no hash is
 * gone by the time it was hashed: it keys as missing.
 */
export function nextRegistry(input: {
  readonly registry: Registry
  readonly writes: ClassedWrites
  readonly hashes: FileHashes
  /** Roots that hold a `CACHEDIR.TAG`. */
  readonly tagged: ReadonlySet<string>
  /** The lane's image, by its tag. */
  readonly image: string
}): Registry {
  const { writes } = input
  const claimed = new Set([
    ...writes.made.flatMap(m => m.outputs),
    ...writes.gone,
  ])
  const isClaimed = (o: string) =>
    [...claimed].some(c => o === c || o.startsWith(`${c}/`))
  const older = input.registry.recipes
    .map(r => ({ ...r, outputs: r.outputs.filter(o => !isClaimed(o)) }))
    .filter(r => r.outputs.length > 0)
  const made: Recipe[] = writes.made.map(m => {
    const inputs: Record<string, string> = {}
    const missing = [...m.missing]
    for (const p of m.inputs) {
      const hash = input.hashes[p]
      if (typeof hash === "string") inputs[p] = hash
      else missing.push(p)
    }
    return {
      run: m.run,
      key: {
        command: m.command,
        image: input.image,
        inputs,
        missing: [...new Set(missing)].sort(),
        shared: m.shared,
      },
      outputs: m.outputs,
    }
  })
  const recipes = [...older, ...made]
  // A cache outlives the recipes that wrote it.
  const caches = Object.entries(input.registry.roots)
    .filter(([root, r]) => isCache(r) && !writes.gone.includes(root))
    .map(([root]) => root)
  const held = new Set([...recipes.flatMap(r => r.outputs), ...caches])
  const roots: Record<string, DerivedRoot> = {}
  for (const root of held) {
    const evidence =
      writes.roots.get(root) ?? input.registry.roots[root]?.evidence ?? "none"
    roots[root] = {
      evidence,
      tagged:
        input.tagged.has(root) || input.registry.roots[root]?.tagged === true,
    }
  }
  return { recipes, roots }
}

/**
 * A new disk's stale outputs: each recipe whose key broke (an
 * input, a failed lookup or a shared file changed, or another image), and
 * the paths of its outputs to delete, its caches kept. A recipe the check
 * did not answer for is broken. Outputs are `DiskPath`s, checked as the
 * registry is read, so none leaves the disk; and never pine·trie's or a
 * repo's own is deleted. The registry after drops the
 * broken recipes and every root they alone held, but caches.
 */
export function planStaleOutputs(input: {
  readonly registry: Registry
  readonly checks: readonly RecipeCheck[]
  /** The lane's image now, by its tag. */
  readonly image: string
}): { readonly remove: readonly DiskPath[]; readonly registry: Registry } {
  const { registry } = input
  const broken = new Set(
    registry.recipes
      .filter(r => {
        const check = input.checks.find(c => c.run === r.run)
        return (
          check === undefined ||
          check.broken !== null ||
          r.key.image !== input.image
        )
      })
      .map(r => r.run),
  )
  const recipes = registry.recipes.filter(r => !broken.has(r.run))
  const kept = new Set<string>(recipes.flatMap(r => r.outputs))
  const isKept = (root: string) => {
    const r = registry.roots[root]
    return kept.has(root) || (r !== undefined && isCache(r))
  }
  const remove = registry.recipes
    .filter(r => broken.has(r.run))
    .flatMap(r => r.outputs)
    .filter(o => !isKept(o) && !isSkipped(o, []))
  return {
    remove: [...new Set(remove)].sort(),
    registry: {
      recipes,
      roots: Object.fromEntries(
        Object.entries(registry.roots).filter(([root]) => isKept(root)),
      ),
    },
  }
}

/**
 * Paths of a turn's whole-disk diff that none of its runs or tools wrote: a
 * write from outside the lane, or a writer that escaped attribution. Their
 * `.gitignore` standing is still to read.
 */
export function unattributed(
  writes: ClassedWrites,
  diff: DiskDiff,
  shared: readonly string[],
): string[] {
  const written = [...writes.classes.keys()]
  return diff.changes
    .map(c => c.path)
    .filter(
      p =>
        !isSkipped(p, shared) &&
        !written.some(
          w => w === p || w.startsWith(`${p}/`) || p.startsWith(`${w}/`),
        ),
    )
}

/**
 * What a turn's record says of its disk: its classes, with the paths of its
 * diff no tool call wrote that `.gitignore` ignores counted local. The rest
 * of those are source, and in the commit.
 */
export function turnDisk(
  writes: ClassedWrites,
  unattributedIgnored: readonly string[],
): TurnDisk {
  const local = [...writes.classes]
    .filter(([, c]) => c === "local")
    .map(([p]) => p)
  return {
    derived: listed(topmost(writes.roots.keys())),
    local: listed(topmost([...local, ...unattributedIgnored])),
    unignored: writes.unignored,
    leftovers: writes.leftovers,
    // The host fills it in from the shared files' lineages (`planSharedLineages`).
    shared: NO_SHARED,
  }
}

const StampsSchema = Type.Record(Type.String(), Type.String())
const RegistrySchema = Type.Object({
  recipes: Type.Array(
    Type.Object({
      run: Type.String(),
      key: Type.Object({
        command: Type.String(),
        image: Type.String(),
        inputs: Type.Record(Type.String(), Type.String()),
        missing: Type.Array(Type.String()),
        shared: StampsSchema,
      }),
      outputs: Type.Array(Type.String()),
    }),
  ),
  roots: Type.Record(
    Type.String(),
    Type.Object({
      evidence: Type.Union([
        Type.Literal("none"),
        Type.Literal("added"),
        Type.Literal("changed"),
      ]),
      tagged: Type.Boolean(),
    }),
  ),
})

/** `recipes.json` as read: a broken or missing file is an empty registry. */
export function decodeRegistry(text: string | null): Registry {
  if (text === null) return EMPTY_REGISTRY
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return EMPTY_REGISTRY
  }
  return (
    decodeWith(RegistrySchema, json, r => ({
      recipes: r.recipes.map(recipe => ({
        ...recipe,
        // What pine·trie deletes comes from here: a path leaving the disk is
        // never one, whoever wrote the file.
        outputs: recipe.outputs.flatMap(o => diskPath(o) ?? []),
        key: {
          ...recipe.key,
          shared: Object.fromEntries(
            Object.entries(recipe.key.shared).map(([p, s]) => [p, stamp(s)]),
          ),
        },
      })),
      roots: r.roots,
    })) ?? EMPTY_REGISTRY
  )
}
