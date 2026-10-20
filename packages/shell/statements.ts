// shell/statements — the lines on which a command's top-level statements
// begin, for a reader to tell them apart.

import type { ParsedScript } from "unbash"

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
  const lineAt = (pos: number) => text.slice(0, pos).split("\n").length - 1
  const out: number[] = []
  parsed.commands.forEach((statement, i) => {
    const before = parsed.commands[i - 1]
    let line = lineAt(statement.pos)
    const lead = text.slice(
      text.lastIndexOf("\n", statement.pos - 1) + 1,
      statement.pos,
    )
    if (before === undefined || lead.trim() !== "") return
    // The walk stops at the statement before's last line, which may start
    // with `#` inside a string. A heredoc's body lies past that end, but its
    // terminator line is never a comment, so the walk never reaches it.
    const after = lineAt(before.end)
    while (line - 1 > after && isComment(lines[line - 1])) line--
    if ((lines[line - 1] ?? "").trim() === "") return
    out.push(line)
  })
  return out
}

const isComment = (line: string | undefined) =>
  line?.trimStart().startsWith("#") ?? false
