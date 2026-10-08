// host/migrations/0003-workflow-archive — the stored workflow's last state
// under `archive`, where it was `closed`. One-time: delete this file once
// Duane's store has run it.

import { SESSION_TARGET } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

const NAMESPACE = "pinetrie.workflow"
const KEY = "workflow"

/**
 * The workflow's contents with `closed` renamed `archive`, or null when they
 * hold no `closed`: already migrated, or never written. Pure.
 */
export function planWorkflowArchive(stored: unknown): unknown | null {
  if (stored === null || typeof stored !== "object" || !("closed" in stored))
    return null
  const { closed, ...rest } = stored as Record<string, unknown>
  return { ...rest, archive: closed }
}

export const workflowArchive: RecordMigration = {
  name: "0003-workflow-archive",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(SESSION_DOC_ID)) return null
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const value = planWorkflowArchive(readNamespace(session, NAMESPACE)[KEY])
    if (value === null) return null
    return async () =>
      applyRecordWrites(session, [
        {
          kind: "set",
          target: SESSION_TARGET,
          namespace: NAMESPACE,
          key: KEY,
          value,
        },
      ])
  },
}
