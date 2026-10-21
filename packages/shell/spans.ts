// shell/spans — a command's text in runs, each with its role, for a reader to
// tell its commands, options, strings and variables apart.
//
// Each node of the parse marks its range with its role, and a node inside
// another marks over it, so the innermost wins. Words are marked plain at
// least, so only the text between words is read by its characters:
// operators, keywords and a comment.

import type { ParsedScript } from "unbash"
import { isNode, type Node, nodeChildren } from "./nodes.ts"

export type ShellRole =
  | "command"
  | "option"
  | "string"
  | "variable"
  | "operator"
  | "redirect"
  | "keyword"
  | "comment"
  | "plain"

export interface ShellSpan {
  readonly text: string
  readonly role: ShellRole
}

/** The source as one run, for a source that does not parse. */
export const plainSpans = (source: string): readonly ShellSpan[] =>
  source === "" ? [] : [{ text: source, role: "plain" }]

/** The role a node marks over its whole range, by its type. */
const ROLE_OF: Readonly<Record<string, ShellRole>> = {
  Word: "plain",
  SingleQuoted: "string",
  DoubleQuoted: "string",
  AnsiCQuoted: "string",
  LocaleString: "string",
  HereDocBody: "string",
  SimpleExpansion: "variable",
  ParameterExpansion: "variable",
  ArithmeticExpansion: "variable",
  Redirect: "redirect",
  HereString: "redirect",
  HereDoc: "redirect",
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "in",
  "do",
  "done",
  "while",
  "until",
  "case",
  "esac",
  "select",
  "function",
  "time",
  "coproc",
])

/** The source in runs by role; their texts join to `source`. */
export function roleSpans(
  source: string,
  parsed: ParsedScript,
): readonly ShellSpan[] {
  const roles: (ShellRole | undefined)[] = Array.from({
    length: source.length,
  })
  const mark: Mark = (pos, end, role) => {
    for (let i = Math.max(0, pos); i < Math.min(end, source.length); i++)
      roles[i] = role
  }
  walk(parsed, mark)
  readGaps(source, roles)
  return runs(source, roles)
}

type Mark = (pos: number, end: number, role: ShellRole) => void

/**
 * Marks each node, then its children over it. A word is plain unless its
 * command says otherwise (`word`): its name is the command, an argument
 * starting with `-` an option. A script that owns its own decoded source (an
 * escaped backtick's) is not walked: its offsets are into that source, not
 * this one.
 */
function walk(node: unknown, mark: Mark, word: ShellRole = "plain"): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, mark)
    return
  }
  if (!isNode(node)) return
  if ("source" in node && typeof node.source === "string") return
  const role = node.type === "Word" ? word : ROLE_OF[node.type]
  if (role !== undefined) mark(node.pos, node.end, role)
  if (node.type === "Command") {
    walkCommand(node, mark)
    return
  }
  if (node.type === "Assignment" && "name" in node) {
    const { name } = node
    if (typeof name === "string")
      mark(node.pos, node.pos + name.length, "variable")
  }
  // `2>&1`'s target is a descriptor, part of the redirect; a file is a word.
  const target =
    node.type === "Redirect" &&
    "operator" in node &&
    typeof node.operator === "string" &&
    node.operator.endsWith("&")
      ? "redirect"
      : "plain"
  for (const child of nodeChildren(node)) walk(child, mark, target)
}

function walkCommand(node: Node, mark: Mark): void {
  const { name, prefix, suffix } = node as Node & {
    readonly name?: unknown
    readonly prefix?: unknown
    readonly suffix?: unknown
  }
  walk(name, mark, "command")
  walk(prefix, mark)
  if (!Array.isArray(suffix)) return
  for (const arg of suffix) {
    const text = (arg as { text?: unknown } | null)?.text
    walk(
      arg,
      mark,
      typeof text === "string" && text.startsWith("-") ? "option" : "plain",
    )
  }
}

/**
 * Text no node covers, by its characters: a `#` that starts a word begins a
 * comment to the line's end, a keyword is a keyword, and the shell's
 * punctuation (with a `$` that opens a substitution) is an operator.
 */
function readGaps(source: string, roles: (ShellRole | undefined)[]): void {
  let i = 0
  while (i < source.length) {
    if (roles[i] !== undefined) {
      i++
      continue
    }
    const c = source.charAt(i)
    const before = i === 0 ? " " : source.charAt(i - 1)
    if (c === "#" && /\s/.test(before)) {
      const end = source.indexOf("\n", i)
      const stop = end === -1 ? source.length : end
      for (let j = i; j < stop; j++) roles[j] ??= "comment"
      i = stop
      continue
    }
    const word = /^[a-z]+/.exec(source.slice(i))?.[0]
    if (word !== undefined && !/[\w-]/.test(before)) {
      const after = source.charAt(i + word.length)
      const role: ShellRole =
        KEYWORDS.has(word) && !/[\w-]/.test(after) ? "keyword" : "plain"
      for (let j = i; j < i + word.length; j++) roles[j] ??= role
      i += word.length
      continue
    }
    roles[i] =
      "&|;(){}!".includes(c) || (c === "$" && source.charAt(i + 1) === "(")
        ? "operator"
        : "plain"
    i++
  }
}

/** Adjacent characters of one role, as runs. */
function runs(
  source: string,
  roles: readonly (ShellRole | undefined)[],
): readonly ShellSpan[] {
  const out: ShellSpan[] = []
  let start = 0
  for (let i = 1; i <= source.length; i++) {
    if (i < source.length && roles[i] === roles[start]) continue
    out.push({ text: source.slice(start, i), role: roles[start] ?? "plain" })
    start = i
  }
  return source === "" ? [] : out
}
