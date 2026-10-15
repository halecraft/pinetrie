// folder/graph — a folder project's graph of states: ancestry, merge bases,
// how a base is had (one state, or several merged first), and whether a new
// state may be recorded. Every decision here reads only the records it is
// given.

import { createHash } from "node:crypto"
import {
  type BasePlan,
  isFolderStateId,
  type NonEmpty,
  type PointId,
  type StateMade,
  type StateRecord,
  type ThreadId,
} from "@pinetrie/core"

export interface StateGraph {
  readonly states: ReadonlyMap<PointId, StateRecord>
}

export const stateGraph = (records: readonly StateRecord[]): StateGraph => ({
  states: new Map(records.map(r => [r.id, r])),
})

/** `of` and every state below it, walking parents; empty for a state not in the graph. */
export function ancestors(g: StateGraph, of: PointId): ReadonlySet<PointId> {
  const seen = new Set<PointId>()
  const pending = [of]
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    const state = g.states.get(at)
    if (state === undefined || seen.has(at)) continue
    seen.add(at)
    pending.push(...state.parents)
  }
  return seen
}

/** Whether `a` is `b` or below it. */
export const isAncestor = (g: StateGraph, a: PointId, b: PointId): boolean =>
  ancestors(g, b).has(a)

const byId = (x: PointId, y: PointId) => (x < y ? -1 : x > y ? 1 : 0)

/** Whether a state is one of your folder's line's: a read, an accept or a restore. */
const isLineState = (r: StateRecord): boolean =>
  r.made.kind === "read" ||
  r.made.kind === "accept" ||
  r.made.kind === "restore"

/** The lane a state of a lane's own (a start, a turn, a catch-up) was made in; null for any other. */
const laneOf = (r: StateRecord): ThreadId | null =>
  r.made.kind === "start" ||
  r.made.kind === "turn" ||
  r.made.kind === "catch-up"
    ? r.made.lane
    : null

/**
 * `lane`'s newest state: the one of its own no other of its own has as its
 * first parent; null before its start. A lane's states are made one at a
 * time, on its queue.
 */
export function laneNewest(g: StateGraph, lane: ThreadId): PointId | null {
  const own = [...g.states.values()].filter(r => laneOf(r) === lane)
  const followed = new Set(own.flatMap(r => r.parents.slice(0, 1)))
  const heads = own.filter(r => !followed.has(r.id))
  if (heads.length > 1)
    throw new Error(
      `${lane} has ${heads.length} newest states: ${heads.map(r => r.id).join(", ")}`,
    )
  return heads[0]?.id ?? null
}

/**
 * The newest state of your folder's line that `of` holds by its own line:
 * walking first parents from `of`, the line state a start was restored
 * from, or a catch-up merged in. A lane branched from another's turn walks
 * on into that lane. Null when its line reaches none.
 */
export function folderStateHeld(g: StateGraph, of: PointId): PointId | null {
  const isLine = (p: PointId | undefined) => {
    const r = p === undefined ? undefined : g.states.get(p)
    return r !== undefined && isLineState(r)
  }
  for (let at = g.states.get(of); at !== undefined; ) {
    if (isLineState(at)) return at.id
    const [first, merged] = at.parents
    if (at.made.kind === "catch-up" && isLine(merged)) return merged ?? null
    if (isLine(first)) return first ?? null
    at = first === undefined ? undefined : g.states.get(first)
  }
  return null
}

/**
 * Your folder's newest state: the line state no other line state has as its
 * first parent, the line's states being made one at a time; null before
 * your folder's first read.
 */
export function folderNewest(g: StateGraph): PointId | null {
  const line = [...g.states.values()].filter(isLineState)
  const followed = new Set(line.flatMap(r => r.parents.slice(0, 1)))
  const heads = line.filter(r => !followed.has(r.id))
  if (heads.length > 1)
    throw new Error(
      `your folder's line has ${heads.length} newest states: ${heads.map(r => r.id).join(", ")}`,
    )
  return heads[0]?.id ?? null
}

/**
 * The lowest common ancestors of `a` and `b`, sorted: none below another,
 * and none when they share no state. The common ancestors are closed under
 * parents, so one of them is below another exactly when it is a parent of
 * one of them.
 */
