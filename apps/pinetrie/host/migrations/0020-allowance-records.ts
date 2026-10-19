// host/migrations/0020-allowance-records — the tokens a person's message lets
// agents spend talking are its allowance: each record moves from
// `pinetrie.budget` to `pinetrie.allowance` under the same message, the old
// deleted, so no allowance spent so far is forgotten.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { SESSION_TARGET, type ValueWrite } from "@pinetrie/core"
import { ALLOWANCE } from "@pinetrie/rules"
import { applyRecordWrites, readNamespace } from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"
import { recordDocs } from "./rewrite.ts"

const OLD = "pinetrie.budget"

/** Each stored record under the old namespace: set under the new, deleted from the old. */
export function planAllowanceMove(
  stored: Readonly<Record<string, unknown>>,
): readonly ValueWrite[] {
  return Object.entries(stored).flatMap(([key, value]) => [
    {
      kind: "set" as const,
      target: SESSION_TARGET,
      namespace: ALLOWANCE.namespace,
      key,
      value,
    },
    { kind: "delete" as const, target: SESSION_TARGET, namespace: OLD, key },
  ])
}

export const allowanceRecords: RecordMigration = {
  name: "0020-allowance-records",
  async run(input) {
    const [session] = await recordDocs(input, "session")
    if (session === undefined) return null
    const writes = planAllowanceMove(readNamespace(session.doc, OLD))
    if (writes.length === 0) return null
    return async () => applyRecordWrites(session.doc, writes)
  },
}
