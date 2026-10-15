// host/migrations/rewrite — a one-time change to one namespace's records,
// record by record: the executor a record migration that only reshapes its
// own records runs on. It reads every document the namespace lives in, plans
// each record's write with the migration's pure rewrite, and writes only
// once every document has loaded.

import {
  type HostNamespace,
  rootOfDocId,
  SESSION_TARGET,
  type Target,
  type ValueWrite,
} from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import {
  applyRecordWrites,
  type RecordsDocHandle,
  RootDoc,
  readNamespace,
  SessionDoc,
} from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

/**
 * A record's contents in the new shape; null for contents already in it, or
 * not this migration's to change. It must be null for its own output, so a
 * second run finds nothing.
 */
export type Rewrite = (contents: unknown) => object | null

/** Each stored record `rewrite` changes, as its write to `target`. */
export const planRewrites = (
  namespace: HostNamespace,
  target: Target,
  stored: Readonly<Record<string, unknown>>,
  rewrite: Rewrite,
): readonly ValueWrite[] =>
  Object.entries(stored).flatMap(([key, contents]) => {
    const value = rewrite(contents)
    return value === null
      ? []
      : [{ kind: "set", target, namespace, key, value } as const]
  })

/**
 * A record migration that rewrites each of `namespace`'s records in its
 * home: the session's document, or every root's.
 */
export function rewriteRecords(spec: {
  readonly name: string
  readonly namespace: HostNamespace
  readonly home: "session" | "root"
  readonly rewrite: Rewrite
}): RecordMigration {
  return {
    name: spec.name,
    async run({ exchange, docIds, hydrated }) {
      const docs: { doc: RecordsDocHandle; target: Target; id: string }[] =
        spec.home === "session"
          ? docIds.includes(SESSION_DOC_ID)
            ? [
                {
                  doc: exchange.get(SESSION_DOC_ID, SessionDoc),
                  target: SESSION_TARGET,
                  id: SESSION_DOC_ID,
                },
              ]
            : []
          : docIds.flatMap(id => {
              const root = rootOfDocId(id)
              return root === undefined
                ? []
                : [
                    {
                      doc: exchange.get(id, RootDoc),
                      target: { kind: "root", root } as const,
                      id,
                    },
                  ]
            })
      const planned: {
        readonly doc: RecordsDocHandle
        readonly writes: readonly ValueWrite[]
      }[] = []
      for (const { doc, target, id } of docs) {
        await hydrated(id)
        const writes = planRewrites(
          spec.namespace,
          target,
          readNamespace(doc, spec.namespace),
          spec.rewrite,
        )
        if (writes.length > 0) planned.push({ doc, writes })
      }
      if (planned.length === 0) return null
      return async () => {
        for (const { doc, writes } of planned) applyRecordWrites(doc, writes)
      }
    },
  }
}
