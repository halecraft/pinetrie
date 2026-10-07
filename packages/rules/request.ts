// What a one-shot model request outside a thread is made from: a thread's
// messages as lines, and the newest of them that fit a budget, as the commit
// message's request (`describeRequest`, below) uses them; and a one-line
// answer read back (`bareLine`).

import { firstLine, type TranscriptMessage } from "@pinetrie/core"

/**
 * One message as `speaker: text`. A chat's speaker is its author as sent;
 * a land, update or stack message carries no author, so its role speaks.
 */
export const transcriptLine = (
  m: Pick<TranscriptMessage, "role" | "author" | "text">,
): string => {
  const speaker =
    m.role === "assistant"
      ? "agent"
      : m.role === "chat" || m.role === "user"
        ? (m.author ?? "someone")
        : m.role
  return `${speaker}: ${m.text}`
}

/** Each chat, prompt and agent reply as `transcriptLine`; the rest are left out. */
export const transcriptLines = (
  messages: readonly TranscriptMessage[],
): string[] =>
  messages
    .filter(
      m => m.role === "chat" || m.role === "user" || m.role === "assistant",
    )
    .map(transcriptLine)

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

/** Accepted work saying how many older lines `fitNewest` left out; empty for none. */
export const leftOut = (dropped: number): string =>
  dropped > 0 ? `- (${dropped} earlier left out)\n` : ""

/**
 * The commit-message request: the skill as the system text, then your repo's
 * recent descriptions, what the thread said since its last acceptance, and the
 * diff. Over `budget` characters, the thread's messages go first, oldest
 * first, then the diff is cut; the skill never is.
 */
export function describeRequest(input: {
  readonly skill: string
  readonly diff: string
  readonly messages: readonly string[]
  readonly recent: readonly string[]
  readonly budget: number
}): { readonly system: string; readonly user: string } {
  const recent = input.recent.map(r => `- ${firstLine(r, 120)}`).join("\n")
  const head = `Recent commit messages in this repository:\n${recent || "- (none)"}\n\n`
  let room = Math.max(0, input.budget - head.length)
  // The diff is kept whole when it fits; the messages share what is left,
  // less room for accepted work saying how many were left out.
  const { text, dropped } = fitNewest(
    input.messages,
    Math.max(0, room - Math.min(input.diff.length, room) - LEFT_OUT_NOTE),
  )
  const said = leftOut(dropped) + (text || "- (no messages)\n")
  room -= said.length
  const diff =
    input.diff.length <= room
      ? input.diff
      : `${input.diff.slice(0, Math.max(0, room - 40))}\n… (the rest of the diff left out)`
  return {
    system: input.skill.trim(),
    user: `${head}What the thread said:\n${said}\nThe change:\n${diff}`,
  }
}

/** Wrapping a model may put around a one-line answer. */
const WRAPPED = /^["'`*_“‘]+|["'`*_”’]+$/g

/**
 * Pure. A model's one-line answer (a title, a digest's headline) without
 * surrounding quotes or emphasis, or a trailing full stop, colon or the
 * like.
 */
export const bareLine = (text: string): string =>
  text
    .trim()
    .replace(WRAPPED, "")
    .replace(/[.:;,!]+$/, "")
    .trim()
