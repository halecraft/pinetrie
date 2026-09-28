// Decoding for every shape Pineta stores inside pi.
//
// Stored values are `Schema.any()` in the document and may come from any
// replica, so decoding is total: a malformed value is dropped, never thrown.
// One bad value must not break every client's render.

import type { Static, TSchema } from "typebox"
import { Value } from "typebox/value"

/** Check `value` against `schema`, then brand it with `build`; undefined if it does not match. */
export function decodeWith<S extends TSchema, T>(
  schema: S,
  value: unknown,
  build: (wire: Static<S>) => T,
): T | undefined {
  return Value.Check(schema, value) ? build(value as Static<S>) : undefined
}

/** Every stored value `decode` accepts, in the order given; the rest dropped. */
export function decodeAll<T>(
  values: Iterable<{ readonly value: unknown }>,
  decode: (value: unknown) => T | undefined,
): T[] {
  const out: T[] = []
  for (const { value } of values) {
    const decoded = decode(value)
    if (decoded !== undefined) out.push(decoded)
  }
  return out
}
