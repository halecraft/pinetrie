// interface/same-data — structural equality of plain data: what a read compares
// to keep a value while it is unchanged (`projection.ts`), and the page's
// memo rules (`same-props.ts`).

const isPlain = (x: object): boolean => {
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

/**
 * Structural equality of plain objects, arrays, `Map`s and primitives. A
 * map's keys are compared by identity, its values structurally. Anything
 * else, a `Set` or a function, is equal only to itself.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object") return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    return a.length === b.length && a.every((x, i) => sameData(x, b[i]))
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return false
    if (a.size !== b.size) return false
    for (const [k, v] of a)
      if (!b.has(k) || !sameData(v, b.get(k))) return false
    return true
  }
  if (!isPlain(a) || !isPlain(b)) return false
  const ka = Object.keys(a)
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  return (
    ka.length === Object.keys(b).length &&
    ka.every(k => Object.hasOwn(b, k) && sameData(ra[k], rb[k]))
  )
}
