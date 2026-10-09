// interface/attention — what needs you, and where (ADR-0077), decided. A
// thread's followers are everyone who has written on its path; what it
// raises for them is how its last run ended (its verdict), and its open
// offer. A verdict clears by reading past it, an offer by accepting or
// withdrawing it, and either by "not needed". Status is each thread's:
// working while its agent works or its verdict is pending, else the highest
// of what it raises; a task's is its threads' together (`taskStatus`,
// ADR-0116). Worded in `attentionWords`. Pure.

import type {
  EntryId,
  RootRecord,
  RootWork,
  TaskId,
  ThreadId,
  Verdict,
  VerdictRecord,
  WriterId,
} from "@pinetrie/core"
import { PRODUCT_NAME } from "@pinetrie/core"
import type { Attention } from "@pinetrie/schema"
import type { OpenOffer } from "./app-view.ts"

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
 * What a verdict asks of `me`, one of its thread's followers: what the
 * model said, unless it was `done`; a failed or unclassified run needs
 * you; a stop is done for whoever stopped it, and worth a read for the
 * rest; a pending verdict asks nothing yet.
 */
export function levelOf(verdict: Verdict, me: WriterId): Level | null {
  switch (verdict.kind) {
    case "pending":
      return null
    case "said":
      return verdict.said === "done" ? null : verdict.said
    case "failed":
    case "unclassified":
      return "needsYou"
    case "stopped":
      return verdict.by === me ? null : "worthARead"
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
      readonly kind: "verdict"
      readonly verdict: Verdict
      /** The run's prompt: what "not needed" dismisses. */
      readonly ask: EntryId
    }
  | {
      readonly kind: "offer"
      /** Its `ledger.source`: what "not needed" dismisses; null, it cannot be. */
      readonly source: string | null
    }

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
  readonly verdicts: ReadonlyMap<ThreadId, VerdictRecord>
  readonly offers: readonly OpenOffer[]
  /** Your attention document, read. */
  readonly person: Attention
  /** Lanes running or with cards queued, in any root. */
  readonly busy: ReadonlySet<ThreadId>
  /** The threads of archived tasks (ADR-0116): they raise nothing. */
  readonly archived: ReadonlySet<ThreadId>
}

/** Entry ids are uuidv7: the later of two is the greater. */
const latest = (a: string, b: string | undefined): string =>
  b !== undefined && b > a ? b : a

/** Whether you follow `lane`, and its task is not archived. */
const followed = (input: AttentionInput, lane: ThreadId): boolean =>
  !input.archived.has(lane) && follows(input.me, input.writers.get(lane) ?? [])

/**
 * Everything raised for you, verdicts and offers apart: a thread can raise
 * both. Only a thread you follow raises anything, and only while its agent
 * is idle and its task is not archived. Before your document's first write
 * (`since` ""), where you started is not known, and nothing is raised.
 */
export function attentionOf(input: AttentionInput): readonly Item[] {
  const { me, person } = input
  if (person.since === "") return []
  const yours = (lane: ThreadId): boolean =>
    !input.busy.has(lane) && followed(input, lane)
  const items: Item[] = []
  for (const v of input.verdicts.values()) {
    const level = levelOf(v.verdict, me)
    if (!yours(v.lane) || level === null) continue
    if (v.end <= latest(person.since, person.read.get(v.lane))) continue
    if (person.dismissed.get(v.lane) === v.ask) continue
    items.push({
      lane: v.lane,
      end: v.end,
      level,
      raised: { kind: "verdict", verdict: v.verdict, ask: v.ask },
    })
  }
  for (const o of input.offers) {
    if (!yours(o.lane)) continue
    if (o.source !== null && person.dismissedOffers.get(o.lane) === o.source)
      continue
    items.push({
      lane: o.lane,
      end: o.end,
      level: "needsYou",
      raised: { kind: "offer", source: o.source },
    })
  }
  return items
}

/** A thread's or a task's status: what its mark draws, in the sidebar and on the board. */
export type Status =
  | { readonly kind: "working" }
  | { readonly kind: Level; readonly item: Item }

/**
 * The highest level among `keys` (`highest`): what one mark says for them
 * all. The one rule for a task's item, a board column's dot and ▦'s, which
 * covers the tasks not in the sidebar (ADR-0122). Working raises nothing.
 */
