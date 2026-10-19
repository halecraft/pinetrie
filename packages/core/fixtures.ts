// core/fixtures — test support: a count of a function's collection steps, and
// the paths a `seq` key appears at. Other packages' tests import it as
// `@pinetrie/core/fixtures`; production code never imports it.

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
