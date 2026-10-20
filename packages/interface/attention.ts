// interface/attention — what needs you, and where, decided. A run-end report clears by
// reading past it, proposed changes by accepting or withdrawing it, and either
// by "not needed". Each thread's status is one level of one order
// (`LEVELS`), from what needs you and the state of its work, so the sidebar,
// the board and a column's dot cannot disagree.

import type {
  AgentWork,
  CanvasId,
  EntryId,
  ProposedChangesRecord,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import {
  type ConflictAskRecord,
  proposedChangesStatus,
  type RootRecord,
  type RunEndReport,
  type RunEndReportRecord,
  type WorkStripState,
  workStripState,
} from "@pinetrie/rules"
import type { Attention } from "@pinetrie/schema"
import { sshAskWords } from "./access-view.ts"
import type { OpenProposedChanges, SshAsk } from "./app-view.ts"

/**
 * A thread's status, lowest first: `highest` and every comparison read this
 * order. None is null.
 */
export const LEVELS = [
  "accepted",
  "running",
  "worth-a-read",
  "ready",
  "conflicts",
  "needs-you",
] as const
export type Level = (typeof LEVELS)[number]

/** What a run-end report can ask of you. */
export type RunEndLevel = Extract<Level, "worth-a-read" | "needs-you">

/** Whether `level` asks you to act: ready to accept, or above. The inbox's badge counts these. */
export const needsYou = (level: Level): boolean =>
  LEVELS.indexOf(level) >= LEVELS.indexOf("ready")

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
): RunEndLevel | null {
  switch (report.kind) {
    case "pending":
      return null
    case "model-said":
      return report.urgency === "done" ? null : report.urgency
    case "failed":
    case "unclassified":
      return "needs-you"
    case "stopped":
      return report.by === me ? null : "worth-a-read"
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
      readonly kind: "run-end"
      readonly report: RunEndReport
      /** The run's prompt: what "not needed" dismisses. */
      readonly ask: EntryId
    }
  | {
      /** Open proposed changes: ready to accept, conflicted, or asked about. */
      readonly kind: "proposed"
      readonly state: WorkStripState
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
  /** Open proposed changes: where each opens, and what dismisses it. */
  readonly openProposed: readonly OpenProposedChanges[]
  /** Each lane's work strip state (`stripStates`). */
  readonly strips: ReadonlyMap<ThreadId, WorkStripState>
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
  readonly level: RunEndLevel
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
  const isMine = (lane: ThreadId): boolean =>
    !input.busy.has(lane) && followed(input, lane)
  const items: Item[] = []
  for (const { record: v, level, raised } of standingRunEnds(input).values()) {
    if (!raised) continue
    items.push({
      lane: v.lane,
      end: v.end,
      level,
      raised: { kind: "run-end", report: v.report, ask: v.ask },
    })
  }
  for (const o of input.openProposed) {
    if (!isMine(o.lane)) continue
    if (o.source !== null && person.dismissedReady.get(o.lane) === o.source)
      continue
    const state = input.strips.get(o.lane)
    const level = state === undefined ? null : STRIP_LEVEL[state]
    if (state === undefined || level === null || !needsYou(level)) continue
    items.push({
      lane: o.lane,
      end: o.end,
      level,
      raised: { kind: "proposed", state, source: o.source },
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
          level: "needs-you",
          raised: { kind: "ssh", host: a.host },
        })
  return items
}

/**
 * The level a work strip's state is, for a thread's status; null for
 * nothing to say. Over every state, so a new one does not compile until it
 * says what it shows.
 */
export const STRIP_LEVEL: Readonly<Record<WorkStripState, Level | null>> = {
  nothing: null,
  running: "running",
  busy: "running",
  "needs-you": "needs-you",
  conflicts: "conflicts",
  ready: "ready",
  stack: "ready",
  stale: "ready",
  edited: "ready",
  accepted: "accepted",
}

/**
 * Each lane's work strip state, from its proposed changes and its conflict
 * ask: facts every lane has, held tree or not. Read as idle: a lane that
 * runs or has cards waiting is `running` before its strip is read
 * (`threadStatus`).
 */
export const stripStates = (
  proposedByLane: ReadonlyMap<ThreadId, ProposedChangesRecord>,
  conflictAsks: ReadonlyMap<ThreadId, ConflictAskRecord>,
): ReadonlyMap<ThreadId, WorkStripState> =>
  new Map(
    [...proposedByLane].map(([lane, record]) => [
      lane,
      workStripState({
        proposed: proposedChangesStatus(record),
        activity: "idle",
        asked: conflictAsks.get(lane)?.at ?? null,
      }),
    ]),
  )

/**
 * A thread's or a canvas's status: what its mark draws, in a column, the
 * sidebar and on the board.
 */
export interface Status {
  readonly level: Level
  /**
   * Raised for you: `running` for everyone, `accepted` never, any other
   * while its item is (`attentionItems`). Only a raised status marks a
   * canvas; a column draws one that is not in its quiet form.
   */
  readonly raised: boolean
  /** Its item, raised or standing quietly; null for one no item names. */
  readonly item: Item | null
}

/** A raised status before a quiet one, then the higher level. */
const outranks = (a: Status, b: Status): boolean =>
  a.raised !== b.raised
    ? a.raised
    : LEVELS.indexOf(a.level) > LEVELS.indexOf(b.level)

const better = (now: Status | undefined, next: Status): Status =>
  now === undefined || outranks(next, now) ? next : now

/**
 * The highest raised level among `keys` (`highest`): what one mark says for
 * them all, running aside. The one rule for a board column's dot and ▦'s,
 * which covers the canvases not in the sidebar.
 */
export const markLevel = <K>(
  status: ReadonlyMap<K, Status>,
  keys: Iterable<K>,
): Level | null =>
  highest(
    [...keys].map(k => {
      const s = status.get(k)
      return s === undefined || !s.raised || s.level === "running"
        ? null
        : s.level
    }),
  )

/**
 * Each thread's status: the best of what holds for it (`outranks`). Running
 * while its agent works, cards wait for it to be free, or its run-end
 * report is pending; each item raised for you; a run-end report read or
 * dismissed, quietly, until the next run; its work strip's state, quietly.
 * Cards behind a held queue are not work: they wait for a person.
 */
export function threadStatus(input: {
  /** What is raised for you (`attentionItems`). */
  readonly items: readonly Item[]
  /** Run-end reports that ask something of you, read or not (`standingRunEnds`). */
  readonly runEnds: ReadonlyMap<ThreadId, StandingRunEnd>
  readonly strips: ReadonlyMap<ThreadId, WorkStripState>
  /** Threads whose agent works, held by this tab or not (`threadWork`). */
  readonly work: ReadonlyMap<ThreadId, AgentWork>
  readonly runEndReports: ReadonlyMap<ThreadId, RunEndReportRecord>
}): ReadonlyMap<ThreadId, Status> {
  const out = new Map<ThreadId, Status>()
  const add = (thread: ThreadId, status: Status) =>
    out.set(thread, better(out.get(thread), status))
  const running: Status = { level: "running", raised: true, item: null }
  for (const [thread, work] of input.work)
    if (work !== "held") add(thread, running)
  for (const v of input.runEndReports.values())
    if (v.report.kind === "pending") add(v.lane, running)
  for (const item of input.items)
    add(item.lane, { level: item.level, raised: true, item })
  for (const [lane, standing] of input.runEnds)
    if (!standing.raised)
      add(lane, {
        level: standing.level,
        raised: false,
        item: {
          lane,
          end: standing.record.end,
          level: standing.level,
          raised: {
            kind: "run-end",
            report: standing.record.report,
            ask: standing.record.ask,
          },
        },
      })
  for (const [lane, state] of input.strips) {
    const level = STRIP_LEVEL[state]
    if (level !== null) add(lane, { level, raised: false, item: null })
  }
  return out
}

/**
 * Each canvas's status: the best raised status among its threads. A thread
 * in no canvas counts for none.
 */
export function canvasStatus(
  threads: ReadonlyMap<ThreadId, Status>,
  canvasOfThread: ReadonlyMap<ThreadId, CanvasId>,
): ReadonlyMap<CanvasId, Status> {
  const out = new Map<CanvasId, Status>()
  for (const [thread, status] of threads) {
    const canvas = canvasOfThread.get(thread)
    if (canvas !== undefined && status.raised)
      out.set(canvas, better(out.get(canvas), status))
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

/** What each change of a canvas's or a thread's status draws, seen live. */
interface Arrivals<K> {
  /** Those whose status rose to needing you: their mark pulses, then stays. */
  readonly arrived: ReadonlySet<K>
  /** Those that stopped running with a run done: a ✓ fades. */
  readonly done: ReadonlySet<K>
}

/**
 * The changes from `before` to `after`. A first render has no `before`
 * (null), so a page that loads, or a tab shown again, draws every mark
 * still: motion marks a change you saw, never a state.
 */
export function arrivals<K>(
  before: ReadonlyMap<K, Status> | null,
  after: ReadonlyMap<K, Status>,
  done: ReadonlySet<K>,
): Arrivals<K> {
  const arrived = new Set<K>()
  const ended = new Set<K>()
  if (before === null) return { arrived, done: ended }
  const asks = (s: Status | undefined): boolean =>
    s?.raised === true && needsYou(s.level)
  for (const [key, now] of after)
    if (asks(now) && !asks(before.get(key))) arrived.add(key)
  for (const [key, was] of before)
    if (
      was.level === "running" &&
      after.get(key)?.raised !== true &&
      done.has(key)
    )
      ended.add(key)
  return { arrived, done: ended }
}

/** How long an arrival's mark moves: the pulse's three beats, and the ✓'s fade (`index.html`). */
const ARRIVAL_MS = 3_000

/** When each canvas's or thread's mark last arrived, and its ✓ last showed (ms since the epoch). */
export interface Moments<K = CanvasId> {
  readonly arrived: ReadonlyMap<K, number>
  readonly done: ReadonlyMap<K, number>
}

/**
 * Whether a mark that arrived `at` still moves, at `now`. A mark is keyed by
 * its arrival's time and moves only as it mounts within `ARRIVAL_MS` of it,
 * so the end of its motion redraws nothing.
 */
export const moving = (at: number | null, now: number): boolean =>
  at !== null && now - at < ARRIVAL_MS

/** Open proposed changes' reason, by its strip's state. */
const PROPOSED_WORDS: Readonly<Record<WorkStripState, string>> = {
  nothing: "nothing to accept",
  running: "the agent is working",
  busy: "the agent is working",
  "needs-you": "the agent has a question about a conflict",
  conflicts: "changes conflict with accepted work",
  ready: "changes ready to accept",
  stack: "changes ready to accept",
  stale: "changes ready to accept",
  edited: "your edited changes are ready to accept",
  accepted: "accepted",
}

/** Why the agent's end could not be told, in words. */
const UNCLASSIFIED_WORDS = "finished: have a look"

/** A raised item's reason: a mark's title, an inbox row's line. */
export function attentionWords(
  raised: Raised,
  nameOf: (writer: WriterId) => string,
): string {
  if (raised.kind === "proposed") return PROPOSED_WORDS[raised.state]
  if (raised.kind === "ssh") return sshAskWords("your ssh", raised.host)
  const v = raised.report
  switch (v.kind) {
    case "model-said":
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
