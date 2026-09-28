// chat — a human message in the conversation tree.
//
// A chat message is a pi `CustomMessage` (`role: "custom"`), not a custom
// entry (S19). pi's default conversion sends it to the model as a `user`
// message with its `content`, so `content` carries the speaker ("Alice: …")
// and needs no projector. A message that compels the agent IS the agent's
// prompt, so its thread's lane runs it; one that compels nobody is appended
// with no run (ADR-0020). Who a message is for comes from its mentions, then
// from whether its thread has a lane (`address`, ADR-0021).
//
// `details` holds the structured fields, which readers decode here and never
// parse back out of `content`.

import {
  type AgentId,
  type AgentMessageLike,
  address,
  agentByDefault,
  type ChatMode,
  isBusy,
  type LaneName,
  type Mention,
  messageText,
  type Position,
  type Responder,
  type ThreadLane,
  type WriterId,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { decodeLand, landLine } from "./land.ts"
import { showHostWorkingCopy } from "./work.ts"

export const CHAT_TYPE = "pineta.chat"

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
  /** The send that wrote it (the command's id), so its column can find it. */
  sendId: Type.String(),
  /** A sent draft's other editors (`WriterId`s), in order of first edit. */
  contributors: Type.Optional(Type.Array(Type.String())),
})

const ChatSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(CHAT_TYPE),
  details: DetailsSchema,
})

/**
 * A chat's structured fields. `author` is who sent it; a draft written
 * together (ADR-0025) also names its other editors, in `contributors`, so it
 * reads "Ada, with Bea". The model reads only the sender's name.
 */
export interface ChatDetails {
  readonly author: WriterId
  readonly authorName: string
  readonly text: string
  readonly compels: Responder
  readonly sendId: string
  /** Absent when the sender wrote it alone. */
  readonly contributors?: readonly WriterId[]
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

/**
 * Details that matched `DetailsSchema` -> `ChatDetails`, branding the ids. The
 * one conversion, for a chat in the tree and a message held in the outbox.
 */
export const detailsFromStored = (
  d: Static<typeof DetailsSchema>,
): ChatDetails => ({
  author: d.author as WriterId,
  authorName: d.authorName,
  text: d.text,
  compels:
    d.compels.kind === "agent"
      ? { kind: "agent", agent: d.compels.agent as AgentId }
      : { kind: "none" },
  sendId: d.sendId,
  ...(d.contributors === undefined
    ? {}
    : { contributors: d.contributors as WriterId[] }),
})

/** A stored message -> its chat details, or undefined if it is not a chat. */
export const decodeChat = (message: unknown): ChatDetails | undefined =>
  decodeWith(ChatSchema, message, ({ details }) => detailsFromStored(details))

/**
 * The text of any citable message: a chat's own `text`, never its attributed
 * `content`, so a span covers exactly what its author wrote; a land message's
 * one line, never the prompt the model read; otherwise pi's message text. The
 * one definition shared by citing and rendering.
 */
export function entryText(message: unknown): string {
  const chat = decodeChat(message)
  if (chat !== undefined) return chat.text
  const land = decodeLand(message)
  if (land !== undefined) return landLine(land)
  return messageText(message as AgentMessageLike)
}

/**
 * A stored message -> what the projections render. A chat becomes role `chat`
 * with its author; a land message becomes role `land` with its one line
 * (ADR-0033); anything else passes through unchanged for `core` to judge.
 */
export function renderableMessage(message: unknown): AgentMessageLike {
  const land = decodeLand(message)
  if (land !== undefined) return { role: "land", content: landLine(land) }
  const chat = decodeChat(message)
  return chat === undefined
    ? (message as AgentMessageLike)
    : {
        role: "chat",
        content: chat.text,
        author: chat.authorName,
        compelled: chat.compels.kind === "agent",
        writer: chat.author,
        sendId: chat.sendId,
        ...(chat.contributors === undefined
          ? {}
          : { contributors: chat.contributors }),
      }
}

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
 * - Who it is for is `address`: its mentions, else the thread's default (the
 *   agent where the thread has a lane or the column is a Start Agent column).
 * - `branch` starts a thread at `at` and never continues a lane: plain, it is
 *   appended there with no lane; compelled, it creates a new lane there.
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
  /** The thread, from `threadOf`. */
  readonly thread: {
    readonly end: Position
    readonly lane: ThreadLane
    readonly race: { readonly by: WriterId } | null
  }
  readonly mentions: readonly Mention[]
  /** Every participant's display name (`participants`). */
  readonly participants: readonly string[]
  readonly asksAgent: boolean
  /** The command's id. */
  readonly sendId: string
  /** A sent draft's other editors; empty for a message written alone. */
  readonly contributors: readonly WriterId[]
  /**
   * Your working copy's root when the thread works, or will work, in its own
   * copy: paths under it are stored as the lane sees them, under `/mnt/host-working-copy`, so
   * people and the model read the same text (ADR-0034). Null otherwise.
   */
  readonly hostWorkingCopy: string | null
}): ChatDecision {
  const { lane, end, race } = input.thread
  const branch = input.mode === "branch"
  const { compels } = address({
    mentions: input.mentions,
    participants: input.participants,
    agentByDefault: agentByDefault({
      mode: input.mode,
      lane,
      asksAgent: input.asksAgent,
    }),
  })
  const details: ChatDetails = {
    author: input.author,
    authorName: input.authorName,
    text:
      input.hostWorkingCopy === null
        ? input.text
        : showHostWorkingCopy(input.text, input.hostWorkingCopy),
    compels,
    sendId: input.sendId,
    ...(input.contributors.length === 0
      ? {}
      : { contributors: input.contributors }),
  }
  const compelled = compels.kind === "agent"

  if (branch) {
    return compelled
      ? { kind: "createAndRun", at: input.at, details }
      : { kind: "appendToTree", parent: input.at, details }
  }

  if (lane.kind === "none") {
    if (!compelled) return { kind: "appendToTree", parent: end, details }
    if (input.mode === "reply" && race !== null)
      return { kind: "conflict", by: race.by }
    return { kind: "createAndRun", at: end, details }
  }

  const name: LaneName = lane.name
  const busy = isBusy(lane)
  if (!compelled) {
    return busy
      ? { kind: "hold", lane: name, details, position: lane.waiting }
      : { kind: "appendToLane", lane: name, details }
  }
  if (input.mode === "reply" && (race !== null || busy)) {
    return { kind: "conflict", by: race?.by ?? lane.askedBy }
  }
  return busy
    ? { kind: "hold", lane: name, details, position: lane.waiting }
    : { kind: "run", lane: name, details }
}
