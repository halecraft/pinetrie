// host/offers/marks — which lanes' offers a move the owner observed
// refreshes (ADR-0065), pure. It stays in the host: it picks from the
// document's names and records.

import type { LaneName, ThreadName } from "@pineta/core"
import type { Moved } from "@pineta/repo"

/**
 * What a move the owner observed marks for a refresh (ADR-0065): the line's
 * record, and each lane whose offer it may change. Everything, the line, a
 * WIP or the first observation (`all`), marks every named lane and every
 * open record. The publish bookmark (`line`) marks the line's record alone.
 * `@` alone (`yours`) marks no lane: it changes only each
 * record's `yourEdits` and the line's preview, which one shared read
 * rewrites (`shared`). A lane's ref marks that lane, and an offer bookmark
 * the lane its thread names.
 */
export function planMarks(input: {
  readonly moved: Moved
  readonly names: ReadonlyMap<LaneName, ThreadName>
  /** Lanes with an open offer record: how an offer you abandoned is built again. */
  readonly open: readonly LaneName[]
}): {
  readonly line: boolean
  /** Rewrite what `@` changes: each open record's `yourEdits`, and the line's record. */
  readonly shared: boolean
  readonly lanes: readonly LaneName[]
} {
  const { moved } = input
  const every = moved.all
  const byName = new Map([...input.names].map(([lane, name]) => [name, lane]))
  const lanes = new Set<LaneName>([
    ...(every ? [...input.names.keys(), ...input.open] : []),
    ...moved.lanes,
    ...[...moved.offers].flatMap(name => {
      const lane = byName.get(name)
      return lane === undefined ? [] : [lane]
    }),
  ])
  return {
    line: every || moved.line,
    shared: !every && moved.yours,
    lanes: [...lanes],
  }
}
