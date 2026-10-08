// interface/tool-words — what people call each tool, and a call as one line
// of words (ADR-0114). The model calls a tool by its id (`TOOL_IDS`, core);
// a person reads its word. Revision titles, an ask's live line, copied
// calls and a row's tag all read these.

import {
  BANNER_TOOL,
  BASH_TOOL,
  CATCH_UP_TOOL,
  CONFLICT_TOOL,
  EDIT_TOOL,
  FIND_TOOL,
  GREP_TOOL,
  READ_TOOL,
  SPLIT_TOOL,
  type ToolCall,
  type ToolId,
  toolIdOf,
  WRITE_TOOL,
} from "@pinetrie/core"

/** What people call each tool. */
const TOOL_WORDS: Readonly<Record<ToolId, string>> = {
  [READ_TOOL]: "read",
  [WRITE_TOOL]: "write",
  [EDIT_TOOL]: "edit",
  [BASH_TOOL]: "shell",
  [GREP_TOOL]: "search",
  [FIND_TOOL]: "find",
  [CONFLICT_TOOL]: "ask",
  [CATCH_UP_TOOL]: "catch up",
  [SPLIT_TOOL]: "split",
  [BANNER_TOOL]: "banner",
}

/** A tool's word; a tool pine·trie does not register goes by its own name. */
export function toolWord(name: string): string {
  const id = toolIdOf(name)
  return id === undefined ? name : TOOL_WORDS[id]
}

/** The most of a subject a one-line preview shows. */
export const PREVIEW_LENGTH = 120

/**
 * Where a subject's one-line preview ends: at its first line break, or at
 * `PREVIEW_LENGTH` characters. `cut` when the subject goes on past it, which
 * a preview shows with "…".
 */
export function previewEnd(subject: string): {
  readonly at: number
  readonly cut: boolean
} {
  const line = subject.indexOf("\n")
  const at = Math.min(line === -1 ? subject.length : line, PREVIEW_LENGTH)
  return { at, cut: at < subject.length }
}

/**
 * A call as one line of words: its tool's word, then what it touched,
 * previewed (`cut`) or all of it (`whole`). A call that touched nothing it
 * names is its word alone.
 */
export function callLabel(call: ToolCall, length: "cut" | "whole"): string {
  const word = toolWord(call.name)
  const { subject } = call
  if (subject === undefined) return word
  if (length === "whole") return `${word} ${subject}`
  const { at, cut } = previewEnd(subject)
  return `${word} ${subject.slice(0, at)}${cut ? "…" : ""}`
}
