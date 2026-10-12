// ssh/config — ssh config text read as OpenSSH reads it: lines into a
// keyword and its arguments, `Host` blocks, and `Include`s put in place.
// Reading the included files is the caller's: `missingIncludes` says which,
// and `inlineIncludes` puts what was read in place.

import path from "node:path"

export interface SshLine {
  /** Lowercased: ssh's keywords are case-insensitive. */
  readonly keyword: string
  readonly args: readonly string[]
}

export interface SshBlock {
  /** Its `Host` patterns; `["*"]` for the lines before the first `Host`. */
  readonly patterns: readonly string[]
  readonly lines: readonly SshLine[]
}

/** How deep `Include`s nest before ssh refuses the file. */
export const INCLUDE_DEPTH = 16

/**
 * A line's words after its keyword, as OpenSSH's `argv_split` makes them:
 * single and double quotes group, a backslash escapes a quote, a space or a
 * backslash, and a `#` that starts a word ends the line.
 */
export function splitArgs(text: string): readonly string[] {
  const words: string[] = []
  let word = ""
  let inWord = false
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ""
    if (quote === null && /\s/.test(c)) {
      if (inWord) words.push(word)
      word = ""
      inWord = false
      continue
    }
    if (quote === null && !inWord && c === "#") break
    inWord = true
    const next = text[i + 1]
    if (c === "\\" && next !== undefined && /[\\'" ]/.test(next)) {
      word += next
      i++
    } else if (quote === null && (c === '"' || c === "'")) quote = c
    else if (c === quote) quote = null
    else word += c
  }
  if (inWord) words.push(word)
  return words
}

/** One line as keyword and arguments; null for a blank line or a comment. */
export function parseLine(line: string): SshLine | null {
  const text = line.replace(/\r$/, "").trim()
  if (text === "" || text.startsWith("#")) return null
  // ssh's keyword ends at whitespace or at one `=`: `Host=a`, `Port = 22`.
  const keyword = /^[^\s=]+/.exec(text)?.[0] ?? ""
  const rest = text.slice(keyword.length).replace(/^\s*=?\s*/, "")
  return { keyword: keyword.toLowerCase(), args: splitArgs(rest) }
}

/**
 * The `Host` blocks of a config whose `Include`s are already in place.
 * `Match` blocks are skipped to the next `Host` or `Match`: their criteria
 * can run programs and name users, so nothing in one reaches a lane.
 */
export function parseSshConfig(text: string): readonly SshBlock[] {
  const blocks: { patterns: readonly string[]; lines: SshLine[] }[] = []
  let current: { patterns: readonly string[]; lines: SshLine[] } | null = {
    patterns: ["*"],
    lines: [],
  }
  blocks.push(current)
  for (const raw of text.split("\n")) {
    const line = parseLine(raw)
    if (line === null) continue
    if (line.keyword === "host") {
      current = { patterns: line.args, lines: [] }
      blocks.push(current)
    } else if (line.keyword === "match") current = null
    else if (current !== null) current.lines.push(line)
  }
  return blocks.filter(b => b.lines.length > 0)
}

/** A path as ssh reads one in a config: `~` is home; a relative path is under `base`. */
export function configPath(p: string, base: string, home: string): string {
  if (p === "~") return home
  if (p.startsWith("~/")) return path.join(home, p.slice(2))
  return path.isAbsolute(p) ? path.normalize(p) : path.join(base, p)
}

/**
 * Where a config file's `Include`s are found, absolute, each perhaps a glob.
 * `base` is `~/.ssh` for a person's config: ssh reads a relative `Include`
 * there, and silently skips one it does not find.
 */
export interface IncludeRoots {
  readonly base: string
  readonly home: string
}

/** Every file pattern a text's `Include`s name, in order. */
export const includesIn = (
  text: string,
  roots: IncludeRoots,
): readonly string[] =>
  text.split("\n").flatMap(raw => {
    const line = parseLine(raw)
    return line?.keyword === "include"
      ? line.args.map(a => configPath(a, roots.base, roots.home))
      : []
  })

/**
 * The `Include` patterns, at any depth, that `files` does not hold yet:
 * what the caller reads next. `files` maps a pattern to the texts of the
 * files it matched, in ssh's order (sorted, for a glob).
 */
export function missingIncludes(
  text: string,
  roots: IncludeRoots,
  files: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const missing = new Set<string>()
  const walk = (t: string, depth: number): void => {
    if (depth > INCLUDE_DEPTH) return
    for (const pattern of includesIn(t, roots)) {
      const texts = files.get(pattern)
      if (texts === undefined) missing.add(pattern)
      else for (const inner of texts) walk(inner, depth + 1)
    }
  }
  walk(text, 0)
  return [...missing]
}

/**
 * The text with each `Include` replaced by the files it matched. ssh reads
 * an included file inside the block that includes it, and returns to that
 * block after it: so where an included text opens blocks of its own, the
 * including block's header is written again after it. Lines before any
 * `Host` apply to every host, and are reopened as `Host *`.
 */
export function inlineIncludes(
  text: string,
  roots: IncludeRoots,
  files: ReadonlyMap<string, readonly string[]>,
): string {
  const inline = (t: string, depth: number): string[] => {
    const out: string[] = []
    let header = "Host *"
    for (const raw of t.split("\n")) {
      const line = parseLine(raw)
      if (line?.keyword === "host" || line?.keyword === "match") header = raw
      if (line?.keyword !== "include") {
        out.push(raw)
        continue
      }
      if (depth >= INCLUDE_DEPTH) continue
      for (const pattern of line.args.map(a =>
        configPath(a, roots.base, roots.home),
      ))
        for (const inner of files.get(pattern) ?? []) {
          const lines = inline(inner, depth + 1)
          out.push(...lines)
          if (
            lines.some(l => {
              const k = parseLine(l)?.keyword
              return k === "host" || k === "match"
            })
          )
            out.push(header)
        }
    }
    return out
  }
  return inline(text, 0).join("\n")
}
