// host/migrations/0008-entry-thread — every stored entry row given the thread
// it is in (ADR-0125), in the column the root's schema gained, and `starts`
// dropped from every stored chat. One-time: delete this file once Duane's
// store has run it.
//
// Rows are labelled by the walk the tree did before the column, with one
// rule more: a context entry belongs to the prompt below it, whose run wrote
// both in one commit. A branch's first run wrote its context entries above
// the chat naming it, so the walk put them in the thread it forks from (S143).

import { batch } from "@kyneta/schema"
import { type EntryId, isThreadId, type ThreadId } from "@pinetrie/core"
import { BEHIND_TYPE, CHAT_TYPE, CONTEXT } from "@pinetrie/rules"
import {
  RootDoc,
  type RootDocHandle,
  readEntries,
  readLaneNames,
  readLaneTip,
  type StoredEntryRow,
} from "@pinetrie/schema"
import type { Migration } from "./index.ts"

/** The root schema's hash before the column (S143). */
const FROM = "0275a1b400b7e3a6e6add33f58cfbe0542"

/**
 * The entries a run writes before its prompt, by `customType`: matched by
 * type, not decoded, since one stored in an older shape may not decode.
 */
const CONTEXT_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(CONTEXT).map(c => c.customType),
  BEHIND_TYPE,
])

/** One root's rows labelled, or why they cannot be. */
export type EntryThreadsPlan =
  | {
      readonly kind: "planned"
      readonly rows: readonly StoredEntryRow[]
      /** Rows rule 2 put in another thread than the walk did. */
      readonly moved: number
      readonly threads: number
      /** Lanes whose tip is their thread's one end, of the lanes with a tip. */
      readonly endsAtTip: { readonly at: number; readonly of: number }
    }
  /** Rows no rule puts in a thread: above every first message, or on a cycle. */
  | { readonly kind: "refused"; readonly unlabelled: readonly string[] }

type StoredMessage = {
  readonly customType?: unknown
  readonly details?: { readonly starts?: unknown }
}

const messageOf = (row: StoredEntryRow): StoredMessage | undefined => {
  const message = (row.payload as { message?: unknown } | null)?.message
  return typeof message === "object" && message !== null
    ? (message as StoredMessage)
    : undefined
}

/** The thread a stored chat names as the one it starts, read raw. */
const startsOf = (row: StoredEntryRow): ThreadId | undefined => {
  const message = messageOf(row)
  const starts = message?.details?.starts
  return message?.customType === CHAT_TYPE &&
    typeof starts === "string" &&
    isThreadId(starts)
    ? starts
    : undefined
}

const isContext = (row: StoredEntryRow | undefined): boolean => {
  const type = row === undefined ? undefined : messageOf(row)?.customType
  return typeof type === "string" && CONTEXT_TYPES.has(type)
}

/** `row` with no `starts` in its message's details. */
function withoutStarts(row: StoredEntryRow): StoredEntryRow["payload"] {
  const message = messageOf(row)
  if (message?.details === undefined || !("starts" in message.details))
    return row.payload
  const { starts: _, ...details } = message.details
  return {
    ...(row.payload as object),
    message: { ...message, details },
  }
}

/**
 * One root's rows, each in its thread, from the roots down:
 *
 * 1. A chat that is its thread's first message (`details.starts`, the oldest
 *    such chat per thread) is in that thread.
 * 2. A context entry follows its single-child chain through other context
 *    entries; when the first other entry it reaches is a first message, it
 *    is in that message's thread.
 * 3. Any other entry is in its parent's thread.
 *
 * Pure.
 */
