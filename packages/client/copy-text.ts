// client/copy-text — what a message's copy puts on the clipboard, as markdown.

import type { ToolCallView, TranscriptMessage } from "@pineta/core"

/**
 * A message as markdown: its text as stored, then each tool call it made, in
 * order. A call is its whole label in code, then its result's text, whole, in
 * a fenced block. A call still running has no result yet, and a result's
 * images are left out. Empty for a message with neither text nor calls.
 */
export function copyText(node: TranscriptMessage): string {
  return [node.text, ...(node.toolCalls ?? []).map(callText)]
    .filter(part => part !== "")
    .join("\n\n")
}

function callText(call: ToolCallView): string {
  const label = call.wholeLabel ?? call.label
  const head = label.includes("\n") ? fenced(label) : inlineCode(label)
  const result = call.result?.text ?? ""
  return result === "" ? head : `${head}\n\n${fenced(result)}`
}

/** A fence longer than any run of backticks inside, so none closes it. */
function fenced(text: string): string {
  const fence = "`".repeat(Math.max(3, longestTicks(text) + 1))
  return `${fence}\n${text.replace(/\n$/, "")}\n${fence}`
}

/** A code span, its delimiter longer than any run of backticks inside. */
function inlineCode(text: string): string {
  const ticks = "`".repeat(longestTicks(text) + 1)
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : ""
  return `${ticks}${pad}${text}${pad}${ticks}`
}

/** A reduce, not `Math.max(...runs)`: an output can hold more runs than a call takes arguments. */
function longestTicks(text: string): number {
  return (text.match(/`+/g) ?? []).reduce(
    (most, run) => Math.max(most, run.length),
    0,
  )
}
