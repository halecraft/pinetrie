// config/kinds — what one setting's value is: how it is decoded from JSON,
// and, where the value allows, how two combine. A limit narrows with `meet`
// and a join adds with `join`, so a kind without `meet` cannot be limited
// and one without `join` cannot be joined (`setting.ts`).

/** A decoded value, or why the JSON was refused. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly why: string }

/**
 * `"host"`: the value runs code on the host or sends a key somewhere, so
 * only the machine's and the person's own files may set it.
 */
export type Reach = "anywhere" | "host"

export interface Kind<T, R extends Reach = Reach> {
  readonly reach: R
  readonly decode: (json: unknown) => Decoded<T>
  /** The greatest value below both: what a limit narrows with. */
  readonly meet?: (a: T, b: T) => T
  /** Both values together: what a join adds with. */
  readonly join?: (a: T, b: T) => T
  /** Where a join starts. */
  readonly empty?: T
  readonly same: (a: T, b: T) => boolean
}

/** A kind whose values narrow: it can be limited. */
export interface Meets<T> {
  readonly meet: (a: T, b: T) => T
}

/** A kind whose values add up: it can be joined. */
export interface Joins<T> {
  readonly join: (a: T, b: T) => T
  readonly empty: T
}

/** The value a kind decodes. */
export type KindValue<K> = K extends {
  readonly decode: (json: unknown) => Decoded<infer T>
}
  ? T
  : never

export const decoded = <T>(value: T): Decoded<T> => ({ ok: true, value })
export const refused = (why: string): Decoded<never> => ({ ok: false, why })

/** Two JSON-shaped values are the same: same type, same fields, in any order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every(k => k in b && sameValue(a[k], b[k]))
    )
  }
  return false
}

export const isPlainObject = (
  v: unknown,
): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** `true` or `false`. A limit is `and`, a join `or`. */
export const flag = (): Kind<boolean, "anywhere"> &
  Meets<boolean> &
  Joins<boolean> => ({
  reach: "anywhere",
  decode: v =>
    typeof v === "boolean" ? decoded(v) : refused("is not true or false"),
  meet: (a, b) => a && b,
  join: (a, b) => a || b,
  empty: false,
  same: (a, b) => a === b,
})

/** A whole number from `min` to `max`. A limit is the smaller. */
export const count = (bounds: {
  readonly min: number
  readonly max?: number
}): Kind<number, "anywhere"> & Meets<number> => ({
  reach: "anywhere",
  decode: v =>
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= bounds.min &&
    (bounds.max === undefined || v <= bounds.max)
      ? decoded(v)
      : refused(
          bounds.max === undefined
            ? `is not a whole number of at least ${bounds.min}`
            : `is not a whole number from ${bounds.min} to ${bounds.max}`,
        ),
  meet: (a, b) => Math.min(a, b),
  same: (a, b) => a === b,
})

/** One of `values`, exactly as written. Two choices have no order, so no limit. */
export const choice = <const V extends string>(
  values: readonly V[],
): Kind<V, "anywhere"> => ({
  reach: "anywhere",
  decode: v =>
    values.find(x => x === v) !== undefined
      ? decoded(v as V)
      : refused(`is not one of ${values.join(", ")}`),
  same: (a, b) => a === b,
})

/**
 * A string `parse` takes, as what `parse` makes of it; null from `parse`
 * refuses, with `why`.
 */
export const text = <T>(
  parse: (s: string) => T | null,
  why: string,
): Kind<T, "anywhere"> => ({
  reach: "anywhere",
  decode: v => {
    const parsed = typeof v === "string" ? parse(v) : null
    return parsed === null ? refused(why) : decoded(parsed)
  },
  same: sameValue,
})

/**
 * A value a caller's decoder makes of any JSON. It has no `meet` and no
 * `join`: whoever needs one builds the kind with them.
 */
export const shaped = <T>(
  decode: (json: unknown) => Decoded<T>,
): Kind<T, "anywhere"> => ({ reach: "anywhere", decode, same: sameValue })

/**
 * A list of `item`s. A join adds what is new, in order; a limit keeps what
 * both lists hold. A list refuses whole when any item is refused.
 */
export function list<T>(
  item: Kind<T, Reach>,
): Kind<readonly T[], "anywhere"> & Meets<readonly T[]> & Joins<readonly T[]> {
  const has = (xs: readonly T[], x: T) => xs.some(y => item.same(x, y))
  return {
    reach: "anywhere",
    decode: v => {
      if (!Array.isArray(v)) return refused("is not a list")
      const out: T[] = []
      for (const [i, x] of v.entries()) {
        const one = item.decode(x)
        if (!one.ok) return refused(`item ${i + 1} ${one.why}`)
        if (!has(out, one.value)) out.push(one.value)
      }
      return decoded(out)
    },
    meet: (a, b) => a.filter(x => has(b, x)),
    join: (a, b) => [...a, ...b.filter(x => !has(a, x))],
    empty: [],
    same: (a, b) => a.length === b.length && a.every(x => has(b, x)),
  }
}

/**
 * Names to `value`s. A join adds the names it lacks, so the earlier layer
 * keeps a name both set. A record refuses whole when any value is refused.
 */
export function record<T>(
  value: Kind<T, Reach>,
): Kind<Readonly<Record<string, T>>, "anywhere"> &
  Joins<Readonly<Record<string, T>>> {
  return {
    reach: "anywhere",
    decode: v => {
      if (!isPlainObject(v)) return refused("is not an object")
      const out: Record<string, T> = {}
      for (const [k, x] of Object.entries(v)) {
        const one = value.decode(x)
        if (!one.ok) return refused(`"${k}" ${one.why}`)
        out[k] = one.value
      }
      return decoded(out)
    },
    join: (a, b) => ({ ...b, ...a }),
    empty: {},
    same: sameValue,
  }
}

/** `kind`, marked as running code on the host or sending a key somewhere. */
export const hostCode = <K extends { readonly reach: Reach }>(
  kind: K,
): Omit<K, "reach"> & { readonly reach: "host" } => ({
  ...kind,
  reach: "host",
})