export function planEntryThreads(input: {
  readonly rows: Readonly<Record<string, StoredEntryRow>>
  /** Each lane's tip in this root, from `pi.branch.tip`. */
  readonly tips: ReadonlyMap<ThreadId, EntryId>
}): EntryThreadsPlan {
  const { rows } = input
  const first = new Map<ThreadId, string>()
  for (const row of Object.values(rows)) {
    const starts = startsOf(row)
    const known = starts === undefined ? undefined : first.get(starts)
    if (starts !== undefined && (known === undefined || row.id < known))
      first.set(starts, row.id)
  }
  const starter = new Map([...first].map(([thread, id]) => [id, thread]))
  const children = new Map<string | null, string[]>()
  for (const row of Object.values(rows)) {
    const parent =
      row.parentId !== null && rows[row.parentId] !== undefined
        ? row.parentId
        : null
    children.set(parent, [...(children.get(parent) ?? []), row.id])
  }
  /** Rule 2: the thread whose first message a context chain from `id` reaches. */
  const reached = (id: string): ThreadId | undefined => {
    for (let at = id; ; ) {
      const next = children.get(at) ?? []
      if (next.length !== 1 || next[0] === undefined) return undefined
      at = next[0]
      if (!isContext(rows[at])) return starter.get(at)
    }
  }
  const thread = new Map<string, ThreadId>()
  let moved = 0
  const stack: [string, ThreadId | undefined][] = (
    children.get(null) ?? []
  ).map(id => [id, undefined])
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [id, inherited] = next
    const walked = starter.get(id) ?? inherited
    const own =
      starter.has(id) || !isContext(rows[id]) ? walked : (reached(id) ?? walked)
    if (own !== walked) moved += 1
    if (own !== undefined) thread.set(id, own)
    for (const child of children.get(id) ?? []) stack.push([child, own])
  }
  const unlabelled = Object.keys(rows).filter(id => !thread.has(id))
  if (unlabelled.length > 0) return { kind: "refused", unlabelled }

  const labelled = Object.values(rows).map(row => ({
    ...row,
    thread: thread.get(row.id) ?? row.thread,
    payload: withoutStarts(row),
  }))
  const continued = new Set(
    labelled.flatMap(row =>
      row.parentId !== null && thread.get(row.parentId) === row.thread
        ? [row.parentId]
        : [],
    ),
  )
  const ends = new Map<string, string[]>()
  for (const row of labelled)
    if (!continued.has(row.id))
      ends.set(row.thread, [...(ends.get(row.thread) ?? []), row.id])
  const tips = [...input.tips]
  return {
    kind: "planned",
    rows: labelled,
    moved,
    threads: new Set(thread.values()).size,
    endsAtTip: {
      at: tips.filter(([lane, tip]) => {
        const end = ends.get(lane)
        return end?.length === 1 && end[0] === tip
      }).length,
      of: tips.length,
    },
  }
}

/** Each lane's tip in `doc`, for the lanes that have one. */
const tipsIn = (doc: RootDocHandle): ReadonlyMap<ThreadId, EntryId> =>
  new Map(
    readLaneNames(doc).flatMap(lane => {
      const tip = readLaneTip(doc, lane)
      return tip === null ? [] : [[lane, tip] as const]
    }),
  )

export const entryThread: Migration = {
  name: "0008-entry-thread",
  kind: "root",
  from: FROM,
  async run({ exchange, docIds, hydrated, log }) {
    const planned: {
      readonly doc: RootDocHandle
      readonly rows: readonly StoredEntryRow[]
    }[] = []
    const totals = { rows: 0, moved: 0, threads: 0, at: 0, of: 0 }
    for (const docId of docIds) {
      const doc = exchange.get(docId, RootDoc)
      await hydrated(docId)
      const plan = planEntryThreads({
        rows: readEntries(doc),
        tips: tipsIn(doc),
      })
      if (plan.kind === "refused")
        throw new Error(
          `0008-entry-thread: ${docId} has entries in no thread: ${plan.unlabelled.slice(0, 5).join(", ")}`,
        )
      planned.push({ doc, rows: plan.rows })
      totals.rows += plan.rows.length
      totals.moved += plan.moved
      totals.threads += plan.threads
      totals.at += plan.endsAtTip.at
      totals.of += plan.endsAtTip.of
    }
    log(
      `[host] 0008-entry-thread: ${totals.rows} entries in ${totals.threads} threads, ${totals.moved} moved to the prompt below them; ${totals.at} of ${totals.of} lanes' tips at their thread's end`,
    )
    return async () => {
      for (const { doc, rows } of planned)
        batch(doc, d => {
          for (const row of rows) d.entries.set(row.id, row)
        })
    }
  },
}
