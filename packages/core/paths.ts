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

/** The names along absolute `p`, `.`, `..` and a doubled `/` resolved: `..` at `/` stays there, as the kernel's does. */
const segments = (p: string): string[] => {
  const names: string[] = []
  for (const s of p.split("/")) {
    if (s === "..") names.pop()
    else if (s !== "" && s !== ".") names.push(s)
  }
  return names
}

/**
 * `p` relative to `root`, `""` for `root` itself, once `.`, `..` and a
 * doubled `/` are resolved in both; null for a relative path, or one that
 * leaves `root`. Symbolic links are not followed: this reads strings.
 */
export function pathUnder(root: string, p: string): string | null {
  if (!root.startsWith("/") || !p.startsWith("/")) return null
  const under = segments(root)
  const names = segments(p)
  return under.every((s, i) => names[i] === s)
    ? names.slice(under.length).join("/")
    : null
}
