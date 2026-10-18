// interface/attention — what needs you, and where, decided. A run-end report clears by
// reading past it, proposed changes by accepting or withdrawing it, and either
// by "not needed".

import type {
  AgentWork,
  CanvasId,
  EntryId,
  RootRecord,
  RunEndReport,
  RunEndReportRecord,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { PRODUCT_NAME } from "@pinetrie/core"
import type { Attention } from "@pinetrie/schema"
import type { OpenProposedChanges, SshAsk } from "./app-view.ts"

/** Lowest first: `highest` and every comparison read this order. */
export const LEVELS = ["worthARead", "needsYou"] as const
export type Level = (typeof LEVELS)[number]

/** The highest of `levels`, or null for none. */
export const highest = (levels: Iterable<Level | null>): Level | null => {
  let top: Level | null = null
  for (const level of levels)
    if (
      level !== null &&
      (top === null || LEVELS.indexOf(level) > LEVELS.indexOf(top))
    )
      top = level
  return top
}

/**
 * Whether `me` follows a thread whose path `writers` wrote on. One
 * function, so that unfollowing, later, changes only this.
 */
export const follows = (me: WriterId, writers: readonly WriterId[]): boolean =>
  writers.includes(me)

/**
 * What a run-end report asks of `me`, one of its thread's followers: what the
 * model said, unless it was `done`; a failed or unclassified run needs
 * you; a stop is done for whoever stopped it, and worth a read for the
 * rest; a pending report asks nothing yet.
 */
export function attentionLevel(
  report: RunEndReport,
  me: WriterId,
): Level | null {
  switch (report.kind) {
    case "pending":
      return null
    case "modelSaid":
      return report.urgency === "done" ? null : report.urgency
    case "failed":
    case "unclassified":
      return "needsYou"
    case "stopped":
      return report.by === me ? null : "worthARead"
  }
}

/** Each thread's writers, from every root's directory record. */
export const threadWriters = (
  directory: ReadonlyMap<string, RootRecord>,
): ReadonlyMap<ThreadId, readonly WriterId[]> =>
  new Map(
    [...directory.values()].flatMap(
      r => Object.entries(r.threads) as [ThreadId, readonly WriterId[]][],
    ),
  )

/** What raised a thread's attention, and what "not needed" marks. */
export type Raised =
  | {
      readonly kind: "runEnd"
      readonly report: RunEndReport
      /** The run's prompt: what "not needed" dismisses. */
      readonly ask: EntryId
    }
  | {
      /** Open proposed changes, ready to accept. */
      readonly kind: "ready"
      /** Its `ledger.source`: what "not needed" dismisses; null, it cannot be. */
      readonly source: string | null
    }
  /** A lane waits for you to answer its use of your ssh identity: answering clears it. */
  | { readonly kind: "ssh"; readonly host: string | null }

/** One thing a thread raises for you. */
export interface Item {
  readonly lane: ThreadId
  /** Where choosing it opens the thread. */
  readonly end: EntryId
  readonly level: Level
  readonly raised: Raised
}

export interface AttentionInput {
  readonly me: WriterId
  /** Each thread's writers (`threadWriters`). */
  readonly writers: ReadonlyMap<ThreadId, readonly WriterId[]>
  readonly runEndReports: ReadonlyMap<ThreadId, RunEndReportRecord>
  readonly openProposed: readonly OpenProposedChanges[]
  /** Lanes waiting for their owner's answer about ssh (`appView`'s `sshAsks`). */
  readonly sshAsks: readonly SshAsk[]
  /** Whom the host names its owner: the asks are theirs alone. */
  readonly owner: WriterId | null
  /** Your attention document, read. */
  readonly person: Attention
  /** Lanes running or with cards queued, in any root. */
  readonly busy: ReadonlySet<ThreadId>
  /** The threads of archived canvases: they raise nothing. */
  readonly archived: ReadonlySet<ThreadId>
}

/** Entry ids are uuidv7: the later of two is the greater. */
const latest = (a: string, b: string | undefined): string =>
  b !== undefined && b > a ? b : a

/** Whether you follow `lane`, and its canvas is not archived. */
const followed = (input: AttentionInput, lane: ThreadId): boolean =>
  !input.archived.has(lane) && follows(input.me, input.writers.get(lane) ?? [])

/** A thread's last run-end report, while it asks something of you. */
export interface StandingRunEnd {
  readonly record: RunEndReportRecord
  readonly level: Level
  /**
   * Not yet read past or dismissed: it raises an item. Read or dismissed, it
   * still stands, quietly, until the next run starts.
   */
  readonly raised: boolean
}

/**
 * Each thread's run-end report that asks something of you (`attentionLevel`),
 * by lane: only a thread you follow, while its agent is idle and its canvas
 * is not archived. The sidebar's items and a column's status line both read
 * this, so they cannot disagree. Before your document's first write (`since`
 * ""), where you started is not known, and none is raised.
 */
export function standingRunEnds(
  input: AttentionInput,
): ReadonlyMap<ThreadId, StandingRunEnd> {
  const { me, person } = input
  const out = new Map<ThreadId, StandingRunEnd>()
  for (const record of input.runEndReports.values()) {
    const level = attentionLevel(record.report, me)
    if (level === null || input.busy.has(record.lane)) continue
    if (!followed(input, record.lane)) continue
    const raised =
      person.since !== "" &&
      record.end > latest(person.since, person.read.get(record.lane)) &&
      person.dismissed.get(record.lane) !== record.ask
    out.set(record.lane, { record, level, raised })
  }
  return out
}

/**
 * Everything raised for you, run-end reports and ready proposed changes apart: a
 * thread can raise both. Only a thread you follow raises anything, and only
 * while its agent is idle and its canvas is not archived. Before your document's
 * first write (`since` ""), where you started is not known, and nothing is
 * raised.
 */
export function attentionItems(input: AttentionInput): readonly Item[] {
  const { me, person } = input
  if (person.since === "") return []
  const yours = (lane: ThreadId): boolean =>
    !input.busy.has(lane) && followed(input, lane)
  const items: Item[] = []
  for (const { record: v, level, raised } of standingRunEnds(input).values()) {
    if (!raised) continue
    items.push({
      lane: v.lane,
      end: v.end,
      level,
      raised: { kind: "runEnd", report: v.report, ask: v.ask },
    })
  }
  for (const o of input.openProposed) {
    if (!yours(o.lane)) continue
    if (o.source !== null && person.dismissedReady.get(o.lane) === o.source)
      continue
    items.push({
      lane: o.lane,
      end: o.end,
      level: "needsYou",
      raised: { kind: "ready", source: o.source },
    })
  }
  // An ask reaches its owner whether or not they follow the thread, and
  // while its lane runs: it asks mid-run, and waits on them.
  if (input.owner === me)
    for (const a of input.sshAsks)
      if (!input.archived.has(a.lane))
        items.push({
          lane: a.lane,
          end: a.end,
          level: "needsYou",
          raised: { kind: "ssh", host: a.host },
        })
  return items
}

/** A thread's or a canvas's status: what its mark draws, in the sidebar and on the board. */
export type Status =
  | { readonly kind: "working" }
  | { readonly kind: Level; readonly item: Item }

/**
 * The highest level among `keys` (`highest`): what one mark says for them
 * all. The one rule for a canvas's item, a board column's dot and ▦'s, which
 * covers the canvases not in the sidebar. Working raises nothing.
 */
export const markLevel = <K>(
  status: ReadonlyMap<K, Status>,
  keys: Iterable<K>,
): Level | null =>
  highest(
    [...keys].map(k => {
      const s = status.get(k)
      return s === undefined || s.kind === "working" ? null : s.kind
    }),
  )

/** `now` and `item` together: working wins, else the higher level. */
const withItem = (now: Status | undefined, next: Status): Status => {
  if (now?.kind === "working" || next.kind === "working")
    return { kind: "working" }
  return now === undefined || highest([now.kind, next.kind]) !== now.kind
    ? next
    : now
}

/**
 * Each thread's status: working while its agent works, cards wait for it
 * to be free, or its run-end report is pending (the agent's side is not finished);
 * else its highest item. Cards behind a held queue are not work: they wait
 * for a person. A thread with none of these has none.
 */
export function threadStatus(input: {
  readonly items: readonly Item[]
  /** Threads whose agent works, held by this tab or not (`threadWork`). */
  readonly work: ReadonlyMap<ThreadId, AgentWork>
  readonly runEndReports: ReadonlyMap<ThreadId, RunEndReportRecord>
}): ReadonlyMap<ThreadId, Status> {
  const out = new Map<ThreadId, Status>()
  for (const [thread, work] of input.work)
    if (work !== "held") out.set(thread, { kind: "working" })
  for (const v of input.runEndReports.values())
    if (v.report.kind === "pending") out.set(v.lane, { kind: "working" })
  for (const item of input.items)
    out.set(item.lane, withItem(out.get(item.lane), { kind: item.level, item }))
  return out
}

/**
 * Each canvas's status: its threads' together, working when any
 * works, else the highest item among them. A thread in no canvas counts for
 * none.
 */
export function canvasStatus(
  threads: ReadonlyMap<ThreadId, Status>,
  canvasOfThread: ReadonlyMap<ThreadId, CanvasId>,
): ReadonlyMap<CanvasId, Status> {
  const out = new Map<CanvasId, Status>()
  for (const [thread, status] of threads) {
    const canvas = canvasOfThread.get(thread)
    if (canvas !== undefined) out.set(canvas, withItem(out.get(canvas), status))
  }
  return out
}

/**
 * The threads where a run you follow ended asking nothing of you (`attentionLevel`
 * null, and not pending): what a ✓ marks as it fades (`arrivals`).
 */
export function doneThreads(input: AttentionInput): ReadonlySet<ThreadId> {
  const out = new Set<ThreadId>()
  for (const v of input.runEndReports.values()) {
    if (!followed(input, v.lane) || v.report.kind === "pending") continue
    if (attentionLevel(v.report, input.me) === null) out.add(v.lane)
  }
  return out
}

/** What each change of a canvas's status draws, seen live. */
interface Arrivals {
  /** Canvases whose status rose to needs you: their mark pulses, then stays. */
  readonly arrived: ReadonlySet<CanvasId>
  /** Canvases that stopped working with a run done: a ✓ fades. */
  readonly done: ReadonlySet<CanvasId>
}

/**
 * The changes from `before` to `after`. A first render has no `before`
 * (null), so a page that loads, or a tab shown again, draws every mark
 * still: motion marks a change you saw, never a state.
 */
export function arrivals(
  before: ReadonlyMap<CanvasId, Status> | null,
  after: ReadonlyMap<CanvasId, Status>,
  done: ReadonlySet<CanvasId>,
): Arrivals {
  const arrived = new Set<CanvasId>()
  const ended = new Set<CanvasId>()
  if (before === null) return { arrived, done: ended }
  for (const [canvas, now] of after)
    if (now.kind === "needsYou" && before.get(canvas)?.kind !== "needsYou")
      arrived.add(canvas)
  for (const [canvas, was] of before)
    if (was.kind === "working" && !after.has(canvas) && done.has(canvas))
      ended.add(canvas)
  return { arrived, done: ended }
}

/** How long an arrival's mark moves: the pulse's three beats, and the ✓'s fade (`index.html`). */
const ARRIVAL_MS = 3_000

/** When each canvas's mark last arrived, and its ✓ last showed (ms since the epoch). */
export interface Moments {
  readonly arrived: ReadonlyMap<CanvasId, number>
  readonly done: ReadonlyMap<CanvasId, number>
}

/**
 * Whether a mark that arrived `at` still moves, at `now`. A mark is keyed by
 * its arrival's time and moves only as it mounts within `ARRIVAL_MS` of it,
 * so the end of its motion redraws nothing.
 */
export const moving = (at: number | null, now: number): boolean =>
  at !== null && now - at < ARRIVAL_MS

/** Why the agent's end could not be told, in words. */
const UNCLASSIFIED_WORDS = `the run ended; ${PRODUCT_NAME} could not tell what it needs`

/** A raised item's reason: a mark's title, an inbox row's line. */
export function attentionWords(
  raised: Raised,
  nameOf: (writer: WriterId) => string,
): string {
  if (raised.kind === "ready") return "changes ready to accept"
  if (raised.kind === "ssh")
    return `wants your ssh for ${raised.host ?? "a host"}`
  const v = raised.report
  switch (v.kind) {
    case "modelSaid":
      return v.reason ?? "done"
    case "failed":
      return v.error === "" ? "the run failed" : `the run failed: ${v.error}`
    case "stopped":
      return v.by === null
        ? "the run was stopped"
        : `${nameOf(v.by)} stopped it`
    case "unclassified":
      return UNCLASSIFIED_WORDS
    case "pending":
      return "the agent is finishing"
  }
}
