// pi/commit — a commit's writes as document operations and index arrivals.
// Pure: `KynetaStorage` gathers the image lookups, writes the operations in
// one batch, and then applies the arrivals.

import type {
  prepareStorageCommit,
  UsageRow,
} from "@earendil-works/pi-agent-core"
import {
  physicalKey,
  type StoredEntryRow,
  type StoredValueRecord,
} from "@pineta/schema"
import type { Arrival, Batch } from "./arrivals.ts"
import { inlineImages, type RefOf } from "./stored-images.ts"
import { toStoredRow } from "./stored-row.ts"
import {
  encodeValue,
  type StoredListElement,
  valueImages,
} from "./stored-values.ts"

/** One of a commit's writes, after pi has given it its seq. */
export type CommittedWrite = ReturnType<
  typeof prepareStorageCommit
>["writes"][number]

/** A usage row as stored: pi's `UsageRow` minus the never-stored `seq`. */
export type StoredUsageRow = Omit<UsageRow, "seq">

export type DocOp =
  | { readonly kind: "entry"; readonly row: StoredEntryRow }
  | { readonly kind: "usage"; readonly row: StoredUsageRow }
  | {
      readonly kind: "value"
      readonly pkey: string
      readonly record: StoredValueRecord
      /** Checkpoint text for `checkpointText`; undefined removes any there. */
      readonly text: string | undefined
    }
  | {
      readonly kind: "element"
      readonly pkey: string
      readonly element: StoredListElement
    }
  | {
      readonly kind: "delete"
      readonly field: "values" | "lists"
      readonly pkey: string
    }

/**
 * The operations that store `writes`, and the arrivals that index them with
 * pi's seqs. `token` makes each value's `wid` and each element's `eid`.
 */
export function planCommit(
  writes: readonly CommittedWrite[],
  deps: { readonly refOf: RefOf; readonly token: () => string },
): { readonly ops: readonly DocOp[]; readonly batch: Batch } {
  const ops: DocOp[] = []
  const arrivals: Arrival[] = []
  for (const write of writes)
    switch (write.kind) {
      case "entry": {
        const { kind: _k, seq, ...entry } = write
        ops.push({ kind: "entry", row: toStoredRow(entry, deps.refOf) })
        arrivals.push({
          kind: "entry",
          id: entry.id,
          seq,
          message: entry.type === "message",
        })
        break
      }
      case "usage": {
        const { kind: _k, seq, ...row } = write
        ops.push({ kind: "usage", row })
        arrivals.push({ kind: "usage", id: row.id, seq, usage: row.usage })
        break
      }
      case "value": {
        const pkey = physicalKey(write.namespace, write.key)
        if (write.op === "delete") {
          ops.push({ kind: "delete", field: "values", pkey })
          arrivals.push({ kind: "gone", field: "values", pkey })
          break
        }
        const wid = deps.token()
        const stored = encodeValue(write.namespace, write.value, deps.refOf)
        ops.push({
          kind: "value",
          pkey,
          record: {
            namespace: write.namespace,
            key: write.key,
            value: stored.value,
            wid,
            ...(stored.text === undefined ? {} : { sealed: true }),
          },
          text: stored.text,
        })
        arrivals.push({ kind: "value", pkey, seq: write.seq, wid })
        break
      }
      case "list": {
        const pkey = physicalKey(write.namespace, write.key)
        if (write.op === "delete") {
          ops.push({ kind: "delete", field: "lists", pkey })
          arrivals.push({ kind: "gone", field: "lists", pkey })
          break
        }
        const eid = deps.token()
        ops.push({
          kind: "element",
          pkey,
          element: { eid, value: write.value },
        })
        arrivals.push({ kind: "element", pkey, eid, seq: write.seq })
        break
      }
    }
  return { ops, batch: { arrivals, through: writes.at(-1)?.seq ?? 0 } }
}

/** The inline images (base64) in a write that `planCommit` may store as references. */
export function imagesOf(write: CommittedWrite): readonly string[] {
  if (write.kind === "entry")
    return write.type === "message" ? inlineImages(write.message) : []
  if (write.kind === "value" && write.op !== "delete")
    return valueImages(write.namespace, write.value)
  return []
}
