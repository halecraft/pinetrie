// client/use-attention — what needs you, and where (ADR-0077): the shell
// over `attention.ts`. It reads your attention document, decides each
// root's status, and keeps what changed as you watched long enough for its
// mark to move (`moving`). The decisions are `attention.ts`'s.

import {
  type EntryId,
  isBusy,
  type LaneName,
  type LaneView,
  type RootId,
  type RootRecord,
  type VerdictRecord,
  type WriterId,
} from "@pineta/core"
import type { AttentionStore } from "@pineta/session"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { OpenOffer } from "./app-view.ts"
import {
  arrivals,
  attentionOf,
  doneRoots,
  type Item,
  type Level,
  type Moments,
  markOf,
  rootStatus,
  type Status,
  threadWriters,
} from "./attention.ts"
import { type Layout, unlisted } from "./layout.ts"

export interface AttentionView {
  /** Everything raised for you (`attentionOf`). */
  readonly items: readonly Item[]
  readonly status: ReadonlyMap<EntryId, Status>
  /** ▦'s: the highest status of roots not in your list (`markOf`). */
  readonly elsewhere: Level | null
  readonly arrivals: Moments
}

const NO_MOMENTS: Moments = { arrived: new Map(), done: new Map() }

export function useAttention(input: {
  readonly me: WriterId
  readonly attention: AttentionStore
  readonly directory: ReadonlyMap<RootId, RootRecord>
  readonly verdicts: ReadonlyMap<LaneName, VerdictRecord>
  readonly offers: readonly OpenOffer[]
  /** Lanes running in any root (`readRunningLanes`). */
  readonly running: readonly { readonly lane: LaneName }[]
  /** The held roots' lanes, with their queues. */
  readonly lanes: readonly LaneView[]
  readonly laneRoots: ReadonlyMap<LaneName, EntryId>
  readonly archived: ReadonlySet<EntryId>
  /** Roots whose agent works (`rootWork`). */
  readonly work: ReadonlyMap<EntryId, unknown>
  readonly layout: Pick<Layout, "open">
  /** The session has settled: before, a change is data arriving, not news. */
  readonly settled: boolean
}): AttentionView {
  const person = useSyncExternalStore(
    input.attention.attention.subscribe,
    input.attention.attention.current,
  )
  const writers = useMemo(
    () => threadWriters(input.directory),
    [input.directory],
  )
  const busy = useMemo(
    () =>
      new Set([
        ...input.running.map(r => r.lane),
        ...input.lanes.filter(isBusy).map(l => l.name),
      ]),
    [input.running, input.lanes],
  )
  const { items, done } = useMemo(() => {
    const facts = {
      me: input.me,
      writers,
      verdicts: input.verdicts,
      offers: input.offers,
      person,
      busy,
      laneRoots: input.laneRoots,
      archived: input.archived,
    }
    return { items: attentionOf(facts), done: doneRoots(facts) }
  }, [
    input.me,
    writers,
    input.verdicts,
    input.offers,
    person,
    busy,
    input.laneRoots,
    input.archived,
  ])
  const status = useMemo(
    () =>
      rootStatus({
        items,
        working: new Set(input.work.keys()),
        verdicts: input.verdicts,
        laneRoots: input.laneRoots,
      }),
    [items, input.work, input.verdicts, input.laneRoots],
  )
  const elsewhere = useMemo(
    () => markOf(status, unlisted(input.layout, input.archived, status.keys())),
    [input.layout, input.archived, status],
  )
  return {
    items,
    status,
    elsewhere,
    arrivals: useArrivals(status, done, input.settled && person.since !== ""),
  }
}

/**
 * When each root's mark last arrived, as you watched. Until `ready`, every
 * change is data arriving, so the first status after it is the baseline: a
 * page that loads draws every mark still. Nothing is dropped when a mark
 * stops moving (`moving`).
 */
function useArrivals(
  status: ReadonlyMap<EntryId, Status>,
  done: ReadonlySet<EntryId>,
  ready: boolean,
): Moments {
  const before = useRef<ReadonlyMap<EntryId, Status> | null>(null)
  const [kept, setKept] = useState<Moments>(NO_MOMENTS)
  useEffect(() => {
    if (!ready) {
      before.current = null
      return
    }
    const next = arrivals(before.current, status, done)
    before.current = status
    if (next.arrived.size === 0 && next.done.size === 0) return
    const at = Date.now()
    setKept(k => ({
      arrived: new Map([
        ...k.arrived,
        ...[...next.arrived].map(r => [r, at] as const),
      ]),
      done: new Map([...k.done, ...[...next.done].map(r => [r, at] as const)]),
    }))
  }, [status, done, ready])
  return kept
}
