// interface/codec — a value's stored form, both ways: how any client keeps a
// value it chose, wherever it keeps it (the page's `tab-state.ts`).

/** A value's stored form, both ways. `decode` is total: it never throws. */
export interface Codec<T> {
  readonly encode: (value: T) => unknown
  readonly decode: (raw: unknown) => T | undefined
}
