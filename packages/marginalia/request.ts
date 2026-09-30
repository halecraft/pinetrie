// What a one-shot model request outside a thread is made from: a thread's
// messages as lines, and the newest of them that fit a budget. The commit
// message (`describeRequest`) and a column's banner (`bannerRequest`) share
// them.

import type { TranscriptMessage } from "@pineta/core"

/**
 * Each chat, prompt and agent reply, as `speaker: text`; tool results are
 * left out. A chat's speaker is its author as sent.
 */
export const transcriptLines = (
  messages: readonly TranscriptMessage[],
): string[] =>
  messages
    .filter(
      m => m.role === "chat" || m.role === "user" || m.role === "assistant",
    )
    .map(
      m =>
        `${m.role === "assistant" ? "agent" : (m.author ?? "someone")}: ${m.text}`,
    )

/**
 * The newest `lines` that fit in `room` characters, each as `- line\n`, and
 * how many older ones were left out. It stops at the first that does not
 * fit, so what it keeps is always a run of the newest.
 */
export function fitNewest(
  lines: readonly string[],
  room: number,
): { readonly text: string; readonly dropped: number } {
  const kept: string[] = []
  let left = room
  for (const l of lines.toReversed()) {
    const line = `- ${l.trim()}\n`
    if (line.length > left) break
    kept.unshift(line)
    left -= line.length
  }
  return { text: kept.join(""), dropped: lines.length - kept.length }
}

/** Room for `leftOut`'s line. */
export const LEFT_OUT_NOTE = 32

/** The line saying how many older lines `fitNewest` left out; empty for none. */
export const leftOut = (dropped: number): string =>
  dropped > 0 ? `- (${dropped} earlier left out)\n` : ""
