// core/fixtures — test support: a count of a function's collection steps,
// the paths a `seq` key appears at, and snapshot names of each owner, fixed
// and generated. Other packages' tests import it as `@pinetrie/core/fixtures`;
// production code never imports it.

import fc from "fast-check"
import { type SnapshotId, snapshotId } from "./disks.ts"
import type { SnapshotOwner } from "./snapshots.ts"

type Patched = Record<PropertyKey, unknown>

/**
 * `f`'s result, and how many steps every Map and Set iteration took while it
 * ran: spread, `for … of`, `keys`, `values`, `entries`, `forEach`, and
 * `new Set(iterable)`. A linear fold takes a few per item; one that scans a
 * collection per item takes its square.
 *
 * It wraps both prototypes' iterators until `f` returns, so `f` must be
 * synchronous: nothing else may run while they are wrapped, and a test that
 * counts must not be `test.concurrent`. Lookups (`get`, `has`, `set`,
 * `delete`) are not counted.
 */
export function collectionSteps<T>(f: () => T): {
  readonly result: T
  readonly steps: number
} {
  let steps = 0
  const saved: (readonly [Patched, PropertyKey, unknown])[] = []
  for (const proto of [Map.prototype, Set.prototype] as unknown as Patched[]) {
    for (const key of ["keys", "values", "entries", Symbol.iterator]) {
      const own = proto[key] as (this: unknown) => Iterator<unknown>
      saved.push([proto, key, own])
      proto[key] = function* (this: unknown) {
        for (const v of { [Symbol.iterator]: () => own.call(this) }) {
          steps++
          yield v
        }
      }
    }
    const forEach = proto.forEach as (
      this: unknown,
      each: (...a: unknown[]) => void,
      self?: unknown,
    ) => void
    saved.push([proto, "forEach", forEach])
    proto.forEach = function (
      this: unknown,
      each: (...a: unknown[]) => void,
      self?: unknown,
    ) {
      forEach.call(this, (...a: unknown[]) => {
        steps++
        each.apply(self, a)
      })
    }
  }
  try {
    const result = f()
    return { result, steps }
  } finally {
    for (const [proto, key, own] of saved) proto[key] = own
  }
}

/**
 * The paths at which a `seq` key appears, so a test can assert none do: seq
 * is local to one replica, so none may be stored or sent. A brand cannot keep
 * one out, since a branded number drops into any `number` field.
 */
export function findSeqKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = []
  if (value === null || typeof value !== "object") return hits
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      hits.push(...findSeqKeys(v, `${path}[${i}]`))
    })
    return hits
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === "seq") hits.push(`${path}.${k}`)
    hits.push(...findSeqKeys(v, `${path}.${k}`))
  }
  return hits
}

/**
 * A fixed entry snapshot's name, UUIDv7-shaped from `n` and `tag`, so a
 * test's snapshots are an entry's (`snapshotOwner`) and two tests' never
 * meet when their tags differ.
 */
export const entrySnapshotId = (n: number, tag = 0): SnapshotId =>
  snapshotId(
    `${tag.toString(16).padStart(8, "0")}-0000-7000-8000-${n.toString(16).padStart(12, "0")}`,
  )

const FOLDER_PREFIXES = [
  "line",
  "turn",
  "start",
  "get-latest",
  "resolve",
  "restore",
  "concurrent",
] as const

/**
 * Names of each owner, for property tests. `unknown` covers the shapes no
 * owner holds: a jj commit's 40 hex digits, a name with no dash, one in the
 * making (`.tmp`), and path tricks.
 */
export const SNAPSHOT_NAMES: {
  readonly [O in SnapshotOwner]: fc.Arbitrary<string>
} = {
  entry: fc.uuid({ version: 7 }),
  "folder-state": fc.oneof(
    fc
      .tuple(fc.constantFrom(...FOLDER_PREFIXES), fc.uuid({ version: 7 }))
      .map(([p, u]) => `${p}-${u}`),
    fc
      .tuple(
        fc.constantFrom("bases", "shown"),
        fc.stringMatching(/^[0-9a-f]{32}$/),
      )
      .map(([p, h]) => `${p}-${h}`),
  ),
  base: fc.constant("base"),
  unknown: fc.oneof(
    fc.stringMatching(/^[0-9a-f]{40}$/),
    fc
      .stringMatching(/^[A-Za-z0-9][A-Za-z0-9._]{0,20}$/)
      .filter(n => n !== "base" && !n.endsWith(".tmp")),
    fc.uuid({ version: 7 }).map(u => `${u}.tmp`),
    fc.constantFrom("", ".", "..", "a/b", "-x", "../../x"),
  ),
}

/** A snapshot name and the owner it was made for. */
export const OWNED_SNAPSHOT_NAME = fc.oneof(
  ...(Object.keys(SNAPSHOT_NAMES) as SnapshotOwner[]).map(owner =>
    SNAPSHOT_NAMES[owner].map(name => ({ owner, name })),
  ),
)
