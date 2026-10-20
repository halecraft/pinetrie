// web/use-attention — what needs you, and where: the shell over `attention.ts`.
// It reads your attention document, decides each thread's status and so each
// canvas's, and keeps what changed as you watched long enough for a mark to
// move (`moving`), a canvas's and a thread's. The decisions are `attention.ts`'s.

import {
  type AgentWork,
  type CanvasId,
  isBusy,
  type LaneView,
  laneWork,
  type RootId,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  arrivals,
  attentionItems,
  canvasStatus,
  doneThreads,
  type Item,
  type Layout,
  type Level,
  type Moments,
  markLevel,
  type OpenProposedChanges,
  type RootRecord,
  type RunEndReportRecord,
  type SshAsk,
  type StandingRunEnd,
  type Status,
  standingRunEnds,
  threadStatus,
  threadWriters,
  unlisted,
  type WorkStripState,
} from "@pinetrie/interface"
import type { AttentionStore } from "@pinetrie/session"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

interface AttentionView {
  /** Everything raised for you (`attentionItems`). */
  readonly items: readonly Item[]
  /** Each thread's run-end report that asks something of you, read or not: its column's status line. */
  readonly runEnds: ReadonlyMap<ThreadId, StandingRunEnd>
  /** Each canvas's (`canvasStatus`). */
  readonly status: ReadonlyMap<CanvasId, Status>
  /** Each thread's (`threadStatus`): what its column's dot draws. */
  readonly threads: ReadonlyMap<ThreadId, Status>
  /** ▦'s: the highest status of canvases not in the sidebar (`markLevel`). */
  readonly elsewhere: Level | null
  readonly arrivals: Moments
  /** When each thread's mark last arrived, and its ✓ last showed. */
  readonly threadArrivals: Moments<ThreadId>
}

export function useAttention(input: {
  readonly me: WriterId
  readonly attention: AttentionStore
  readonly directory: ReadonlyMap<RootId, RootRecord>
  readonly runEndReports: ReadonlyMap<ThreadId, RunEndReportRecord>
  readonly openProposed: readonly OpenProposedChanges[]
  /** Each lane's work strip state (`stripStates`). */
  readonly strips: ReadonlyMap<ThreadId, WorkStripState>
  /** Lanes waiting for their owner's answer about ssh. */
  readonly sshAsks: readonly SshAsk[]
  /** Whom the host names its owner. */
  readonly owner: WriterId | null
  /** Lanes running in any root (`readRunningLanes`). */
  readonly running: readonly { readonly lane: ThreadId }[]
  /** The held roots' lanes, with their queues. */
  readonly lanes: readonly LaneView[]
  /** The archived canvases: their threads raise nothing. */
  readonly archived: ReadonlySet<CanvasId>
  /** Each thread's canvas: a canvas's status is its threads'. */
  readonly canvasOfThread: ReadonlyMap<ThreadId, CanvasId>
  /** Threads whose agent works, held or not (`threadWork`). */
  readonly work: ReadonlyMap<ThreadId, AgentWork>
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
  // A thread whose cards wait behind a held queue is not busy: nothing
  // happens there until a person releases it, so what it raised still shows.
  const busy = useMemo(
    () =>
      new Set([
        ...input.running.map(r => r.lane),
        ...input.lanes
          .filter(l => isBusy(l) && laneWork(l) !== "held")
          .map(l => l.name),
      ]),
    [input.running, input.lanes],
  )
  // The threads of archived canvases, which raise nothing.
  const archived = useMemo(
    () =>
      new Set(
        [...input.canvasOfThread].flatMap(([thread, canvas]) =>
          input.archived.has(canvas) ? [thread] : [],
        ),
      ),
    [input.canvasOfThread, input.archived],
  )
  const { items, done, doneThreadsNow, runEnds } = useMemo(() => {
    const facts = {
      me: input.me,
      writers,
      runEndReports: input.runEndReports,
      openProposed: input.openProposed,
      strips: input.strips,
      sshAsks: input.sshAsks,
      owner: input.owner,
      person,
      busy,
      archived,
    }
    const finished = doneThreads(facts)
    const ended = new Set(
      [...finished].flatMap(t => input.canvasOfThread.get(t) ?? []),
    )
    return {
      items: attentionItems(facts),
      done: ended,
      doneThreadsNow: finished,
      runEnds: standingRunEnds(facts),
    }
  }, [
    input.me,
    writers,
    input.runEndReports,
    input.openProposed,
    input.strips,
    input.sshAsks,
    input.owner,
    person,
    busy,
    archived,
    input.canvasOfThread,
  ])
  const threads = useMemo(
    () =>
      threadStatus({
        items,
        runEnds,
        strips: input.strips,
        work: input.work,
        runEndReports: input.runEndReports,
      }),
    [items, runEnds, input.strips, input.work, input.runEndReports],
  )
  const status = useMemo(
    () => canvasStatus(threads, input.canvasOfThread),
    [threads, input.canvasOfThread],
  )
  const elsewhere = useMemo(
    () =>
      markLevel(status, unlisted(input.layout, input.archived, status.keys())),
    [input.layout, input.archived, status],
  )
  const ready = input.settled && person.since !== ""
  return {
    items,
    runEnds,
    status,
    threads,
    elsewhere,
    arrivals: useArrivals(status, done, ready),
    threadArrivals: useArrivals(threads, doneThreadsNow, ready),
  }
}

/**
 * When each canvas's or thread's mark last arrived, as you watched. Until
 * `ready`, every change is data arriving, so the first status after it is
 * the baseline: a page that loads draws every mark still. Nothing is dropped
 * when a mark stops moving (`moving`).
 */
function useArrivals<K>(
  status: ReadonlyMap<K, Status>,
  done: ReadonlySet<K>,
  ready: boolean,
): Moments<K> {
  const before = useRef<ReadonlyMap<K, Status> | null>(null)
  const [kept, setKept] = useState<Moments<K>>(() => ({
    arrived: new Map(),
    done: new Map(),
  }))
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
