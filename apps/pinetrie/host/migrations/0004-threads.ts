// host/migrations/0004-threads — every thread named in its first message
// (ADR-0117): each root's threads derived as `deriveThreads` guesses them,
// each first message given `starts`, and each thread its record. One-time:
// delete this file once Duane's store has run it.

import { batch } from "@kyneta/schema"
import {
  type EntryId,
  type RootId,
  rootDocId,
  type ThreadId,
  type ValueWrite,
} from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readLaneRecords,
  readRoots,
  readThreads,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  decodeChat,
  deriveThreads,
  type LaneTip,
  setRecord,
  THREAD,
} from "@pinetrie/rules"
import {
  applyRecordWrites,
  RootDoc,
  type RootDocHandle,
  readEntries,
  readLaneTip,
  SessionDoc,
  type StoredEntryRow,
} from "@pinetrie/schema"
import { newThreadId } from "@pinetrie/session"
import type { RecordMigration } from "./index.ts"

/** One root's threads named: its first messages rewritten, and their records. */
export interface RootThreads {
  readonly rows: readonly StoredEntryRow[]
  readonly records: readonly ValueWrite[]
}

/**
 * One root's first messages with `starts`, and each thread's record. A
 * thread whose first entry is no chat cannot be named, and is left: its
 * entries read as its parent thread's. Pure.
 */
export function planRootThreads(input: {
  readonly root: RootId
  readonly rows: Readonly<Record<string, StoredEntryRow>>
  readonly firsts: ReadonlyMap<EntryId, ThreadId>
}): RootThreads {
  const rows: StoredEntryRow[] = []
  const records: ValueWrite[] = []
  for (const [first, thread] of input.firsts) {
    const row = input.rows[first]
    const message = (row?.payload as { message?: unknown } | undefined)?.message
    const chat = decodeChat(message)
    if (row === undefined || chat === undefined) continue
    const stored = message as { details: object }
    rows.push({
      ...row,
      payload: {
        ...(row.payload as object),
        message: { ...stored, details: { ...stored.details, starts: thread } },
      },
    })
    records.push(
      setRecord(THREAD, {
        thread,
        root: input.root,
        by: chat.author,
        createdAt: row.timestamp,
        fork: null,
      }),
    )
  }
  return { rows, records }
}

export const threads: RecordMigration = {
  name: "0004-threads",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(SESSION_DOC_ID)) return null
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    // A store with a thread recorded has run this, or began after it.
    if (readThreads(session).size > 0) return null
    const lanes = [...readLaneRecords(session).values()]
    const planned: { doc: RootDocHandle; plan: RootThreads }[] = []
    for (const root of readRoots(session).keys()) {
      const docId = rootDocId(root)
      if (!docIds.includes(docId)) continue
      const doc = exchange.get(docId, RootDoc)
      await hydrated(docId)
      const tips: LaneTip[] = lanes
        .filter(l => l.root === root)
        .map(l => ({
          lane: l.lane,
          tip: readLaneTip(doc, l.lane),
          createdAt: l.createdAt,
        }))
      const firsts = deriveThreads(readTreeIndex(doc), tips, newThreadId)
      planned.push({
        doc,
        plan: planRootThreads({ root, rows: readEntries(doc), firsts }),
      })
    }
    if (planned.every(p => p.plan.rows.length === 0)) return null
    return async () => {
      for (const { doc, plan } of planned)
        batch(doc, d => {
          for (const row of plan.rows) d.entries.set(row.id, row)
        })
      applyRecordWrites(
        session,
        planned.flatMap(p => p.plan.records),
      )
    }
  },
}
