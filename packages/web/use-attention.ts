// web/use-attention — what needs you, and where: the shell over `attention.ts`.
// It reads your attention document, decides each thread's status and so each
// canvas's, and keeps what changed as you watched long enough for its mark to
// move (`moving`). The decisions are `attention.ts`'s.

import {
  type AgentWork,
  type CanvasId,
  isBusy,
  type LaneView,
  laneWork,
  type RootId,
  type RootRecord,
  type ThreadId,
  type VerdictRecord,
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
  type SshAsk,
  type Status,
  threadStatus,
  threadWriters,
  unlisted,
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
  /** Each canvas's (`canvasStatus`). */
  readonly status: ReadonlyMap<CanvasId, Status>
  /** ▦'s: the highest status of canvases not in the sidebar (`markLevel`). */
  readonly elsewhere: Level | null
  readonly arrivals: Moments
}

const NO_MOMENTS: Moments = { arrived: new Map(), done: new Map() }

export function useAttention(input: {
  readonly me: WriterId
  readonly attention: AttentionStore
  readonly directory: ReadonlyMap<RootId, RootRecord>
  readonly verdicts: ReadonlyMap<ThreadId, VerdictRecord>
  readonly openProposed: readonly OpenProposedChanges[]
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
  const { items, done } = useMemo(() => {
    const facts = {
      me: input.me,
      writers,
      verdicts: input.verdicts,
      openProposed: input.openProposed,
      sshAsks: input.sshAsks,
      owner: input.owner,
      person,
      busy,
      archived,
    }
    const ended = new Set(
      [...doneThreads(facts)].flatMap(t => input.canvasOfThread.get(t) ?? []),
    )
    return { items: attentionItems(facts), done: ended }
  }, [
    input.me,
    writers,
    input.verdicts,
    input.openProposed,
    input.sshAsks,
    input.owner,
    person,
    busy,
    archived,
    input.canvasOfThread,
  ])
  const status = useMemo(
    () =>
      canvasStatus(
        threadStatus({ items, work: input.work, verdicts: input.verdicts }),
        input.canvasOfThread,
      ),
    [items, input.work, input.verdicts, input.canvasOfThread],
  )
  const elsewhere = useMemo(
    () =>
      markLevel(status, unlisted(input.layout, input.archived, status.keys())),
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
 * When each canvas's mark last arrived, as you watched. Until `ready`, every
 * change is data arriving, so the first status after it is the baseline: a
 * page that loads draws every mark still. Nothing is dropped when a mark
 * stops moving (`moving`).
 */
function useArrivals(
  status: ReadonlyMap<CanvasId, Status>,
  done: ReadonlySet<CanvasId>,
  ready: boolean,
): Moments {
  const before = useRef<ReadonlyMap<CanvasId, Status> | null>(null)
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
