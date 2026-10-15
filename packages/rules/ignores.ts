// rules/ignores — whether a project's `.gitignore` files ignore a path, read
// the way git reads them, with no repo. Its own export
// (`@pinetrie/rules/ignores`): the page never imports it, nor the matcher it
// carries.
//
// Each `.gitignore` is one matcher, its patterns relative to its directory,
// walked from the root: the last pattern that matches decides, and a deeper
// file's overrides a shallower one's. `own` (pine·trie's root patterns, a
// lane's `core.excludesFile`) is weaker than any `.gitignore`, as git ranks
// an excludes file. A directory that is ignored hides everything under it,
// whatever a deeper negation says: git never looks inside it.

import ignore, { type Ignore } from "ignore"

/** Each `.gitignore` of a state that bears on some path: its directory, from the root (`""` for the root), and its text. */
export interface IgnoreFile {
  readonly dir: string
  readonly text: string
}

/** The directory holding `p`: `""` at the root. */
const parentOf = (p: string): string =>
  p.slice(0, Math.max(0, p.lastIndexOf("/")))

/** Every directory above `p`, root (`""`) first. */
const ancestorsOf = (p: string): readonly string[] => {
  const parts = p.split("/")
  return parts.map((_, i) => parts.slice(0, i).join("/"))
}

/** The directories whose `.gitignore` decides about `paths`: each one's ancestors, root first, once each. */
export const ignoreDirs = (paths: readonly string[]): readonly string[] =>
  // A directory sorts before every path under it.
  [...new Set(paths.flatMap(ancestorsOf))].sort()

/** `m`'s answer for `rel`, or `before` when no pattern of it matches. */
const verdict = (m: Ignore, rel: string, before: boolean): boolean => {
  const said = m.test(rel)
  return said.ignored ? true : said.unignored ? false : before
}

/**
 * Of `paths`, those `files` and `own` ignore. `dirs` names which of them are
 * directories: a pattern ending in `/` matches only a directory, which git
 * learns from the disk.
 */
export function ignoredPaths(input: {
  readonly files: readonly IgnoreFile[]
  /** pine·trie's own patterns, read as an excludes file at the root. */
  readonly own: string
  readonly paths: readonly string[]
  readonly dirs: ReadonlySet<string>
}): ReadonlySet<string> {
  const own = ignore().add(input.own)
  const byDir = new Map(input.files.map(f => [f.dir, ignore().add(f.text)]))

  /** What the patterns say of `p` alone, the last match deciding. */
  const matched = (p: string, isDir: boolean): boolean => {
    const slash = isDir ? "/" : ""
    const parts = p.split("/")
    let ignored = verdict(own, `${p}${slash}`, false)
    for (let i = 0; i < parts.length; i++) {
      const m = byDir.get(parts.slice(0, i).join("/"))
      if (m !== undefined)
        ignored = verdict(m, `${parts.slice(i).join("/")}${slash}`, ignored)
    }
    return ignored
  }
  const dirIgnored = new Map<string, boolean>()
  const isDirIgnored = (d: string): boolean => {
    if (d === "") return false
    const known = dirIgnored.get(d)
    if (known !== undefined) return known
    const said = isDirIgnored(parentOf(d)) || matched(d, true)
    dirIgnored.set(d, said)
    return said
  }
  return new Set(
    input.paths.filter(
      p => isDirIgnored(parentOf(p)) || matched(p, input.dirs.has(p)),
    ),
  )
}
