// core/tools — how a tool call is named on screen.

/** The longest label shown; a long command is cut with an ellipsis. */
const MAX_LABEL = 120

/**
 * What a call touches, whole: `bash`'s command, or the path of `read`, `write`
 * and `edit`. Undefined for any other tool.
 */
export function subjectOf(name: string, args: unknown): string | undefined {
  const field = (key: string): string | undefined => {
    if (typeof args !== "object" || args === null) return undefined
    const v = (args as Record<string, unknown>)[key]
    return typeof v === "string" && v.length > 0 ? v : undefined
  }
  return name === "bash"
    ? field("command")
    : name === "read" || name === "write" || name === "edit"
      ? field("path")
      : undefined
}

/**
 * A tool call's one-line label: `read path`, `write path`, `edit path`,
 * `bash <the command's first line>`, else the tool's name. Pure; the live row
 * and the committed row use this one definition, so they read the same.
 */
export function toolLabel(name: string, args: unknown): string {
  const subject = subjectOf(name, args)?.split("\n")[0]
  const label = subject === undefined ? name : `${name} ${subject}`
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}

/**
 * A tool call's label uncut, when `toolLabel` cuts it: a command past its
 * first line or past the label's length. Undefined when the label is whole.
 */
export function wholeToolLabel(
  name: string,
  args: unknown,
): string | undefined {
  const subject = subjectOf(name, args)
  if (subject === undefined) return undefined
  const whole = `${name} ${subject}`
  return toolLabel(name, args) === whole ? undefined : whole
}
