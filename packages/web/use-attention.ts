// web/use-attention — what needs you, and where: the shell over `attention.ts`.
// It reads your attention document, decides each thread's status and so each
// task's, and keeps what changed as you watched long enough for its mark to
// move (`moving`). The decisions are `attention.ts`'s.

import {
  isBusy,
  type LaneView,
  laneWork,
  type RootId,
  type RootRecord,
  type RootWork,
  type TaskId,
  type ThreadId,
  type VerdictRecord,
  type WriterId,
} from "@pinetrie/core"
import {
  arrivals,
  attentionOf,
  doneThreads,
  type Item,
  type Layout,
  type Level,
  type Moments,
  markOf,
  type OpenProposedChanges,
  type SshAsk,
  type Status,
  taskStatus,
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

export interface AttentionView {
  /** Everything raised for you (`attentionOf`). */
  readonly items: readonly Item[]
  /** Each task's (`taskStatus`). */
  readonly status: ReadonlyMap<TaskId, Status>
  /** ▦'s: the highest status of tasks not in the sidebar (`markOf`). */
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
  /** The archived tasks: their threads raise nothing. */
  readonly archived: ReadonlySet<TaskId>
  /** Each thread's task: a task's status is its threads'. */
  readonly taskOfThread: ReadonlyMap<ThreadId, TaskId>
  /** Threads whose agent works, held or not (`threadWork`). */
  readonly work: ReadonlyMap<ThreadId, RootWork>
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
  // The threads of archived tasks, which raise nothing.
  const archived = useMemo(
    () =>
      new Set(
        [...input.taskOfThread].flatMap(([thread, task]) =>
          input.archived.has(task) ? [thread] : [],
        ),
      ),
    [input.taskOfThread, input.archived],
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
      [...doneThreads(facts)].flatMap(t => input.taskOfThread.get(t) ?? []),
    )
    return { items: attentionOf(facts), done: ended }
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
    input.taskOfThread,
  ])
  const status = useMemo(
    () =>
      taskStatus(
        threadStatus({ items, work: input.work, verdicts: input.verdicts }),
        input.taskOfThread,
      ),
    [items, input.work, input.verdicts, input.taskOfThread],
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
 * When each task's mark last arrived, as you watched. Until `ready`, every
 * change is data arriving, so the first status after it is the baseline: a
 * page that loads draws every mark still. Nothing is dropped when a mark
 * stops moving (`moving`).
 */
function useArrivals(
  status: ReadonlyMap<TaskId, Status>,
  done: ReadonlySet<TaskId>,
  ready: boolean,
): Moments {
  const before = useRef<ReadonlyMap<TaskId, Status> | null>(null)
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
