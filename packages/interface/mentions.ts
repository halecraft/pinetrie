// interface/mentions — whom the mention at the caret may name, as the
// composer offers it (`completion.ts`).

import {
  type AgentCandidate,
  handleOf,
  type MentionTarget,
  mentionTargets,
  typedMention,
} from "@pinetrie/core"
import { displayName } from "@pinetrie/rules"
import type { Completion } from "./completion.ts"
import type { Reader } from "./send.ts"

/**
 * Whom the mention at the caret may name (`mentionTargets`, whom `address`
 * resolves by): this thread's agent, its members, the people, then the other
 * threads' agents, those whose handle starts with what is typed before those
 * that only hold it. Null where the caret is in no mention, where nobody
 * matches, or where what is typed is a handle already: Enter then sends, as
 * it would with no list. You are never offered.
 */
export function mentionCompletion(input: {
  readonly text: string
  readonly caret: number
  /** Every participant's display name, as shown. */
  readonly participants: readonly string[]
  readonly agents: readonly AgentCandidate[]
  readonly reader: Reader
}): Completion | null {
  const at = typedMention(input.text, input.caret)
  if (at === null) return null
  const typed = handleOf(at.typed)
  const targets = mentionTargets(input.participants, input.agents)
  if (targets.has(typed)) return null
  const { me, nameOf } = input.reader
  const mine = handleOf(displayName(me, nameOf.get(me)))
  const holding = [...targets]
    .filter(([handle]) => handle !== mine && handle.includes(typed))
    .sort(([, a], [, b]) => rank(a) - rank(b))
  const leads = ([handle]: readonly [string, MentionTarget]) =>
    handle.startsWith(typed)
  const found = [...holding.filter(leads), ...holding.filter(o => !leads(o))]
  // A space follows the handle chosen, unless one is there already.
  const space = /^\s/.test(input.text.slice(at.end)) ? "" : " "
  return found.length === 0
    ? null
    : {
        start: at.start,
        end: at.end,
        options: found.map(([handle, target]) => ({
          key: `@${handle}`,
          label: `@${handle}`,
          hint: null,
          kind: null,
          description: targetWords(target),
          insert: `@${handle}${space}`,
        })),
      }
}

/** Where a target is listed: the agent, members, people, other threads. */
function rank(target: MentionTarget): number {
  switch (target.kind) {
    case "agent":
      return 0
    case "thread":
      return target.agent.member ? 1 : 3
    case "person":
      return 2
  }
}

/** What an option says after its handle. */
function targetWords(target: MentionTarget): string {
  switch (target.kind) {
    case "agent":
      return "this thread's agent"
    case "person":
      return target.name
    case "thread":
      return target.agent.member ? "member" : "another thread's agent"
  }
}
