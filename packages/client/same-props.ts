// client/same-props — `React.memo`'s rule from a table of how each prop is
// compared, pure: `Message`'s (`message-props.ts`) and the review's
// (`review-pane.tsx`) (S54).

/** `value`: plain data rebuilt on every render, compared by content. `identity`: kept while unchanged. */
export type PropRule = "identity" | "value"

/**
 * Whether two sets of props draw the same, prop by prop as `rules` says. The
 * table names every prop, so a prop added to `P` fails to compile until it is
 * given a rule.
 */
export function sameProps<P extends object>(
  rules: {
    readonly [K in keyof P]-?: PropRule
  },
): (a: P, b: P) => boolean {
  const keys = Object.keys(rules) as (keyof P)[]
  return (a, b) =>
    keys.every(k =>
      rules[k] === "value" ? sameData(a[k], b[k]) : Object.is(a[k], b[k]),
    )
}

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
