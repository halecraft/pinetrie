// reach — where a thread is, for another thread's agent to be asked there, to
// answer there, or for a link to open it.

import type {
  ArchivedCanvas,
  Away,
  CanvasId,
  CardRecord,
  Reach,
  ThreadId,
  ThreadName,
  WriterId,
} from "@pinetrie/core"
import { type CardOnCanvas, isLivePlace } from "./canvas-index.ts"

/** `thread`'s reach now, from its card's place and the archive. */
export function threadReach(
  thread: ThreadId,
  facts: {
    readonly cards: readonly CardRecord[]
    readonly archived: ReadonlyMap<CanvasId, ArchivedCanvas>
  },
): Reach {
  const place = facts.cards.find(c => c.id === thread)?.place
  if (place?.kind === "inventory") return { kind: "held", by: place.holder }
  if (place?.kind === "trash" && place.left.kind === "canvas")
    return { kind: "trashed", canvas: place.left.canvas }
  if (place?.kind !== "canvas") return { kind: "gone" }
  const record = facts.archived.get(place.canvas)
  return record === undefined
    ? { kind: "open", canvas: place.canvas }
    : { kind: "archived", canvas: place.canvas, record }
}

/** Where a late write of the host's goes: a thread, or a canvas (a title's). */
export type LateScope =
  | { readonly kind: "thread"; readonly thread: ThreadId }
  | { readonly kind: "canvas"; readonly canvas: CanvasId }

/**
 * Why a write the host decided before a gap may not land now, or null when
 * it may. A thread takes it when its card is at a live place
 * (`isLivePlace`), the rule its root is held by, so a write let through
 * finds its root loaded; otherwise its `threadReach` says why. That is not
 * `threadReach`'s own answer: it calls a thread trashed in an archived canvas
 * `trashed`, and one trashed from an inventory `gone`. A thread not opened
 * yet (named for a column before its first message) is in no canvas and has
 * no root, so it takes one too: its banner, drawn as it is named. A canvas
 * takes it unless it is archived.
 */
export function lateAway(
  scope: LateScope,
  facts: {
    readonly cards: readonly CardRecord[]
    readonly archived: ReadonlyMap<CanvasId, ArchivedCanvas>
    /** The threads opened: each with its record (`THREAD`). */
    readonly opened: { readonly has: (thread: ThreadId) => boolean }
  },
): Away | null {
  if (scope.kind === "canvas") {
    const record = facts.archived.get(scope.canvas)
    return record === undefined
      ? null
      : { kind: "archived", canvas: scope.canvas, record }
  }
  const card = facts.cards.find(c => c.id === scope.thread)
  if (card === undefined && !facts.opened.has(scope.thread)) return null
  if (card !== undefined && isLivePlace(card.place, facts.archived)) return null
  const reach = threadReach(scope.thread, facts)
  return reach.kind === "open" ? null : reach
}

/**
 * Every named thread on an open canvas, in each canvas's order: the
 * other threads' agents a message may name (`agentCandidates`, core). The
 * host and the page build their candidates from it alike.
 */
export function reachableAgents(input: {
  readonly cardsOn: ReadonlyMap<CanvasId, readonly CardOnCanvas[]>
  readonly archived: { readonly has: (canvas: CanvasId) => boolean }
  readonly names: ReadonlyMap<ThreadId, ThreadName>
}): readonly {
  readonly thread: ThreadId
  readonly name: ThreadName
  readonly canvas: CanvasId
}[] {
  return [...input.cardsOn].flatMap(([canvas, cards]) =>
    input.archived.has(canvas)
      ? []
      : cards.flatMap(c => {
          if (c.kind !== "thread") return []
          const name = input.names.get(c.id)
          return name === undefined ? [] : [{ thread: c.id, name, canvas }]
        }),
  )
}

/** Why `name` is out of reach, as a sentence. */
export function reachWords(
  name: string,
  reach: Away,
  nameOf: (w: WriterId) => string,
): string {
  switch (reach.kind) {
    case "archived":
      return `${name}'s canvas was archived by ${nameOf(reach.record.by)}`
    case "held":
      return `${nameOf(reach.by)} has ${name}`
    case "trashed":
      return `${name} is in the trash`
    case "gone":
      return `${name} is no longer on any canvas`
  }
}

/** Why a member is away, in a few words after its name. */
export function awayWords(
  reach: Away,
  nameOf: (w: WriterId) => string,
): string {
  switch (reach.kind) {
    case "archived":
      return `archived by ${nameOf(reach.record.by)}`
    case "held":
      return `${nameOf(reach.by)} has it`
    case "trashed":
      return "in the trash"
    case "gone":
      return "gone"
  }
}