export function mergeBases(
  g: StateGraph,
  a: PointId,
  b: PointId,
): readonly PointId[] {
  const ofB = ancestors(g, b)
  const common = [...ancestors(g, a)].filter(s => ofB.has(s))
  const below = new Set(common.flatMap(s => g.states.get(s)?.parents ?? []))
  return common.filter(s => !below.has(s)).sort(byId)
}

/** A virtual base's name: the same bases always name the same snapshot. */
export const virtualBaseName = (bases: readonly PointId[]): PointId =>
  `bases-${createHash("sha256")
    .update([...bases].sort(byId).join("\n"))
    .digest("hex")
    .slice(0, 32)}` as PointId

/**
 * How the base of `a` and `b` is had: their one merge base, or their bases
 * merged first, the lowest id first and each other merged in over its own
 * base with the first, as git's recursive strategy does. Null when they
 * share no state.
 */
export function planBase(
  g: StateGraph,
  a: PointId,
  b: PointId,
): BasePlan | null {
  const [first, ...rest] = mergeBases(g, a, b)
  if (first === undefined) return null
  const [next, ...more] = rest
  if (next === undefined) return { kind: "state", state: first }
  const merge = (other: PointId) => ({ base: planBase(g, first, other), other })
  const merges: NonEmpty<ReturnType<typeof merge>> = [
    merge(next),
    ...more.map(merge),
  ]
  return {
    kind: "virtual",
    name: virtualBaseName([first, ...rest]),
    first,
    merges,
  }
}

/**
 * A virtual base's record, recorded when a conflict names it so that every
 * base a conflict names is a state of the graph. Its parents are the bases
 * it merges.
 */
export const virtualBaseRecord = (
  plan: Extract<BasePlan, { readonly kind: "virtual" }>,
  at: number,
): StateRecord => ({
  id: plan.name,
  parents: [plan.first, ...plan.merges.map(m => m.other)],
  made: { kind: "bases-merged" },
  at,
  by: null,
})

/** What may be recorded of a proposed state. */
export type StatePlanned =
  | { readonly kind: "record"; readonly record: StateRecord }
  /** Recorded before with the same parents: a virtual base made again. */
  | { readonly kind: "recorded" }

/** Why a proposed state may not be recorded. */
export type StateRefusal =
  | { readonly kind: "refused"; readonly why: "not-a-state-id" }
  /** Its id is recorded with other parents: a recorded state never changes. */
  | { readonly kind: "refused"; readonly why: "id-in-use" }
  /** A parent is no state of this graph: every edge stays in one id space. */
  | {
      readonly kind: "refused"
      readonly why: "unknown-parent"
      readonly parent: PointId
    }
  /** Its parents' number contradicts how it was made, or one repeats. */
  | { readonly kind: "refused"; readonly why: "parents" }

/**
 * How many parents a state made so may have. A read has none only when the
 * graph has no state yet: your folder's first read.
 */
function isParentCount(made: StateMade, count: number, empty: boolean) {
  switch (made.kind) {
    case "read":
      return count === (empty ? 0 : 1)
    case "start":
    case "turn":
    case "restore":
      return count === 1
    case "catch-up":
    case "accept":
      return count === 2
    case "bases-merged":
      return count >= 2
  }
}

/** Whether `proposed` may join the graph, is in it already, or why not. */
export function planState(
  g: StateGraph,
  proposed: StateRecord,
): StatePlanned | StateRefusal {
  if (!isFolderStateId(proposed.id))
    return { kind: "refused", why: "not-a-state-id" }
  const was = g.states.get(proposed.id)
  if (was !== undefined)
    return was.parents.length === proposed.parents.length &&
      was.parents.every((p, i) => p === proposed.parents[i])
      ? { kind: "recorded" }
      : { kind: "refused", why: "id-in-use" }
  const parent = proposed.parents.find(p => !g.states.has(p))
  if (parent !== undefined)
    return { kind: "refused", why: "unknown-parent", parent }
  const count = proposed.parents.length
  if (
    new Set(proposed.parents).size !== count ||
    !isParentCount(proposed.made, count, g.states.size === 0)
  )
    return { kind: "refused", why: "parents" }
  return { kind: "record", record: proposed }
}
