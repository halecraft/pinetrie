// shell/statements — a command's top-level statements, as bash runs them
// one by one: where each lies, and the lines a reader sees each begin on.

import { type ParsedScript, parse } from "unbash"
import { isNode, type Node, nodeChildren } from "./nodes.ts"

/**
 * One top-level statement: a leaf of the command's `;`, `&` and newline
 * connections, so an `&&`, `||` or `|` chain is one. pine·trie's bash
 * numbers the same statements, in the same order, as it starts each.
 */
export interface StatementSpan {
  /** Where its text begins in the command. */
  readonly pos: number
  /** Where its text ends: past its heredocs' terminators, whose bodies follow its line. */
  readonly end: number
  /** The line it begins on, counted from 1, as bash counts a `-c` string's lines. */
  readonly first: number
  /** The line it ends on, its heredocs' bodies included, from 1. */
  readonly last: number
}

/**
 * `command`'s top-level statements, in order; empty for a command that does
 * not parse, whose statements bash would number in a way unbash cannot
 * tell.
 */
export function parseStatements(command: string): readonly StatementSpan[] {
  const parsed = parse(command)
  return (parsed.errors?.length ?? 0) > 0 ? [] : statementSpans(command, parsed)
}

/** The top-level statements of `text`, parsed without errors as `parsed`, in order. */
export function statementSpans(
  text: string,
  parsed: ParsedScript,
): readonly StatementSpan[] {
  const starts = lineStarts(text)
  const lineAt = (pos: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((starts[mid] ?? 0) <= pos) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  return parsed.commands.map(statement => {
    const end = furthestEnd(statement)
    return {
      pos: statement.pos,
      end,
      first: lineAt(statement.pos),
      last: lineAt(Math.max(statement.pos, end - 1)),
    }
  })
}

/**
 * The lines of `text`, parsed without errors as `parsed`, counted from 0,
 * that begin a top-level statement other than the first: one that starts its
 * line, with the comment lines directly above it. A statement after a blank
 * line is left out, as one already set apart, and so is one sharing its line
 * with the statement before (`a; b`).
 */
export function statementLines(
  text: string,
  parsed: ParsedScript,
): readonly number[] {
  const lines = text.split("\n")
  const out: number[] = []
  const spans = statementSpans(text, parsed)
  spans.forEach((statement, i) => {
    const before = spans[i - 1]
    let line = statement.first - 1
    const lead = text.slice(
      text.lastIndexOf("\n", statement.pos - 1) + 1,
      statement.pos,
    )
    if (before === undefined || lead.trim() !== "") return
    // The walk stops at the statement before's last line, which may start
    // with `#` inside a string, or be its heredoc's terminator.
    const after = before.last - 1
    while (line - 1 > after && isComment(lines[line - 1])) line--
    if ((lines[line - 1] ?? "").trim() === "") return
    out.push(line)
  })
  return out
}

const isComment = (line: string | undefined) =>
  line?.trimStart().startsWith("#") ?? false

/** The offset each line of `text` starts at. */
function lineStarts(text: string): readonly number[] {
  const out = [0]
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1))
    out.push(i + 1)
  return out
}

/**
 * The furthest a node reaches in the source: its own end, or a heredoc's
 * terminator inside it, which unbash keeps outside every node's range. A
 * script with its own decoded source (an escaped backtick's) indexes that
 * text, which is shorter than the source around it, so it never reaches
 * past the node that holds it.
 */
function furthestEnd(node: Node): number {
  let end = node.end
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const child of v) visit(child)
      return
    }
    if (!isNode(v)) return

    end = Math.max(end, v.end)
    if (v.type === "HereDoc" && "closing" in v) {
      const closing = v.closing as { readonly end: number } | undefined
      if (closing !== undefined) end = Math.max(end, closing.end)
    }
    for (const child of nodeChildren(v)) visit(child)
  }
  for (const child of nodeChildren(node)) visit(child)
  return end
}
