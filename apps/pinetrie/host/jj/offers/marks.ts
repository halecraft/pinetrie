// host/jj/offers/marks — which lanes' offers a move the owner observed refreshes,
// pure. It stays in the host: it picks from the document's names and records.

import type { ThreadId, ThreadName } from "@pinetrie/core"
import type { Moved } from "@pinetrie/jj"

/**
 * What a move the owner observed marks for a refresh: accepted work's record,
 * and each lane whose offer it may change. Everything, accepted work, a WIP or
 * the first observation (`all`), marks every named lane whose root is not
 * archived, and every open record. An archived lane's refresh only withdraws an
 * offer it still has, and what still holds one, its ref, its offer bookmark or
 * an open record, marks it anyway. The publish bookmark (`line`) marks accepted
 * work's record alone. `@` alone (`yours`) marks no lane: it changes only each
 * record's `yourEdits` and accepted work's preview, which one shared read
 * rewrites (`shared`). A lane's ref marks that lane, and an offer bookmark the
 * lane its thread names.
 */
export function planMarks(input: {
  readonly moved: Moved
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  /** The named lanes whose root is archived. */
  readonly archived: ReadonlySet<ThreadId>
  /** Lanes with an open offer record: how an offer you abandoned is built again. */
  readonly open: readonly ThreadId[]
}): {
  readonly accepted: boolean
  /** Rewrite what `@` changes: each open record's `yourEdits`, and accepted work's record. */
  readonly shared: boolean
  readonly lanes: readonly ThreadId[]
} {
  const { moved } = input
  const every = moved.all
  const byName = new Map([...input.names].map(([lane, name]) => [name, lane]))
  const lanes = new Set<ThreadId>([
    ...(every
      ? [
          ...[...input.names.keys()].filter(l => !input.archived.has(l)),
          ...input.open,
        ]
      : []),
    ...moved.lanes,
    ...[...moved.offers].flatMap(name => {
      const lane = byName.get(name)
      return lane === undefined ? [] : [lane]
    }),
  ])
  return {
    accepted: every || moved.published,
    shared: !every && moved.yours,
    lanes: [...lanes],
  }
}
