// core/text — text as a label.

/**
 * A text as a label: its first non-empty line, cut to `max` characters with
 * "…" when longer. Tabs, fork labels, the header's menus and a revision's
 * title use it.
 */
export function firstLine(text: string, max: number): string {
  const line =
    text
      .split("\n")
      .map(l => l.trim())
      .find(l => l !== "") ?? ""
  return line.length > max ? `${line.slice(0, max)}…` : line
}
