// machine/upkeep — the disk upkeep's next step, planned from what it
// gathered: a batch of the index's fill while it is incomplete, else at
// most `DELETIONS_PER_STEP` deletions and removals, and whether more
// remain. Bounded, so samples interleave and each step is planned against
// the latest facts.

import {
  type Deletable,
  deletableSnapshot,
  isThreadId,
  snapshotOwner,
  type ThreadId,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  partitionByOwner,
  RETENTION,
  type RetentionFacts,
} from "./retention.ts"
import type { SnapshotRow } from "./snapshot-index.ts"
import type { StoreListed } from "./store.ts"

/** The most deletions and removals one step makes. */
export const DELETIONS_PER_STEP = 200
/** The most roots one step of the index's fill reads. */
export const INDEX_ROOTS_PER_STEP = 10

/** Lane disks whose thread will never run again, never one running: no record, or in an archived canvas. */
export function deletableLanes(facts: {
  readonly lanes: readonly string[]
  readonly live: ReadonlySet<ThreadId>
  readonly running: ReadonlySet<string>
}): readonly ThreadId[] {
  return facts.lanes.filter(
    (lane): lane is ThreadId =>
      isThreadId(lane) && !facts.live.has(lane) && !facts.running.has(lane),
  )
}

const isOnWorkspace = (root: string) =>
  root === WORKSPACE_ROOT || root.startsWith(`${WORKSPACE_ROOT}/`)

/**
 * Each stopped nested lane's inner projects whose recorded root is not on
 * the lane's own disk: a root in its container's `/tmp`, or none, is gone
 * once the container stops, so no inner host can reach the project again.
 * One on the disk may be met by the next run's inner host, and stays.
 */
export function abandonedInnerProjects(facts: {
  readonly nested: StoreListed["nested"]
  readonly running: ReadonlySet<string>
}): readonly { readonly lane: string; readonly key: string }[] {
  return facts.nested.flatMap(n =>
    facts.running.has(n.lane)
      ? []
      : n.projects
          .filter(p => p.root === null || !isOnWorkspace(p.root))
          .map(p => ({ lane: n.lane, key: p.key })),
  )
}

export type UpkeepStep =
  /** Read these roots' records into the index; `complete` once none is left. */
  | {
      readonly kind: "fill"
      readonly roots: readonly string[]
      readonly complete: boolean
    }
  | {
      readonly kind: "delete"
      /** Kept or marked rows whose snapshot is gone already: marked deleted, nothing deleted. */
      readonly vanished: readonly Deletable<"entry">[]
      readonly snapshots: readonly Deletable<"entry">[]
      readonly lanes: readonly ThreadId[]
      readonly innerProjects: readonly {
        readonly lane: string
        readonly key: string
      }[]
      /** Some were left for the next step: another is queued. */
      readonly more: boolean
    }

/** What one step is planned from. */
export interface UpkeepFacts
  extends Omit<RetentionFacts, "limit" | "complete"> {
  readonly listing: StoreListed
  readonly complete: boolean
  /** Roots the fill has not read; empty once every one has been. */
  readonly unread: readonly string[]
  readonly live: ReadonlySet<ThreadId>
  readonly running: ReadonlySet<string>
}

/** The next bounded step. While the index is incomplete it fills, and deletes nothing. */
export function planUpkeepStep(facts: UpkeepFacts): UpkeepStep {
  if (!facts.complete) {
    const roots = facts.unread.slice(0, INDEX_ROOTS_PER_STEP)
    return {
      kind: "fill",
      roots,
      complete: facts.unread.length <= INDEX_ROOTS_PER_STEP,
    }
  }
  const owned = partitionByOwner(facts.listing.snapshots)
  const limit = DELETIONS_PER_STEP
  const ruled = { ...facts, limit }
  // Every owner's rule, each over its own names: only the entry rule deletes.
  const snapshots = [
    ...RETENTION.entry(owned.entry, ruled),
    ...RETENTION["folder-state"](owned["folder-state"], ruled),
    ...RETENTION.base(owned.base, ruled),
    ...RETENTION.unknown(owned.unknown, ruled),
  ]
  const lanes = deletableLanes({
    lanes: facts.listing.lanes,
    live: facts.live,
    running: facts.running,
  })
  const inner = abandonedInnerProjects({
    nested: facts.listing.nested,
    running: facts.running,
  })
  const room = Math.max(0, limit - snapshots.length)
  const lanesNow = lanes.slice(0, room)
  const innerNow = inner.slice(0, Math.max(0, room - lanesNow.length))
  const listed = new Set(facts.listing.snapshots)
  const vanished = facts.rows
    .filter(
      (r: SnapshotRow) =>
        (r.state === "kept" || r.state === "to-delete") &&
        !listed.has(r.snapshot) &&
        snapshotOwner(r.snapshot) === "entry",
    )
    .map(r => deletableSnapshot("entry", r.snapshot))
  return {
    kind: "delete",
    vanished,
    snapshots,
    lanes: lanesNow,
    innerProjects: innerNow,
    more:
      snapshots.length >= limit ||
      lanesNow.length < lanes.length ||
      innerNow.length < inner.length,
  }
}
