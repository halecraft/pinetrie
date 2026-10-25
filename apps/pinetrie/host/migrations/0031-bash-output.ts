// host/migrations/0031-bash-output — each `bash` call's stored split moves
// from `pinetrie.output-split` to `BASH_OUTPUT`'s namespace, as a verdict:
// `{ statements }` becomes a split with the same statements, and the call
// and each statement mark no stderr, which the old record never kept. A
// value with no `statements`, as the new shape has none, moves as stored.
//
// One-time: when deleted, its name moves to `RETIRED_MIGRATIONS`.

import { BASH_OUTPUT } from "@pinetrie/rules"
import { rewriteRecords } from "./rewrite.ts"

type Raw = Readonly<Record<string, unknown>>

const isRaw = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * A stored split in the record's new shape; null for anything without the
 * old shape's `statements`, the new shape among them.
 */
export function bashOutputNow(contents: unknown): object | null {
  if (!isRaw(contents)) return null
  const { statements } = contents
  if (!Array.isArray(statements)) return null
  return {
    verdict: {
      kind: "split",
      statements: statements.map(s => (isRaw(s) ? { ...s, stderr: [] } : s)),
    },
    stderr: [],
  }
}

export const bashOutputMigration = rewriteRecords({
  name: "0031-bash-output",
  namespace: "pinetrie.output-split",
  to: BASH_OUTPUT.namespace,
  home: BASH_OUTPUT.home,
  rewrite: bashOutputNow,
})
