// core/tools — the tools pine·trie registers, by the id the model calls them
// by, and what a call to each touched. How a call reads to people is
// `@pinetrie/interface`'s (`tool-words.ts`, ADR-0114).

/** Read a file, or an image (ADR-0051). */
export const READ_TOOL = "read"
/** Write a file. */
export const WRITE_TOOL = "write"
/** Replace text in a file. */
export const EDIT_TOOL = "edit"
/** Run a command in the lane's shell. People read it as "shell" (ADR-0114); the model's id stays pi's. */
export const BASH_TOOL = "bash"
/** Search file contents (ADR-0064). */
export const GREP_TOOL = "grep"
/** Find files by name (ADR-0064). */
export const FIND_TOOL = "find"
/** Leave a conflict whose two sides meant different things for the person (ADR-0080). */
export const CONFLICT_TOOL = "ask_about_conflict"
/** Merge the thread's base, or its parent's work, into its copy during a run (ADR-0080). */
export const CATCH_UP_TOOL = "catch_up"
/** Queue a split of the thread's offer, run when the thread is free (ADR-0080). */
export const SPLIT_TOOL = "split_offer"
/** Set the image in a thread's column header (ADR-0050). */
export const BANNER_TOOL = "set_banner"
/** Ask another thread's agent, a member of this thread, without waiting (ADR-0128). */
export const ASK_TOOL = "ask"
/** Leave another thread's members (ADR-0128). */
export const LEAVE_TOOL = "leave"

/**
 * Every tool pine·trie registers, in the order the model is given them. The
 * order is part of every request's prefix, and a changed prefix drops a
 * lane's earlier thinking (S85).
 */
export const TOOL_IDS = [
  READ_TOOL,
  WRITE_TOOL,
  EDIT_TOOL,
  BASH_TOOL,
  GREP_TOOL,
  FIND_TOOL,
  CONFLICT_TOOL,
  CATCH_UP_TOOL,
  SPLIT_TOOL,
  BANNER_TOOL,
  ASK_TOOL,
  LEAVE_TOOL,
] as const

export type ToolId = (typeof TOOL_IDS)[number]

/**
 * A stored call's name as a tool id; undefined for a tool pine·trie does not
 * register. A lookup in the list, not on an object, so `constructor` is no id.
 */
export function toolIdOf(name: string): ToolId | undefined {
  return TOOL_IDS.find(id => id === name)
}

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

const path = (args: unknown) => field(args, "path")

/** Each tool's subject, by its id; undefined for a tool that touches nothing it names. */
const SUBJECTS: Readonly<
  Record<ToolId, ((args: unknown) => string | undefined) | undefined>
> = {
  [READ_TOOL]: path,
  [WRITE_TOOL]: path,
  [EDIT_TOOL]: path,
  [BASH_TOOL]: args => field(args, "command"),
  [GREP_TOOL]: searched,
  [FIND_TOOL]: searched,
  [CONFLICT_TOOL]: undefined,
  [CATCH_UP_TOOL]: args => field(args, "from") ?? "base",
  [SPLIT_TOOL]: undefined,
  [BANNER_TOOL]: undefined,
  [ASK_TOOL]: args => field(args, "to"),
  [LEAVE_TOOL]: args => field(args, "thread"),
}

/**
 * What a call touches, whole: `bash`'s command, the path of `read`, `write`
 * and `edit`, the pattern of `grep` and `find` and the path they search,
 * what `catch_up` merges from, or the thread `ask` asks and `leave` leaves.
 * Undefined for any other tool.
 */
export function subjectOf(name: string, args: unknown): string | undefined {
  const id = toolIdOf(name)
  return id === undefined ? undefined : SUBJECTS[id]?.(args)
}
