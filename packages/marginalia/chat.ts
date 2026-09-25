// chat — a human message in the conversation tree.
//
// A chat message is a pi `CustomMessage` (`role: "custom"`), not a custom
// entry (S19). pi's default conversion sends it to the model as a `user`
// message with its `content`, so `content` carries the speaker ("Alice: …")
// and needs no projector. A message that compels the agent IS the agent's
// prompt, so its thread's lane appends it; one that compels nobody is appended
// with no run (ADR-0020).
//
// `details` holds the structured fields, which readers decode here and never
// parse back out of `content`.

import {
  type AgentId,
  type AgentMessageLike,
  type ChatMode,
  compelledResponder,
  type LaneName,
  type Mention,
  messageText,
  type Position,
  type Responder,
  type ThreadLane,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeWith } from "./decode.ts"

export const CHAT_TYPE = "pineta.chat"

/** pi value namespace for display names. The key is the writer's id. */
export const PARTICIPANT_NAMESPACE = "pineta.participant"

const ResponderSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({ kind: Type.Literal("agent"), agent: Type.String() }),
])

export const DetailsSchema = Type.Object({
  /** The author, from the transport: a `WriterId`. */
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
  readonly author: WriterId
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
    author: d.author as WriterId,
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
        writer: chat.author,
      }
}

/**
 * Stored `pineta.participant` values -> each writer's name, by lane. Total: a
 * value that is not a string is skipped, like any malformed stored value.
 */
export function participantNames(
  values: Iterable<{ readonly key: string; readonly value: unknown }>,
): ReadonlyMap<WriterId, string> {
  const out = new Map<WriterId, string>()
  for (const { key, value } of values) {
    if (typeof value === "string") out.set(key as WriterId, value)
  }
  return out
}

/**
 * A writer's name for display: the one they set, or a label from their id so a
 * speaker is never blank.
 */
export const displayName = (
  writer: WriterId,
  set: string | undefined,
): string => set ?? `guest-${writer.slice(-4)}`

export type ChatDecision =
  /** No lane at this thread: append with no lane, parented at exactly `parent`. */
  | {
      readonly kind: "appendToTree"
      readonly parent: Position
      readonly details: ChatDetails
    }
  /** The thread's lane is idle: append through it. */
  | {
      readonly kind: "appendToLane"
      readonly lane: LaneName
      readonly details: ChatDetails
    }
  /** The thread's lane is idle and the agent is compelled: run. */
  | {
      readonly kind: "run"
      readonly lane: LaneName
      readonly details: ChatDetails
    }
  /** The agent is compelled here for the first time: create the thread's lane at `at`, then run. */
  | {
      readonly kind: "createAndRun"
      readonly at: Position
      readonly details: ChatDetails
    }
  /** The lane is busy: wait in its outbox, `position` messages ahead. */
  | {
      readonly kind: "hold"
      readonly lane: LaneName
      readonly details: ChatDetails
      readonly position: number
    }
  /** Another writer took the slot. Nothing is written; the sender chooses. */
  | { readonly kind: "conflict"; readonly by: WriterId | null }

/**
 * Decide what a human message does. Pure; the host gathers every input inside
 * one serial step, so each decision names exactly where to write.
 *
 * - `branch` makes a fork on purpose: plain, it is appended at `at` with no
 *   lane; compelled, it ALWAYS creates a new lane there. At an idle thread
 *   lane's own tip there is nothing to fork, so it is planned as a `reply`.
 * - A thread lane that is running, or has messages waiting, is busy: a new
 *   message holds behind the ones ahead of it, and a lane is never written
 *   while it runs (S21).
 * - A compelled `reply` that another writer raced, or that finds the lane busy,
 *   is a conflict: the sender chooses to queue or to branch. `queue` means
 *   that choice was already made. Plain chat never conflicts.
 */
export function planChat(input: {
  readonly author: WriterId
  readonly authorName: string
  readonly text: string
  readonly mode: ChatMode
  /** What the sender saw: the end they read, or the branch point. */
  readonly at: Position
  /** `threadEnd(at)`. */
  readonly end: Position
  /** `raceSince(at, author)`. */
  readonly race: { readonly by: WriterId } | null
  readonly mentions: readonly Mention[]
  readonly threadDefault: Responder
  /** The lane at `end` for a reply, at `at` for a branch (`threadLaneAt`). */
  readonly lane: ThreadLane
}): ChatDecision {
  const compels = compelledResponder(input)
  const details: ChatDetails = {
    author: input.author,
    authorName: input.authorName,
    text: input.text,
    compels,
  }
  const compelled = compels.kind === "agent"
  const { lane } = input

  // A branch at a lane's tip is a reply, but only at an IDLE lane's tip. A
  // running lane's tip equals the branch point only in the moment after it was
  // created there and before its prompt commits (the run starts after the
  // serial step returns): that is someone else's new line of work, and a
  // branch there is another.
  if (input.mode === "branch" && (lane.kind === "none" || lane.running)) {
    return compelled
      ? { kind: "createAndRun", at: input.at, details }
      : { kind: "appendToTree", parent: input.at, details }
  }
  const mode = input.mode === "branch" ? "reply" : input.mode

  if (lane.kind === "none") {
    if (!compelled) return { kind: "appendToTree", parent: input.end, details }
    if (mode === "reply" && input.race !== null)
      return { kind: "conflict", by: input.race.by }
    return { kind: "createAndRun", at: input.end, details }
  }

  const name = lane.name
  const busy = lane.running || lane.waiting > 0
  if (!compelled) {
    return busy
      ? { kind: "hold", lane: name, details, position: lane.waiting }
      : { kind: "appendToLane", lane: name, details }
  }
  if (mode === "reply" && (input.race !== null || busy)) {
    return {
      kind: "conflict",
      by: input.race?.by ?? lane.askedBy,
    }
  }
  return busy
    ? { kind: "hold", lane: name, details, position: lane.waiting }
    : { kind: "run", lane: name, details }
}
