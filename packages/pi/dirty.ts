// pi/dirty — which of `KynetaStorage`'s indexes a replayed change can
// invalidate.

import type { Segment } from "@kyneta/schema"

/** The root fields that back pi's `Storage` port. */
export type Field = "entries" | "usageRows" | "values" | "lists"

const FIELDS: readonly Field[] = ["entries", "usageRows", "values", "lists"]

const isField = (field: string): field is Field =>
  (FIELDS as readonly string[]).includes(field)

/** What one replayed change leaves to re-index. */
export type Dirty =
  | { readonly kind: "none" }
  | { readonly kind: "all" }
  | {
      readonly kind: "field"
      readonly field: Field
      readonly keys: readonly string[] | "all"
    }

/** What the next read must re-index: per field, some keys or all of them. */
export type Scope = Readonly<Record<Field, ReadonlySet<string> | "all">>

export const CLEAN: Scope = {
  entries: new Set(),
  usageRows: new Set(),
  values: new Set(),
  lists: new Set(),
}

export const EVERYTHING: Scope = {
  entries: "all",
  usageRows: "all",
  values: "all",
  lists: "all",
}

/**
 * The coordinate of a changefeed path segment, when it is a string key.
 * `coord()` is the accessor Kyneta's `Segment` interface documents. `.key` is
 * not on that interface: if Kyneta stopped materialising it, every replay
 * would silently re-index the whole document.
 */
const asKey = (segment: Segment | undefined): string | undefined => {
  if (segment === undefined) return undefined
  const coord = segment.coord()
  return typeof coord === "string" ? coord : undefined
}

/** Narrow a changefeed op to the map set/delete shape we act on. */
function asMapChange(
  change: unknown,
): { set?: Record<string, unknown>; delete?: string[] } | undefined {
  if (change === null || typeof change !== "object") return undefined
  const c = change as { type?: unknown; set?: unknown; delete?: unknown }
  if (c.type !== "map") return undefined
  return {
    set:
      c.set !== null && typeof c.set === "object"
        ? (c.set as Record<string, unknown>)
        : undefined,
    delete: Array.isArray(c.delete) ? (c.delete as string[]) : undefined,
  }
}

/**
 * Which of pi's indexes a replayed change can invalidate.
 *
 * Only pi's four fields back its `Storage` port, so only they are re-indexed;
 * every other root field (streams, runs, checkpoint text, and any added later)
 * is ignored. A change with no field replaces the whole document. A change
 * inside one item (`lists[key]…`) names its key in the path. The keys a map
 * change sets or deletes are re-indexed alone; a change of another shape
 * re-indexes the whole field. Kyneta's change union is broad, so only the
 * leading path segments and a map's keys are read.
 */
export function dirtyFrom(
  segments: readonly Segment[],
  change: unknown,
): Dirty {
  const field = asKey(segments[0])
  if (field === undefined) return { kind: "all" }
  if (!isField(field)) return { kind: "none" }
  const item = asKey(segments[1])
  if (item !== undefined) return { kind: "field", field, keys: [item] }
  const ch = asMapChange(change)
  // Entries and usage rows are only ever added, so a change that
  // sets none of them is unexpected, and re-indexes them all.
  if (field === "entries" || field === "usageRows")
    return {
      kind: "field",
      field,
      keys: ch?.set === undefined ? "all" : Object.keys(ch.set),
    }
  if (ch === undefined || (ch.set === undefined && ch.delete === undefined))
    return { kind: "field", field, keys: "all" }
  return {
    kind: "field",
    field,
    keys: [...Object.keys(ch.set ?? {}), ...(ch.delete ?? [])],
  }
}

/** One changeset's replayed changes, folded into a scope. */
export function scopeOf(
  changes: Iterable<{
    readonly path?: { readonly segments: readonly Segment[] }
    readonly change: unknown
  }>,
): Scope {
  const scope: Record<Field, Set<string> | "all"> = {
    entries: new Set(),
    usageRows: new Set(),
    values: new Set(),
    lists: new Set(),
  }
  for (const { path, change } of changes) {
    const dirty = dirtyFrom(path?.segments ?? [], change)
    if (dirty.kind === "none") continue
    if (dirty.kind === "all") return EVERYTHING
    const held = scope[dirty.field]
    if (held === "all") continue
    if (dirty.keys === "all") scope[dirty.field] = "all"
    else for (const key of dirty.keys) held.add(key)
  }
  return scope
}

const unite = (
  a: ReadonlySet<string> | "all",
  b: ReadonlySet<string> | "all",
): ReadonlySet<string> | "all" =>
  a === "all" || b === "all"
    ? "all"
    : b.size === 0
      ? a
      : a.size === 0
        ? b
        : new Set([...a, ...b])

/** Both scopes' keys, per field. */
export const join = (a: Scope, b: Scope): Scope => ({
  entries: unite(a.entries, b.entries),
  usageRows: unite(a.usageRows, b.usageRows),
  values: unite(a.values, b.values),
  lists: unite(a.lists, b.lists),
})

export const isClean = (scope: Scope): boolean =>
  FIELDS.every(field => {
    const keys = scope[field]
    return keys !== "all" && keys.size === 0
  })
