// threads/tools — the tools pine·trie registers, by the id the model calls them
// by, and what a call to each touched. How a call reads to people is
// `@pinetrie/interface`'s (`tool-words.ts`).

/** Read a file, or an image. */
export const READ_TOOL = "read"
/** Write a file. */
export const WRITE_TOOL = "write"
/** Replace text in a file. */
export const EDIT_TOOL = "edit"
/** Run a command in the lane's shell. People read it as "ran"; the model's id stays pi's. */
export const BASH_TOOL = "bash"
/** Search file contents. */
export const GREP_TOOL = "grep"
/** Find files by name. */
export const FIND_TOOL = "find"
/** Leave a conflict whose two sides meant different things for the person. */
export const CONFLICT_TOOL = "ask_about_conflict"
/** Merge the thread's base, or its parent's work, into its copy during a run. */
export const GET_LATEST_TOOL = "catch_up"
/** Queue a split of the thread's proposed changes, run when the thread is free. */
export const SPLIT_TOOL = "split_proposed_changes"
/** Close a folder lane's conflicted path, with the version chosen. */
export const RESOLVE_TOOL = "resolve_conflict"
/** Set the image in a thread's column header. */
export const BANNER_TOOL = "set_banner"
/** Ask another thread's agent, a member of this thread, without waiting. */
export const ASK_TOOL = "ask"
/** Leave another thread's members. */
export const LEAVE_TOOL = "leave"
/** Save a file shared in the thread into the agent's lane. */
export const SAVE_BLOB_TOOL = "save_blob"
/** Put an image in a media column of the thread's canvas, or add a version of one. */
export const PUT_IMAGE_TOOL = "put_image"
/** Read a card of the thread's canvas: an image, a media column, a note column. */
export const READ_CARD_TOOL = "read_card"
/** Propose new threads branching from this run's end, which a person opens or starts. */
export const PROPOSE_TOOL = "propose_branches"

/**
 * Every tool pine·trie registers, in the order the model is given them, and
 * what every lane's runs may call. One list for every run, a resolution's
 * included, whatever kind of lane runs it: a tool that does not apply
 * answers why. The list and its order are part of every request's prefix, and
 * a changed prefix drops a lane's earlier thinking. pi stores the list in a
 * lane's configuration and fails a run whose list names a tool not
 * registered, so a lane stored with another list is given this one when it is
 * first held (`threadLanes`, `@pinetrie/pi`).
 */
export const TOOL_IDS = [
  READ_TOOL,
  WRITE_TOOL,
  EDIT_TOOL,
  BASH_TOOL,
  GREP_TOOL,
  FIND_TOOL,
  CONFLICT_TOOL,
  GET_LATEST_TOOL,
  SPLIT_TOOL,
  BANNER_TOOL,
  ASK_TOOL,
  LEAVE_TOOL,
  RESOLVE_TOOL,
  SAVE_BLOB_TOOL,
  PUT_IMAGE_TOOL,
  READ_CARD_TOOL,
  PROPOSE_TOOL,
] as const

export type ToolId = (typeof TOOL_IDS)[number]

/**
 * A stored call's name as a tool id; undefined for a tool pine·trie does not
 * register. A lookup in the list, not on an object, so `constructor` is no id.
 */
export function knownToolId(name: string): ToolId | undefined {
  return TOOL_IDS.find(id => id === name)
}

/**
 * The tools whose result is a terminal's output, its SGR kept: the model
 * reads it without (`@pinetrie/pi`), and a row and a copy decide by it
 * (`@pinetrie/interface`), so the three cannot disagree.
 */
const TERMINAL_OUTPUT_TOOLS: ReadonlySet<ToolId> = new Set([BASH_TOOL])

/** Whether a tool's result is a terminal's output, styled by its SGR. */
export const isTerminalOutputTool = (name: string): boolean => {
  const id = knownToolId(name)
  return id !== undefined && TERMINAL_OUTPUT_TOOLS.has(id)
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
  [GET_LATEST_TOOL]: args => field(args, "from") ?? "base",
  [SPLIT_TOOL]: undefined,
  [BANNER_TOOL]: undefined,
  [ASK_TOOL]: args => field(args, "to"),
  [LEAVE_TOOL]: args => field(args, "thread"),
  [RESOLVE_TOOL]: path,
  [SAVE_BLOB_TOOL]: path,
  [PUT_IMAGE_TOOL]: args => field(args, "image"),
  [READ_CARD_TOOL]: args => field(args, "card"),
  [PROPOSE_TOOL]: undefined,
}

/**
 * What a call touches, whole: `bash`'s command, the path of `read`, `write`,
 * `edit`, `resolve_conflict` and `save_blob`, the pattern of `grep` and `find`
 * and the path they search,
 * what `catch_up` merges from, or the thread `ask` asks and `leave` leaves.
 * Undefined for any other tool.
 */
export function callSubject(name: string, args: unknown): string | undefined {
  const id = knownToolId(name)
  return id === undefined ? undefined : SUBJECTS[id]?.(args)
}

/** The argument a call says what it is for in (`TAKES_INTENT`, `@pinetrie/pi`). */
export const INTENT_FIELD = "intent"

/**
 * What a call is for, in the model's words: its `intent`, trimmed, for any
 * tool; undefined for none, or an empty one.
 */
export function callIntent(args: unknown): string | undefined {
  return field(args, INTENT_FIELD)?.trim() || undefined
}
