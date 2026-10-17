// shell/layout — a one-line command laid out to a width, at its structure.
//
// A node that fits on its line is copied from the source; one that does not
// is broken where the shell allows a line break: one statement a line, one
// part of an `&&`, `||` or `|` chain a line, a subshell's, group's, loop's or
// `if`'s body indented. Every leaf is the source's own text, so a layout
// changes whitespace and statement separators only, which `sameProgram`
// checks before a layout is kept.

import {
  type AndOr,
  type CompoundList,
  type If,
  type ParsedScript,
  type Pipeline,
  parse,
  type Statement,
} from "unbash"
import { print } from "unbash/printer"

/** How far a continuation, or a body, is indented under its line. */
const INDENT = 2

/** A node's place in its source. */
interface Span {
  readonly pos: number
  readonly end: number
}

/** A laid-out command and its parse, which its check already made. */
export interface Layout {
  readonly text: string
  readonly parsed: ParsedScript
}

/**
 * `source`, parsed as `parsed`, laid out to `width` columns; undefined when
 * the source is its own layout: it has lines of its own (the agent laid it
 * out, and a heredoc needs its lines), does not parse, or fits.
 */
export function shellLayout(
  source: string,
  parsed: ParsedScript,
  width: number,
): Layout | undefined {
  if (source.includes("\n") || (parsed.errors?.length ?? 0) > 0)
    return undefined
  if (source.trim().length <= width) return undefined
  const text = layOut(source, parsed, width)
  if (text === source) return undefined
  const again = parse(text)
  return sameProgram(source, parsed, text, again)
    ? { text, parsed: again }
    : undefined
}

/**
 * Whether `text` is `source` with only its whitespace and statement
 * separators changed. unbash's printer ignores line breaks, so the two print
 * the same when their structure is the same; it drops comments, so the
 * characters left without whitespace and `;` must match too.
 */
export function sameProgram(
  source: string,
  parsed: ParsedScript,
  text: string,
  again: ParsedScript,
): boolean {
  const squeezed = (s: string) => s.replace(/[\s;]/g, "")
  return (
    (again.errors?.length ?? 0) === 0 &&
    print(again) === print(parsed) &&
    squeezed(text) === squeezed(source)
  )
}

function layOut(source: string, parsed: ParsedScript, width: number): string {
  const text = (n: Span) => source.slice(n.pos, n.end)
  const fits = (n: Span, indent: number) => indent + n.end - n.pos <= width
  const pad = (indent: number) => " ".repeat(indent)

  const list = (statements: readonly Statement[], indent: number): string =>
    statements.map(s => pad(indent) + statement(s, indent)).join("\n")

  const statement = (s: Statement, indent: number): string =>
    node(s.command, indent) + (s.background === true ? " &" : "")

  const block = (
    open: string,
    body: CompoundList,
    close: string,
    indent: number,
  ): string =>
    `${open}\n${list(body.commands, indent + INDENT)}\n${pad(indent)}${close}`

  /**
   * A chain, one part a line, each operator at the end of the part before it.
   * A pipeline's `time` or `!` stays before its first part.
   */
  const chain = (n: AndOr | Pipeline, indent: number): string => {
    const lead = source.slice(n.pos, n.commands[0]?.pos ?? n.pos)
    return n.commands
      .map((part, i) => {
        const operator = n.operators[i]
        // The first part starts the line; the rest continue it.
        const line = node(part, i === 0 ? indent : indent + INDENT)
        return `${i === 0 ? lead : pad(indent + INDENT)}${line}${operator === undefined ? "" : ` ${operator}`}`
      })
      .join("\n")
  }

  const conditional = (n: If, indent: number): string => {
    let out = `${source.slice(n.pos, n.then.pos).trim()}\n${list(n.then.commands, indent + INDENT)}`
    for (const elif of n.elif)
      out += `\n${pad(indent)}elif ${source.slice(elif.clause.pos, elif.then.pos).trim()}\n${list(elif.then.commands, indent + INDENT)}`
    if (n.else !== undefined)
      out += `\n${pad(indent)}else\n${list(n.else.commands, indent + INDENT)}`
    return `${out}\n${pad(indent)}fi`
  }

  function node(n: Statement["command"], indent: number): string {
    if (fits(n, indent)) return text(n)
    switch (n.type) {
      case "AndOr":
      case "Pipeline":
        return chain(n, indent)
      case "Subshell":
        return block("(", n.body, ")", indent)
      case "BraceGroup":
        return block("{", n.body, "}", indent)
      case "For":
      case "While":
      case "Select":
      case "ArithmeticFor":
        return block(
          source.slice(n.pos, n.body.pos).trim(),
          n.body,
          "done",
          indent,
        )
      case "If":
        return conditional(n, indent)
      case "Redirected":
        return node(n.command, indent) + source.slice(n.command.end, n.end)
      default:
        return text(n)
    }
  }

  const body = list(parsed.commands, 0)
  const last = parsed.commands.at(-1)
  // A one-line command's only comment is its last: it runs to the line's end.
  const tail =
    last === undefined ? "" : source.slice(last.end).trim().replace(/^;\s*/, "")
  return tail.startsWith("#") ? `${body} ${tail}` : body
}
