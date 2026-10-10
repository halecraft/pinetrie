// pi/commit — a commit's writes as document operations and index arrivals.
// Pure: `KynetaStorage` gathers the image lookups, writes the operations in
// one batch, and then applies the arrivals.

import type {
  prepareStorageCommit,
  UsageRow,
} from "@earendil-works/pi-agent-core"
import type { ThreadId } from "@pinetrie/core"
import {
  LANE_TIP,
  physicalKey,
  type StoredEntryRow,
  type StoredValueRecord,
} from "@pinetrie/schema"
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
 * The thread of a commit's entries (ADR-0125): the one its context names,
 * else `fallback`, which only pi's conformance suite gives. Throws when
 * neither names one, or when the commit moves the tip of a lane other than
 * the thread its context names: a lane is named by its thread (ADR-0120),
 * so its entries can be in no other. A fallback says nothing about lanes,
 * so tips are not checked against it. Pure.
 */
export function threadOfEntries(
  writes: readonly CommittedWrite[],
  named: ThreadId | undefined,
  fallback: ThreadId | undefined,
): ThreadId {
  if (named === undefined) {
    if (fallback === undefined)
      throw new Error("commit has entries, but its context names no thread")
    return fallback
  }
  for (const write of writes)
    if (
      write.kind === "value" &&
      write.namespace === LANE_TIP &&
      write.key !== named
    )
      throw new Error(
        `commit in thread ${named} moves the tip of lane ${write.key}`,
      )
  return named
}

/**
 * The operations that store `writes`, and the arrivals that index them with
 * pi's seqs. `token` makes each value's `wid` and each element's `eid`.
 * Every entry is in `threadOfEntries`' thread, from the thread the commit's
 * context names (`named`), else `fallback`; a commit with no entry needs
 * neither.
 */
export function planCommit(
  writes: readonly CommittedWrite[],
  deps: {
    readonly refOf: RefOf
    readonly token: () => string
    readonly named: ThreadId | undefined
    readonly fallback: ThreadId | undefined
  },
): { readonly ops: readonly DocOp[]; readonly batch: Batch } {
  const ops: DocOp[] = []
  const arrivals: Arrival[] = []
  let thread: ThreadId | undefined
  for (const write of writes)
    switch (write.kind) {
      case "entry": {
        const { kind: _k, seq, ...entry } = write
        thread ??= threadOfEntries(writes, deps.named, deps.fallback)
        ops.push({
          kind: "entry",
          row: toStoredRow(entry, deps.refOf, thread),
        })
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
