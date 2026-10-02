// client/left — where this device last left each thread (ADR-0056): the tip
// of a column bound to the thread's lane, when its reader left it at its end.
// Kept on the device (`pineta-left:<session>`), shared by its tabs, never in
// the document. Pure.

import { ancestry, type TreeIndex } from "@pineta/core"
import { type Static, Type } from "typebox"
import { Value } from "typebox/value"

/** Per lane, the entry its column's end was at when this device left it. */
export type Left = ReadonlyMap<string, string>

/** Saves from two tabs merge: the one written last wins for its own lanes. */
export const mergeLeft = (stored: Left, value: Left): Left =>
  new Map([...stored, ...value])

/**
 * The message a "since you were here" line goes before: the first of `ids`,
 * a column's messages in path order, below the entry it was left at. That
 * entry can be no message (a tool's result, the lane's tip), so it is found
 * on the path, not among `ids`. None when it is not on the column's path, or
 * nothing came after it.
 */
export function leftLine(
  index: TreeIndex,
  at: string | undefined,
  ids: readonly string[],
): string | null {
  const end = ids.at(-1)
  if (at === undefined || end === undefined) return null
  const above = new Set(ancestry(index, at).path)
  if (!new Set(ancestry(index, end).path).has(at)) return null
  return ids.find(id => !above.has(id)) ?? null
}

// ── stored form ───────────────────────────────────────────────────────────

/** `v` changes when the shape does; an unknown one starts afresh. */
const StoredLeft = Type.Object({
  v: Type.Literal(1),
  lanes: Type.Record(Type.String(), Type.String()),
})

export const encodeLeft = (left: Left): Static<typeof StoredLeft> => ({
  v: 1,
  lanes: Object.fromEntries(left),
})

/** A stored record, whole or not at all. Total. */
export const decodeLeft = (raw: unknown): Left | undefined =>
  Value.Check(StoredLeft, raw) ? new Map(Object.entries(raw.lanes)) : undefined
