// interface/ask-segments — what a column draws of each ask (ADR-0056): its
// work folded, and what that work holds. The column folds each ask's work
// (`segmentPath`), and the rail compacts the same stretches (`compactRail`):
// both draw `railLandmarks` apart, so a fold never hides what the rail draws
// on its own. Pure.

import {
  type AskIndex,
  type EntryId,
  lastWord,
  type RevisionRecord,
  type TreeIndex,
} from "@pinetrie/core"
import { statsOf, type WorkStats } from "./work-stats.ts"

/** What a column draws, in order: an entry as itself, or part of an ask's work folded. */
export type Segment =
  | { readonly kind: "entry"; readonly id: EntryId }
  | {
      readonly kind: "fold"
      readonly ask: EntryId
      readonly ids: readonly [EntryId, ...EntryId[]]
      /** The ask's first fold on this path: where story draws its summary and its files. */
      readonly first: boolean
    }

/**
 * A column's messages, `ids` in path order, as the column draws them: each
 * ask's work folded, except its last word and any of `landmarks`
 * (`railLandmarks`), which split the fold around them. A prompt, a message
 * no run wrote, and a landmark are drawn as themselves.
 *
 * So a column's segment edges are the landmarks and every ask's edges, and
 * the rail's stretch edges are the landmarks and long asks' edges: every
 * edge the rail draws is one here.
 */
export function segmentPath(
  index: TreeIndex,
  asks: AskIndex,
  ids: readonly EntryId[],
  landmarks: ReadonlySet<EntryId>,
): readonly Segment[] {
  const out: Segment[] = []
  const words = new Map<EntryId, EntryId | null>()
  const wordOf = (prompt: EntryId) => {
    if (!words.has(prompt)) words.set(prompt, lastWord(index, asks, prompt))
    return words.get(prompt)
  }
  const folded = new Set<EntryId>()
  for (const id of ids) {
    const ask = asks.askOf.get(id)
    if (ask === undefined || landmarks.has(id) || wordOf(ask) === id) {
      out.push({ kind: "entry", id })
      continue
    }
    const before = out.at(-1)
    if (before?.kind === "fold" && before.ask === ask) {
      out[out.length - 1] = { ...before, ids: [...before.ids, id] }
      continue
    }
    out.push({ kind: "fold", ask, ids: [id], first: !folded.has(ask) })
    folded.add(ask)
  }
  return out
}

/**
 * What an ask's work holds (`statsOf`): every agent message and tool result
 * its run wrote, wherever its column shows them. A long ask's capsule counts
 * the same messages (`compactRail`).
 */
export function askStats(
  index: TreeIndex,
  asks: AskIndex,
  prompt: EntryId,
  revisions: ReadonlyMap<EntryId, RevisionRecord>,
): WorkStats {
  const work = asks.work.get(prompt) ?? []
  const mine = new Set<EntryId>(work)
  const results = [...asks.askOf]
    .filter(([id, ask]) => ask === prompt && !mine.has(id))
    .map(([id]) => id)
  return statsOf(index, work, results, revisions)
}
