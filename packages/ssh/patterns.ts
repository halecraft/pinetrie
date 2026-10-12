// ssh/patterns — ssh's host patterns, matched as OpenSSH's
// `match_pattern_list` matches them.

/** A list of ssh host patterns, lowercased: what a setting narrows to. */
export type HostPatterns = "all" | readonly string[]

/** Whether `name` matches one pattern: `*` any run of characters, `?` one. */
export function matchesPattern(name: string, pattern: string): boolean {
  // Matched by hand: a RegExp built from a person's pattern could hold
  // anything ssh treats as a literal.
  const n = name.toLowerCase()
  const p = pattern.toLowerCase()
  const at = (i: number, j: number): boolean => {
    if (j === p.length) return i === n.length
    const c = p[j]
    if (c === "*") {
      for (let k = i; k <= n.length; k++) if (at(k, j + 1)) return true
      return false
    }
    if (i === n.length) return false
    return (c === "?" || c === n[i]) && at(i + 1, j + 1)
  }
  return at(0, 0)
}

/**
 * Whether `name` passes a pattern list, as ssh decides a `Host` line: any
 * negated pattern (`!pattern`) that matches fails it, and otherwise one
 * positive match passes it. Each entry may itself be a comma-separated list.
 */
export function isHostAllowed(name: string, hosts: HostPatterns): boolean {
  if (hosts === "all") return true
  const patterns = hosts.flatMap(h => h.split(",")).filter(p => p !== "")
  let positive = false
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (matchesPattern(name, pattern.slice(1))) return false
    } else if (matchesPattern(name, pattern)) positive = true
  }
  return positive
}

/** Whether a pattern names one host: no wildcard, no negation. */
export const isConcrete = (pattern: string): boolean => !/[*?!]/.test(pattern)
