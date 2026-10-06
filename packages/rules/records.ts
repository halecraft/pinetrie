// records — the host's records, one `RecordSpec` each (ADR-0062).
//
// A record is a pi value at an address, `(namespace, key)`. The address
// holds the record's key, and the stored contents never repeat it: a spec's
// `encode` leaves the key out, and its `decode` checks the address and puts
// it back. So a write and a read cannot disagree on a key, and the host and
// the client read records whole. A value written before this kept its key in
// its contents too; `decode` sets the key after the contents, so the address
// wins over that copy.
//
// A record lives in one document, its `home` (ADR-0063): the session's, for
// what is read across roots, or a root's, for what is keyed by its entries.
// The home is in the spec's type, so a root-homed write cannot be built
// without its root, and a session-homed one cannot be given one.

import {
  type HostNamespace,
  type RootId,
  SESSION_TARGET,
  type Target,
  type ValueWrite,
} from "@pinetrie/core"

/** Which document a record lives in (ADR-0063). */
export type Home = "session" | "root"

export interface RecordSpec<R, K extends string, H extends Home = Home> {
  readonly namespace: HostNamespace
  readonly home: H
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

type SetWrite = Extract<ValueWrite, { kind: "set" }>
type DeleteWrite = Extract<ValueWrite, { kind: "delete" }>

/**
 * Writes grouped by the document they go to, in the order each target first
 * appears. Pure.
 */
export function byTarget(
  writes: readonly ValueWrite[],
): readonly (readonly [Target, readonly ValueWrite[]])[] {
  const groups = new Map<string, [Target, ValueWrite[]]>()
  for (const w of writes) {
    const key = w.target.kind === "session" ? "" : w.target.root
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [w.target, [w]])
    else group[1].push(w)
  }
  return [...groups.values()]
}

/** Where a write goes: the session, or the root the overloads below demand. */
const targetOf = (root: RootId | undefined): Target =>
  root === undefined ? SESSION_TARGET : { kind: "root", root }

export function setRecord<R, K extends string>(
  spec: RecordSpec<R, K, "session">,
  record: NoInfer<R>,
): SetWrite
export function setRecord<R, K extends string>(
  spec: RecordSpec<R, K, "root">,
  record: NoInfer<R>,
  root: RootId,
): SetWrite
export function setRecord<R, K extends string>(
  spec: RecordSpec<R, K>,
  record: NoInfer<R>,
  root?: RootId,
): SetWrite {
  return {
    kind: "set",
    target: targetOf(root),
    namespace: spec.namespace,
    key: spec.keyOf(record),
    value: spec.encode(record),
  }
}

export function deleteRecord<R, K extends string>(
  spec: RecordSpec<R, K, "session">,
  key: K,
): DeleteWrite
export function deleteRecord<R, K extends string>(
  spec: RecordSpec<R, K, "root">,
  key: K,
  root: RootId,
): DeleteWrite
export function deleteRecord<R, K extends string>(
  spec: RecordSpec<R, K>,
  key: K,
  root?: RootId,
): DeleteWrite {
  return {
    kind: "delete",
    target: targetOf(root),
    namespace: spec.namespace,
    key,
  }
}

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

/** A namespace as stored (`records[namespace]`, ADR-0095) -> its records. */
export const recordsIn = <R, K extends string>(
  spec: RecordSpec<R, K>,
  namespace: Readonly<Record<string, unknown>>,
): ReadonlyMap<K, R> =>
  recordsOf(
    spec,
    Object.entries(namespace).map(([key, value]) => ({ key, value })),
  )

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
export function setIfChanged<R, K extends string>(
  spec: RecordSpec<R, K, "session">,
  record: NoInfer<R>,
  stored: NoInfer<R> | undefined,
): readonly ValueWrite[]
export function setIfChanged<R, K extends string>(
  spec: RecordSpec<R, K, "root">,
  record: NoInfer<R>,
  stored: NoInfer<R> | undefined,
  root: RootId,
): readonly ValueWrite[]
export function setIfChanged<R, K extends string>(
  spec: RecordSpec<R, K>,
  record: NoInfer<R>,
  stored: NoInfer<R> | undefined,
  root?: RootId,
): readonly ValueWrite[] {
  if (!recordChanged(spec, record, stored)) return []
  return [
    {
      kind: "set",
      target: targetOf(root),
      namespace: spec.namespace,
      key: spec.keyOf(record),
      value: spec.encode(record),
    },
  ]
}
