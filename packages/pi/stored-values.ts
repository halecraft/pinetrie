// pi/stored-values — how pi's values are stored, by namespace. Two of pi's
// namespaces are stored differently from the value pi wrote: a tool-output
// checkpoint as a shell plus text edits (`checkpoint.ts`), and a pending
// entry with its message's images as references. Every other value is
// stored as it is. `KynetaStorage` gathers the lookups.

import { pendingAssistantFrames } from "@earendil-works/pi-agent-core"
import type { StoredValueRecord } from "@pinetrie/schema"
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

/**
 * The namespaces kept in a root's scratch document: pending state that
 * belongs to one operation, which its cleanup deletes. A queued message's
 * `PENDING_ENTRY_NAMESPACE` is not among them: it can wait in a lane's inbox
 * past an operation. The frames' name is read from pi, so a rename in an
 * upgrade moves with it.
 */
export const SCRATCH_NAMESPACES: ReadonlySet<string> = new Set([
  pendingAssistantFrames("", "").namespace,
  CHECKPOINT_NAMESPACE,
])

/** Whether a physical key (`physicalKey`: a namespace, a NUL, then the key) is kept in the scratch document. */
export function isScratchKey(pkey: string): boolean {
  const nul = pkey.indexOf("\u0000")
  return nul >= 0 && SCRATCH_NAMESPACES.has(pkey.slice(0, nul))
}

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
