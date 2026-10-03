// records — the host's records, one `RecordSpec` each (ADR-0062).
//
// A record is a pi value at an address, `(namespace, key)`. The address
// holds the record's key, and the stored contents never repeat it: a spec's
// `encode` leaves the key out, and its `decode` checks the address and puts
// it back. So a write and a read cannot disagree on a key, and the host and
// the client read records whole. A value written before this kept its key in
// its contents too; `decode` sets the key after the contents, so the address
// wins over that copy.

import type { HostNamespace, ValueWrite } from "@pineta/core"

export interface RecordSpec<R, K extends string> {
  readonly namespace: HostNamespace
  /** The address a write goes to. */
  readonly keyOf: (record: R) => K
  /** The plain JSON contents stored, without the key. */
  readonly encode: (record: R) => unknown
  /**
   * Contents and address -> the record, or undefined when either is
   * malformed. Total (`decodeWith`).
   */
  readonly decode: (contents: unknown, key: string) => R | undefined
}

export const setRecord = <R, K extends string>(
  spec: RecordSpec<R, K>,
  record: NoInfer<R>,
): Extract<ValueWrite, { kind: "set" }> => ({
  kind: "set",
  namespace: spec.namespace,
  key: spec.keyOf(record),
  value: spec.encode(record),
})

export const deleteRecord = <R, K extends string>(
  spec: RecordSpec<R, K>,
  key: K,
): Extract<ValueWrite, { kind: "delete" }> => ({
  kind: "delete",
  namespace: spec.namespace,
  key,
})

/** Stored values -> each decoded record, by its address; malformed ones dropped. */
export function recordsOf<R, K extends string>(
  spec: RecordSpec<R, K>,
  values: Iterable<{ readonly key: string; readonly value: unknown }>,
): ReadonlyMap<K, R> {
  const out = new Map<K, R>()
  for (const { key, value } of values) {
    const record = spec.decode(value, key)
    if (record !== undefined) out.set(spec.keyOf(record), record)
  }
  return out
}

/** Plain JSON with every object's keys sorted, so key order never counts. */
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, sorted((v as Record<string, unknown>)[k])]),
        )
      : v

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

/**
 * Whether `record` differs from what is stored; nothing stored is a change.
 * The host writes a record only when it changed: a write compacted with no
 * client connected moves the document's base past what a new client
 * reports. A decoder may build its fields in another order than the code
 * that made the new record, so the order of keys is ignored.
 */
const recordChanged = <R, K extends string>(
  spec: RecordSpec<R, K>,
  record: NoInfer<R>,
  stored: NoInfer<R> | undefined,
): boolean =>
  stored === undefined || !sameJson(spec.encode(record), spec.encode(stored))

/** The write that stores `record`, if it changed (`recordChanged`); else none. */
export const setIfChanged = <R, K extends string>(
  spec: RecordSpec<R, K>,
  record: NoInfer<R>,
  stored: NoInfer<R> | undefined,
): readonly ValueWrite[] =>
  recordChanged(spec, record, stored) ? [setRecord(spec, record)] : []
