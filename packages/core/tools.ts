// core/tools — how a tool call is named on screen.

/** The longest label shown; a long command is cut with an ellipsis. */
const MAX_LABEL = 120

/**
 * A tool call's one-line label: `read path`, `write path`, `edit path`,
 * `bash <the command's first line>`, else the tool's name. Pure; the live row
 * and the committed row use this one definition, so they read the same.
 */
export function toolLabel(name: string, args: unknown): string {
  const field = (key: string): string | undefined => {
    if (typeof args !== "object" || args === null) return undefined
    const v = (args as Record<string, unknown>)[key]
    return typeof v === "string" && v.length > 0 ? v : undefined
  }
  const subject =
    name === "bash"
      ? field("command")?.split("\n")[0]
      : name === "read" || name === "write" || name === "edit"
        ? field("path")
        : undefined
  const label = subject === undefined ? name : `${name} ${subject}`
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}
