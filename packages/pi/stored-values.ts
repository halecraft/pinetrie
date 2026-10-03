// pi/stored-values — how pi's values are stored, by namespace. Two of pi's
// namespaces are stored differently from the value pi wrote: a tool-output
// checkpoint as a shell plus text edits (`checkpoint.ts`, S22), and a pending
// entry with its message's images as references (ADR-0051). Every other value
// is stored as it is. Pure; `KynetaStorage` gathers the lookups.

import type { StoredValueRecord } from "@pineta/schema"
import {
  CHECKPOINT_NAMESPACE,
  sealCheckpoint,
  unsealCheckpoint,
} from "./checkpoint.ts"
import {
  type BlobOf,
  pendingImages,
  type RefOf,
  rejoinPendingEntry,
  splitPendingEntry,
} from "./stored-images.ts"

/** The namespace of pi's `pendingEntry` values: a message before its entry. */
export const PENDING_ENTRY_NAMESPACE = "pi.pending.entry"

/** One element of a stored list. `eid` is the per-append identity token. */
export interface StoredListElement {
  readonly eid: string
  readonly value: unknown
}

/**
 * A value as the record stores it, and the checkpoint text that goes to
 * `checkpointText` beside it, if any.
 */
export function encodeValue(
  namespace: string,
  value: unknown,
  refOf: RefOf,
): { readonly value: unknown; readonly text: string | undefined } {
  const sealed =
    namespace === CHECKPOINT_NAMESPACE ? sealCheckpoint(value) : undefined
  if (sealed !== undefined) return { value: sealed.shell, text: sealed.text }
  return namespace === PENDING_ENTRY_NAMESPACE
    ? { value: splitPendingEntry(value, refOf), text: undefined }
    : { value, text: undefined }
}

/**
 * A stored record's value as pi wrote it. `textOf` reads the record's
 * checkpoint text, and is called only for a sealed record.
 */
export function decodeValue(
  record: StoredValueRecord,
  textOf: () => string,
  blobOf: BlobOf,
): unknown {
  if (record.sealed === true) return unsealCheckpoint(record.value, textOf())
  return record.namespace === PENDING_ENTRY_NAMESPACE
    ? rejoinPendingEntry(record.value, blobOf)
    : record.value
}

/** The inline images (base64) `encodeValue` may store as references. */
export const valueImages = (namespace: string, value: unknown): string[] =>
  namespace === PENDING_ENTRY_NAMESPACE ? pendingImages(value) : []
