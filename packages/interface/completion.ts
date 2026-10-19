// interface/completion — the list the composer offers as you type: the
// commands while the text is a `/` and a first word (`commands.ts`), else
// whom the mention at the caret may name (`mentions.ts`).

import type { CommandSummary } from "@pinetrie/rules"
import type { AgentCandidate } from "@pinetrie/threads"
import { commandCompletion } from "./commands.ts"
import { mentionCompletion } from "./mentions.ts"
import type { Reader } from "./send.ts"

/** What a choice replaces, from `start` to `end`, and what may replace it. */
export interface Completion {
  readonly start: number
  readonly end: number
  readonly options: readonly CompletionOption[]
}

export interface CompletionOption {
  /** Unique in its list: the row's `data-option`. */
  readonly key: string
  readonly label: string
  /** A command's arguments, as its file hints them. */
  readonly hint: string | null
  readonly kind: string | null
  readonly description: string
  /** The text a choice puts in place of `start` to `end`. */
  readonly insert: string
}

/**
 * The list for `text` with the caret at `caret` (null while the box is not
 * focused, which offers no mention); null when nothing is offered.
 */
export const completion = (input: {
  readonly text: string
  readonly caret: number | null
  readonly commands: readonly CommandSummary[]
  /** Every participant's display name, as shown. */
  readonly participants: readonly string[]
  readonly agents: readonly AgentCandidate[]
  readonly reader: Reader
}): Completion | null =>
  commandCompletion(input.text, input.commands) ??
  (input.caret === null
    ? null
    : mentionCompletion({ ...input, caret: input.caret }))
