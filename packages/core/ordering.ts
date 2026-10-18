// core/ordering — the order new entries receive their arrival seq in: parents
// first, the same on every replica whatever order they arrived in.

export interface EntryOrdering {
  /** Ids in the order they should receive their arrival seq. */
  readonly ordered: readonly string[]
  /**
   * Candidates on a parent cycle, or below one. A parent outside the batch
   * never blocks a candidate, whether or not it exists. Returned rather than
   * thrown, so the caller decides what a cycle means.
   */
  readonly unresolved: readonly string[]
}

/**
 * Order a batch of newly-arrived entries: parents before children, with the
 * smallest id winning any tie.
 *
 * This is the derivation behind the arrival seq, and it is pure so that its
 * claim can be tested rather than asserted: the result must not depend on the
 * order the candidates arrive in. Two replicas seeing the same delta in
 * different orders must assign the same sequence, or stable cursors silently
 * skip entries.
 *
 * A candidate is ready at once when `parentOf` returns `null` or `undefined`,
 * or a parent that is not itself a candidate.
 */
export function orderNewEntries(
  candidates: Iterable<string>,
  parentOf: (id: string) => string | null | undefined,
): EntryOrdering {
  const pending = new Set(candidates)
  const children = new Map<string, string[]>()
  const queue: string[] = []

  for (const id of pending) {
    const parent = parentOf(id)
    if (parent === null || parent === undefined || !pending.has(parent)) {
      queue.push(id)
      continue
    }
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [id])
    else siblings.push(id)
  }

  // Kahn, popping the smallest available id each round. Sorting the frontier
  // — not the input — is what makes the result permutation-invariant.
  const ordered: string[] = []
  while (queue.length > 0) {
    queue.sort()
    const id = queue.shift()
    if (id === undefined || !pending.has(id)) continue
    pending.delete(id)
    ordered.push(id)
    for (const child of children.get(id) ?? []) queue.push(child)
  }

  return { ordered, unresolved: [...pending] }
}
