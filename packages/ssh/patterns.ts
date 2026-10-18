// ssh/patterns — ssh's host patterns, matched as OpenSSH's
// `match_pattern_list` matches them.

import { parseSshName, type SshName } from "./names.ts"

/** A list of ssh host patterns, as the person wrote them: what a setting narrows to. */
export type HostPatterns = "all" | readonly string[]

/** One pattern of a list, its comma-separated entries split. */
export type HostPattern =
  /** No wildcard and no negation, and safe to hand `ssh -G`. */
  | { readonly kind: "name"; readonly name: SshName }
  | { readonly kind: "wild"; readonly pattern: string }
  /** `!pattern`, without its `!`. */
  | { readonly kind: "not"; readonly pattern: string }

/**
 * A list's patterns. Each entry may itself be a comma-separated list, as a
 * `Host` line's is. A pattern with no wildcard that `parseSshName` refuses
 * is `wild`: matched as written, never handed to ssh.
 */
export function hostPatternList(
  hosts: readonly string[],
): readonly HostPattern[] {
  return hosts
    .flatMap(h => h.split(","))
    .filter(p => p !== "")
    .map((p): HostPattern => {
      if (p.startsWith("!")) return { kind: "not", pattern: p.slice(1) }
      const name = /[*?]/.test(p) ? null : parseSshName(p)
      return name === null
        ? { kind: "wild", pattern: p }
        : { kind: "name", name }
    })
}

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
 * Whether `name` passes a list's patterns, as ssh decides a `Host` line:
 * any negated pattern that matches fails it, and otherwise one positive
 * match passes it.
 */
export function isNamePassed(
  name: string,
  patterns: readonly HostPattern[],
): boolean {
  let positive = false
  for (const p of patterns) {
    if (p.kind === "not") {
      if (matchesPattern(name, p.pattern)) return false
    } else if (matchesPattern(name, p.kind === "name" ? p.name : p.pattern))
      positive = true
  }
  return positive
}

export const isHostAllowed = (name: string, hosts: HostPatterns): boolean =>
  hosts === "all" || isNamePassed(name, hostPatternList(hosts))