export const markOf = <K>(
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
 * to be free, or its verdict is pending (the agent's side is not finished);
 * else its highest item. Cards behind a held queue are not work: they wait
 * for a person (ADR-0113). A thread with none of these has none.
 */
export function threadStatus(input: {
  readonly items: readonly Item[]
  /** Threads whose agent works, held by this tab or not (`threadWork`). */
  readonly work: ReadonlyMap<ThreadId, RootWork>
  readonly verdicts: ReadonlyMap<ThreadId, VerdictRecord>
}): ReadonlyMap<ThreadId, Status> {
  const out = new Map<ThreadId, Status>()
  for (const [thread, work] of input.work)
    if (work !== "held") out.set(thread, { kind: "working" })
  for (const v of input.verdicts.values())
    if (v.verdict.kind === "pending") out.set(v.lane, { kind: "working" })
  for (const item of input.items)
    out.set(item.lane, withItem(out.get(item.lane), { kind: item.level, item }))
  return out
}

/**
 * Each task's status (ADR-0116): its threads' together, working when any
 * works, else the highest item among them. A thread in no task counts for
 * none.
 */
export function taskStatus(
  threads: ReadonlyMap<ThreadId, Status>,
  taskOfThread: ReadonlyMap<ThreadId, TaskId>,
): ReadonlyMap<TaskId, Status> {
  const out = new Map<TaskId, Status>()
  for (const [thread, status] of threads) {
    const task = taskOfThread.get(thread)
    if (task !== undefined) out.set(task, withItem(out.get(task), status))
  }
  return out
}

/**
 * The threads where a run you follow ended asking nothing of you (`levelOf`
 * null, and not pending): what a ✓ marks as it fades (`arrivals`).
 */
export function doneThreads(input: AttentionInput): ReadonlySet<ThreadId> {
  const out = new Set<ThreadId>()
  for (const v of input.verdicts.values()) {
    if (!followed(input, v.lane) || v.verdict.kind === "pending") continue
    if (levelOf(v.verdict, input.me) === null) out.add(v.lane)
  }
  return out
}

/** What each change of a task's status draws, seen live. */
export interface Arrivals {
  /** Tasks whose status rose to needs you: their mark pulses, then stays. */
  readonly arrived: ReadonlySet<TaskId>
  /** Tasks that stopped working with a run done: a ✓ fades. */
  readonly done: ReadonlySet<TaskId>
}

/**
 * The changes from `before` to `after`. A first render has no `before`
 * (null), so a page that loads, or a tab shown again, draws every mark
 * still: motion marks a change you saw, never a state.
 */
export function arrivals(
  before: ReadonlyMap<TaskId, Status> | null,
  after: ReadonlyMap<TaskId, Status>,
  done: ReadonlySet<TaskId>,
): Arrivals {
  const arrived = new Set<TaskId>()
  const ended = new Set<TaskId>()
  if (before === null) return { arrived, done: ended }
  for (const [task, now] of after)
    if (now.kind === "needsYou" && before.get(task)?.kind !== "needsYou")
      arrived.add(task)
  for (const [task, was] of before)
    if (was.kind === "working" && !after.has(task) && done.has(task))
      ended.add(task)
  return { arrived, done: ended }
}

/** How long an arrival's mark moves: the pulse's three beats, and the ✓'s fade (`index.html`). */
export const ARRIVAL_MS = 3_000

/** When each task's mark last arrived, and its ✓ last showed (ms since the epoch). */
export interface Moments {
  readonly arrived: ReadonlyMap<TaskId, number>
  readonly done: ReadonlyMap<TaskId, number>
}

/**
 * Whether a mark that arrived `at` still moves, at `now`. A mark is keyed by
 * its arrival's time and moves only as it mounts within `ARRIVAL_MS` of it,
 * so the end of its motion redraws nothing.
 */
export const moving = (at: number | null, now: number): boolean =>
  at !== null && now - at < ARRIVAL_MS

/** Words for a level: a mark's name. */
export const LEVEL_WORDS: Readonly<Record<Level, string>> = {
  needsYou: "needs you",
  worthARead: "worth a read",
}

/** Each level's class, on a root's mark and an inbox row: what the styles key on. */
export const LEVEL_CLASS: Readonly<Record<Level, string>> = {
  needsYou: "needs-you",
  worthARead: "worth-a-read",
}

/** Why the agent's end could not be told, in words. */
const UNCLASSIFIED_WORDS = `the run ended; ${PRODUCT_NAME} could not tell what it needs`

/** A raised item's reason: a mark's title, an inbox row's line. */
export function attentionWords(
  raised: Raised,
  nameOf: (writer: WriterId) => string,
): string {
  if (raised.kind === "offer") return "work ready to accept"
  const v = raised.verdict
  switch (v.kind) {
    case "said":
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
