// records — the host's records, one `RecordSpec` each.

import {
  type Home,
  type HostNamespace,
  type RootId,
  SESSION_TARGET,
  type Target,
  type ValueWrite,
} from "@pinetrie/core"

export type { Home }

export interface RecordSpec<R, K extends string, H extends Home = Home> {
  readonly namespace: HostNamespace
  readonly home: H
  /**
   * Derived from a document the host holds (the directory's `ROOT`): a
   * record that does not decode is written again from its document, so its
   * shape changes with no migration.
   */
  readonly derived?: true
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

type SetWrite<H extends Home = Home> = Extract<ValueWrite<H>, { kind: "set" }>
type DeleteWrite<H extends Home = Home> = Extract<
  ValueWrite<H>,
  { kind: "delete" }
>

/**
 * Writes grouped by the document they go to, in the order each target first
 * appears.
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
): SetWrite<"session">
export function setRecord<R, K extends string>(
  spec: RecordSpec<R, K, "root">,
  record: NoInfer<R>,
  root: RootId,
): SetWrite<"root">
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
): DeleteWrite<"session">
export function deleteRecord<R, K extends string>(
  spec: RecordSpec<R, K, "root">,
  key: K,
  root: RootId,
): DeleteWrite<"root">
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

/** A namespace as stored (`records[namespace]`) -> its records. */
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
): readonly ValueWrite<"session">[]
export function setIfChanged<R, K extends string>(
  spec: RecordSpec<R, K, "root">,
  record: NoInfer<R>,
  stored: NoInfer<R> | undefined,
  root: RootId,
): readonly ValueWrite<"root">[]
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
