// core/tools — how a tool call is named on screen.

/** The longest label shown; a long command is cut with an ellipsis. */
const MAX_LABEL = 120

/** A call's argument `key`, when it is a non-empty string. */
const field = (args: unknown, key: string): string | undefined => {
  if (typeof args !== "object" || args === null) return undefined
  const v = (args as Record<string, unknown>)[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

/** A search's pattern, and the path it searches when one is given. */
const searched = (args: unknown): string | undefined => {
  const pattern = field(args, "pattern")
  const at = field(args, "path")
  return pattern === undefined || at === undefined
    ? pattern
    : `${pattern} ${at}`
}

/** Each tool's subject, by its name. */
const SUBJECTS: ReadonlyMap<string, (args: unknown) => string | undefined> =
  new Map([
    ["bash", args => field(args, "command")],
    ["read", args => field(args, "path")],
    ["write", args => field(args, "path")],
    ["edit", args => field(args, "path")],
    ["grep", searched],
    ["find", searched],
  ])

/**
 * What a call touches, whole: `bash`'s command, the path of `read`, `write`
 * and `edit`, or the pattern of `grep` and `find` and the path they search.
 * Undefined for any other tool.
 */
export function subjectOf(name: string, args: unknown): string | undefined {
  return SUBJECTS.get(name)?.(args)
}

/**
 * A tool call's one-line label: its name and the first line of its subject
 * (`read path`, `bash <the command's first line>`, `grep <pattern> <path>`),
 * else the tool's name. Pure; the live row
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
