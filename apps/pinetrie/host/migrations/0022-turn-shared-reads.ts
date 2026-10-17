// host/migrations/0022-turn-shared-reads — each revision record's
// `disk.shared.read` dropped: the shared files a turn read, which nothing
// read back. Delete once Duane's store has run it.

import { REVISION } from "@pinetrie/rules"
import type { RecordMigration } from "./index.ts"
import { rewriteRecords } from "./rewrite.ts"

const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A revision record's contents without its turn's shared reads; null for one without them. */
export function withoutSharedReads(contents: unknown): object | null {
  if (!isObject(contents)) return null
  const disk = contents.disk
  if (!isObject(disk)) return null
  const shared = disk.shared
  if (!isObject(shared) || !("read" in shared)) return null
  const { read: _, ...kept } = shared
  return { ...contents, disk: { ...disk, shared: kept } }
}

export const TURN_SHARED_READS: RecordMigration = rewriteRecords({
  name: "0022-turn-shared-reads",
  namespace: REVISION.namespace,
  home: "root",
  rewrite: withoutSharedReads,
})
