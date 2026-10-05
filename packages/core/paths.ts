// core/paths — paths compared as strings, since the client loads this
// package in the browser, where there is no `node:path`.

/**
 * Whether `inner` is `outer` or inside it. Both absolute and normalized: a
 * `..` or a doubled `/` is not resolved.
 */
export function isWithin(inner: string, outer: string): boolean {
  return (
    inner === outer ||
    inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`)
  )
}
