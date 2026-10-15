type Proto = Record<PropertyKey, unknown>
export function collectionSteps<T>(f: () => T): { result: T; steps: number } {
  let steps = 0
  const saved: [Proto, PropertyKey, unknown][] = []
  const wrapIter = (proto: Proto, key: PropertyKey) => {
    const orig = proto[key] as (this: unknown) => Iterator<unknown>
    saved.push([proto, key, orig])
    proto[key] = function* (this: unknown) {
      for (const v of { [Symbol.iterator]: () => orig.call(this) }) {
        steps++
        yield v
      }
    }
  }
  const wrapForEach = (proto: Proto) => {
    const orig = proto.forEach as (
      this: unknown,
      cb: (...a: unknown[]) => void,
      t?: unknown,
    ) => void
    saved.push([proto, "forEach", orig])
    proto.forEach = function (
      this: unknown,
      cb: (...a: unknown[]) => void,
      t?: unknown,
    ) {
      orig.call(this, (...a: unknown[]) => {
        steps++
        cb.apply(t, a)
      })
    }
  }
  for (const proto of [Map.prototype, Set.prototype] as unknown as Proto[]) {
    for (const k of ["keys", "values", "entries", Symbol.iterator])
      wrapIter(proto, k)
    wrapForEach(proto)
  }
  try {
    return { result: f(), steps }
  } finally {
    for (const [p, k, o] of saved) p[k] = o
  }
}
