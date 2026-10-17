// round — what comes after several agents a person asked at once have all
// answered. A reply in any other shape is nothing: the host never acts on what
// it cannot tell.

import type { ThreadId } from "@pinetrie/core"
import { fitNewest, LEFT_OUT_NOTE, leftOut } from "./request.ts"

/** What the round's reply decides. */
export type RoundNext =
  | { readonly kind: "nothing" }
  /** Ask one member to answer what was said: a relay, as an agent's ask. */
  | { readonly kind: "ask"; readonly thread: ThreadId; readonly text: string }
  /** Tell the people something: a line in the thread. */
  | { readonly kind: "people"; readonly line: string }

export const NOTHING_NEXT: RoundNext = { kind: "nothing" }

/** The request's characters for the thread's tail. */
const ROUND_ROOM = 12_000

/**
 * The round's request: the skill, the members by name, and the thread's
 * newest lines that fit, the oldest cut first.
 */
export function roundRequest(input: {
  readonly skill: string
  readonly members: readonly string[]
  readonly lines: readonly string[]
}): { readonly system: string; readonly user: string } {
  const { text, dropped } = fitNewest(input.lines, ROUND_ROOM - LEFT_OUT_NOTE)
  return {
    system: input.skill.trim(),
    user: `The agents in this thread: ${input.members.join(", ")}.\n\nWhat was said, newest last:\n${leftOut(dropped)}${text}`,
  }
}

/**
 * The model's reply as a value: `nothing`; `ask <name>: <text>`, naming a
 * member; or `people: <line>`. Anything else, an `ask` naming no member or
 * with nothing to ask included, is nothing.
 */
export function parseRoundReply(
  reply: string,
  members: ReadonlyMap<string, ThreadId>,
): RoundNext {
  const line = reply.trim()
  if (line.includes("\n")) return NOTHING_NEXT
  const ask = /^ask\s+([a-z]+-[a-z]+)\s*:\s*(\S.*)$/i.exec(line)
  if (ask !== null) {
    const thread = members.get((ask[1] ?? "").toLowerCase())
    const text = (ask[2] ?? "").trim()
    return thread === undefined || text === ""
      ? NOTHING_NEXT
      : { kind: "ask", thread, text }
  }
  const people = /^people\s*:\s*(\S.*)$/i.exec(line)
  if (people !== null) return { kind: "people", line: (people[1] ?? "").trim() }
  return NOTHING_NEXT
}
