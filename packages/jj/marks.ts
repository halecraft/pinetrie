// marks — which lanes' proposed changes a move the owner observed refreshes,
// from the names and records the host reads of the session.

import type { ThreadId, ThreadName } from "@pinetrie/core"
import type { Moved } from "./observe.ts"

/**
 * What a move the owner observed marks for a refresh: accepted work's record,
 * and each lane whose proposed changes it may change. Everything, accepted
 * work, a WIP or the first observation (`all`), marks every named lane whose
 * root is not archived, and every open record. An archived lane's refresh only
 * withdraws an proposed changes it still has, and what still holds one, its
 * ref, its proposed bookmark or an open record, marks it anyway. The publish
 * bookmark (`line`) marks accepted work's record alone. `@` alone (`yours`)
 * marks no lane: it changes only each record's `workingCopyEdits` and accepted work's
 * preview, which one shared read rewrites (`shared`). A lane's ref marks that
 * lane, and proposed bookmark the lane its thread names.
 */
export function planMarks(input: {
  readonly moved: Moved
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  /** The named lanes whose root is archived. */
  readonly archived: ReadonlySet<ThreadId>
  /** Lanes with open record of the proposed changes: how proposed changes you abandoned are built again. */
  readonly open: readonly ThreadId[]
}): {
  readonly accepted: boolean
  /** Rewrite what `@` changes: each open record's `workingCopyEdits`, and accepted work's record. */
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
    ...[...moved.proposed].flatMap(name => {
      const lane = byName.get(name)
      return lane === undefined ? [] : [lane]
    }),
  ])
  return {
    accepted: every || moved.published,
    shared: !every && moved.workingCopy,
    lanes: [...lanes],
  }
}
