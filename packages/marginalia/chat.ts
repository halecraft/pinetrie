// chat — a human message in the conversation tree.
//
// A chat message is a pi `CustomMessage` (`role: "custom"`), not a custom
// entry (S19). pi's default conversion sends it to the model as a `user`
// message with its `content`, so `content` carries the speaker ("Alice: …")
// and needs no projector. A message that compels the agent IS the agent's
// prompt, so the agent's lane appends it; one that compels nobody is appended
// on its author's lane with no run.
//
// `details` holds the structured fields, which readers decode here and never
// parse back out of `content`.

import {
  type AgentId,
  type AgentMessageLike,
  type Attach,
  type ChatAt,
  compelledResponder,
  ERR,
  type ErrCode,
  type LaneName,
  type Mention,
  messageText,
  planAttach,
  type Responder,
  resolveTarget,
  type TurnState,
  type WriterLaneState,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"

export const CHAT_TYPE = "pineta.chat"

/** pi value namespace for display names. The key is the writer's lane name. */
export const PARTICIPANT_NAMESPACE = "pineta.participant"

const ResponderSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({ kind: Type.Literal("agent"), agent: Type.String() }),
])

const DetailsSchema = Type.Object({
  /** The author's lane name, from the transport. */
  author: Type.String(),
  /** The author's display name when they wrote it. Copied, never looked up. */
  authorName: Type.String(),
  text: Type.String(),
  compels: ResponderSchema,
})

const ChatSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(CHAT_TYPE),
  details: DetailsSchema,
})

export interface ChatDetails {
  readonly author: LaneName
  readonly authorName: string
  readonly text: string
  readonly compels: Responder
}

/** The pi `CustomMessage` a chat is stored as. */
export interface ChatMessage {
  readonly role: "custom"
  readonly customType: typeof CHAT_TYPE
  readonly content: string
  readonly display: true
  readonly details: ChatDetails
  readonly timestamp: number
}

/**
 * The text the model reads. The speaker's name is part of it, so pi's own
 * conversion carries attribution into context and a rename later cannot
 * rewrite what the agent already saw.
 */
export const attributed = (d: ChatDetails): string =>
  `${d.authorName}: ${d.text}`

export const encodeChat = (
  details: ChatDetails,
  timestamp: number,
): ChatMessage => ({
  role: "custom",
  customType: CHAT_TYPE,
  content: attributed(details),
  display: true,
  details,
  timestamp,
})

/** A stored message -> its chat details, or undefined if it is not a chat. */
export const decodeChat = (message: unknown): ChatDetails | undefined =>
  decodeWith(ChatSchema, message, ({ details: d }) => ({
    author: d.author as LaneName,
    authorName: d.authorName,
    text: d.text,
    compels:
      d.compels.kind === "agent"
        ? { kind: "agent", agent: d.compels.agent as AgentId }
        : { kind: "none" },
  }))

/**
 * The text of any citable message: a chat's own `text`, never its attributed
 * `content`, so a span covers exactly what its author wrote; otherwise pi's
 * message text. The one definition shared by citing and rendering.
 */
export function entryText(message: unknown): string {
  const chat = decodeChat(message)
  return chat === undefined
    ? messageText(message as AgentMessageLike)
    : chat.text
}

/**
 * A stored message -> what the projections render. A chat becomes role `chat`
 * with its author; anything else passes through unchanged for `core` to judge.
 */
export function renderableMessage(message: unknown): AgentMessageLike {
  const chat = decodeChat(message)
  return chat === undefined
    ? (message as AgentMessageLike)
    : {
        role: "chat",
        content: chat.text,
        author: chat.authorName,
        compelled: chat.compels.kind === "agent",
      }
}

/**
 * Stored `pineta.participant` values -> each writer's name, by lane. Total: a
 * value that is not a string is skipped, like any malformed stored value.
 */
export function participantNames(
  values: Iterable<{ readonly key: string; readonly value: unknown }>,
): ReadonlyMap<LaneName, string> {
  const out = new Map<LaneName, string>()
  for (const { key, value } of values) {
    if (typeof value === "string") out.set(key as LaneName, value)
  }
  return out
}

/**
 * A writer's name for display: the one they set, or a label from their lane so
 * a speaker is never blank.
 */
export const displayName = (lane: LaneName, set: string | undefined): string =>
  set ?? `guest-${lane.slice(-4)}`

export type ChatDecision =
  /** Compels nobody: append on the author's lane, and nothing runs. */
  | {
      readonly kind: "append"
      readonly attach: Attach
      readonly details: ChatDetails
    }
  /** Compels the agent: the message is its prompt, on the agent's lane. */
  | {
      readonly kind: "run"
      readonly agent: AgentId
      readonly attach: Attach
      readonly details: ChatDetails
    }
  | { readonly kind: "refused"; readonly code: ErrCode }

/**
 * Decide where a human message goes and whether the agent answers. Pure.
 *
 * Both outcomes attach at the same place, the position the author is viewing,
 * so a compelled message and a plain one sit identically in the tree; only the
 * lane that appends it differs.
 */
export function planChat(input: {
  readonly author: LaneName
  readonly authorName: string
  readonly text: string
  readonly at: ChatAt
  readonly mentions: readonly Mention[]
  readonly threadDefault: Responder
  readonly authorLane: WriterLaneState
  readonly agentLane: WriterLaneState
  readonly agentTurn: TurnState
}): ChatDecision {
  const compels = compelledResponder(input)
  const details: ChatDetails = {
    author: input.author,
    authorName: input.authorName,
    text: input.text,
    compels,
  }
  if (compels.kind === "none") {
    return {
      kind: "append",
      attach: planAttach(input.authorLane, input.at),
      details,
    }
  }
  // The agent answers one message at a time; a second compelled message while
  // it runs is refused rather than silently dropped.
  if (input.agentTurn.busy) return { kind: "refused", code: ERR.BUSY }
  return {
    kind: "run",
    agent: compels.agent,
    attach: planAttach(
      input.agentLane,
      resolveTarget(input.authorLane, input.at),
    ),
    details,
  }
}
