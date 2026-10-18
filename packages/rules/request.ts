// request — what a one-shot model request outside a thread is made from, and
// a one-line answer read back (`bareLine`).

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
      : SPOKEN.has(m.role)
        ? (m.author ?? "someone")
        : m.role
  return `${speaker}: ${m.text}`
}

/**
 * The roles spoken by someone a line names: a person's chat, pi's own user
 * message, and an ask from another thread or an asked agent's answer,
 * whose speakers are the asker and the answering thread.
 */
const SPOKEN: ReadonlySet<string> = new Set([
  "person",
  "user",
  "relay",
  "answer",
])

/**
 * Each chat, prompt, agent reply, and what agents in other threads asked and
 * answered, as `transcriptLine`; the rest are left out.
 */
export const transcriptLines = (
  messages: readonly TranscriptMessage[],
): string[] =>
  messages
    .filter(m => m.role === "assistant" || SPOKEN.has(m.role))
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

/**
 * A request's list of lines: the first always, since it usually says what
 * the thread is for, then the newest of `rest` that fit in what is left of
 * `room`, after a note of how many were left out.
 */
export function firstAndNewest(
  first: string,
  rest: readonly string[],
  room: number,
): { readonly first: string; readonly newest: string } {
  const head = `- ${first.trim()}\n`
  const { text, dropped } = fitNewest(
    rest,
    Math.max(0, room - head.length - LEFT_OUT_NOTE),
  )
  return { first: head, newest: leftOut(dropped) + text }
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
 * A model's one-line answer (a title, a digest's headline) without
 * surrounding quotes or emphasis, or a trailing full stop, colon or the
 * like.
 */
export const bareLine = (text: string): string =>
  text
    .trim()
    .replace(WRAPPED, "")
    .replace(/[.:;,!]+$/, "")
    .trim()

/** How many words `text` has. */
export const wordCount = (text: string): number =>
  text.split(/\s+/).filter(w => w !== "").length

/**
 * A reply as one bare line (`bareLine`) of at most `maxWords` words, or null:
 * for more than one line, an empty one, or one too long. It never cuts a
 * reply, which could leave "Fixing the".
 */
export function oneLine(reply: string, maxWords: number): string | null {
  const lines = reply.split("\n").filter(l => l.trim() !== "")
  const [only] = lines
  if (lines.length !== 1 || only === undefined) return null
  const bare = bareLine(only)
  return bare === "" || wordCount(bare) > maxWords ? null : bare
}
