// host/migrations/0024-run-end-report — each thread's last run's verdict,
// `pinetrie.verdict`, moves to `pinetrie.runEndReport`: its `verdict` field
// becomes `report`, and a model's `said` becomes `modelSaid` with its
// `urgency`. `rewriteRecords` rewrites records within their own namespace, so
// this move is a migration of its own. A record that does not read in the old
// shape is not moved: no reader decodes it now, and the same start's sweep of
// undeclared records deletes it.
//
// One-time: delete this file once Duane's store has run it.

import { SESSION_TARGET, type ValueWrite } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { RUN_END_REPORT } from "@pinetrie/rules"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

const OLD = "pinetrie.verdict"

type Stored = Readonly<Record<string, unknown>>

const isStored = (v: unknown): v is Stored =>
  v !== null && typeof v === "object" && !Array.isArray(v)

const URGENCIES: readonly unknown[] = ["needsYou", "worthARead", "done"]

/** A stored verdict as its report; null for one in no known shape. */
function reportFromVerdict(verdict: unknown): Stored | null {
  if (!isStored(verdict)) return null
  switch (verdict.kind) {
    case "said": {
      const { said, reason } = verdict
      if (!URGENCIES.includes(said)) return null
      if (reason !== null && typeof reason !== "string") return null
      return { kind: "modelSaid", urgency: said, reason }
    }
    case "pending":
    case "unclassified":
      return { kind: verdict.kind }
    case "failed":
      return typeof verdict.error === "string" ? verdict : null
    case "stopped":
      return verdict.by === null || typeof verdict.by === "string"
        ? verdict
        : null
    default:
      return null
  }
}

/**
 * Each stored verdict, by its lane, as a write of its run-end report and a
 * delete of the old record. A record in no known shape gets neither.
 */
export const runEndReportMove = (stored: Stored): readonly ValueWrite[] =>
  Object.entries(stored).flatMap(([lane, contents]) => {
    if (!isStored(contents)) return []
    const { ask, end, verdict } = contents
    const report = reportFromVerdict(verdict)
    if (typeof ask !== "string" || typeof end !== "string" || report === null)
      return []
    return [
      {
        kind: "set",
        target: SESSION_TARGET,
        namespace: RUN_END_REPORT.namespace,
        key: lane,
        value: { ask, end, report },
      },
      { kind: "delete", target: SESSION_TARGET, namespace: OLD, key: lane },
    ] as const
  })

export const runEndReport: RecordMigration = {
  name: "0024-run-end-report",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(SESSION_DOC_ID)) return null
    const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const writes = runEndReportMove(readNamespace(doc, OLD))
    if (writes.length === 0) return null
    return async () => applyRecordWrites(doc, writes)
  },
}
