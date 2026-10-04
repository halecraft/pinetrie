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
// parse back out of `content`. Its images are references: the model is given
// their bytes after `content`, by `withChatImages` (ADR-0042), and `content`
// itself stays text.

import {
  type Address,
  type AgentId,
  type AgentMessageLike,
  address,
  type CommandRef,
  ERR,
  IMAGE_MIMES,
  type ImageMime,
  type ImageRef,
  isBusy,
  type LaneName,
  type Mention,
  type PlanMode,
  type Position,
  type Refusal,
  type Responder,
  refused,
  type Sha256,
  THE_AGENT,
  type ThreadLane,
  type WriterId,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeWith } from "./decode.ts"
import { decodeLand, type LandMessage, landLine } from "./land.ts"
import { decodePinned } from "./pinned.ts"
import { type CarryOnMessage, carryOnLine, decodeCarryOn } from "./stop.ts"
import {
  decodeStack,
  decodeUpdate,
  type StackMessage,
  stackLine,
  updateLine,
} from "./update.ts"
import { showHostWorkingCopy } from "./work.ts"

export const CHAT_TYPE = "pineta.chat"

const ResponderSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({ kind: Type.Literal("agent"), agent: Type.String() }),
])

const ImageRefSchema = Type.Object({
  sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  mimeType: Type.Union(IMAGE_MIMES.map(m => Type.Literal(m))),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
})

const DetailsSchema = Type.Object({
  /** The author, from the transport: a `WriterId`. */
  author: Type.String(),
  /** The author's display name when they wrote it. Copied, never looked up. */
  authorName: Type.String(),
  text: Type.String(),
  compels: ResponderSchema,
  /** The send that wrote it (the command's id), so its column can find it. */
  sendId: Type.String(),
  /** The other people who wrote in the card it was sent from (`WriterId`s). */
  contributors: Type.Optional(Type.Array(Type.String())),
  /** The command it ran, and what the model read for it (ADR-0036). */
  command: Type.Optional(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      kind: Type.Union([Type.Literal("skill"), Type.Literal("prompt")]),
      file: Type.String(),
      hash: Type.String(),
      expanded: Type.String(),
    }),
  ),
  /** The images its text shows, by reference (ADR-0042). */
  images: Type.Optional(Type.Array(ImageRefSchema)),
})

const ChatSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(CHAT_TYPE),
  details: DetailsSchema,
})

/**
 * A chat's structured fields. `author` is who sent it; a card others wrote
 * in too (ADR-0048) also names them, in `contributors`, so it reads "Ada,
 * with Bea". The model reads only the sender's name.
 */
export interface ChatDetails {
  readonly author: WriterId
  readonly authorName: string
  readonly text: string
  readonly compels: Responder
  readonly sendId: string
  /** Absent when the sender wrote it alone. */
  readonly contributors?: readonly WriterId[]
  /** The command it ran (ADR-0036); `text` stays as typed. */
  readonly command?: CommandRef
  /**
   * The `/blob/` images its text shows, in order (ADR-0042): the model reads
   * their bytes after `content`. Absent when it shows none.
   */
  readonly images?: readonly ImageRef[]
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
 * What a run can start with: a compelled chat, a land message (ADR-0033), a
 * stack message (ADR-0038), or a carry-on message (ADR-0082).
 */
export type PromptMessage =
  | ChatMessage
  | LandMessage
  | StackMessage
  | CarryOnMessage

/**
 * The text the model reads: what was typed, or for a command its expansion,
 * frozen when it was sent. The speaker's name is part of it, so pi's own
 * conversion carries attribution into context and a rename later cannot
 * rewrite what the agent already saw.
 */
export const attributed = (d: ChatDetails): string =>
  `${d.authorName}: ${d.command?.expanded ?? d.text}`

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

/** An image part, as pi's messages carry one. */
interface ImagePart {
  readonly type: "image"
  readonly data: string
  readonly mimeType: ImageMime
}

/** The blobs every chat among `messages` shows, each once. */
export function chatImageShas(messages: readonly unknown[]): Sha256[] {
  const shas = new Set<Sha256>()
  for (const message of messages)
    for (const image of decodeChat(message)?.images ?? [])
      shas.add(image.sha256)
  return [...shas]
}

/**
 * `messages` as the model reads them: each chat with images carries them
 * after its text, as image parts, in the order its text shows them, their
 * base64 from `blobs`. A blob `blobs` lacks is named as text in its place.
 * Every other message is returned as it is. Pure.
 */
export function withChatImages<M>(
  messages: readonly M[],
  blobs: ReadonlyMap<
    Sha256,
    { readonly data: string; readonly mimeType: ImageMime }
  >,
): M[] {
  return messages.map(message => {
    const chat = decodeChat(message)
    if (chat?.images === undefined || chat.images.length === 0) return message
    const text = (message as { content: unknown }).content
    const parts: ({ type: "text"; text: string } | ImagePart)[] = [
      {
        type: "text",
        text: typeof text === "string" ? text : attributed(chat),
      },
    ]
    for (const image of chat.images) {
      const blob = blobs.get(image.sha256)
      parts.push(
        blob === undefined
          ? {
              type: "text",
              text: `[image ${image.sha256} is no longer stored]`,
            }
          : { type: "image", data: blob.data, mimeType: blob.mimeType },
      )
    }
    return { ...message, content: parts }
  })
}

/**
 * Details that matched `DetailsSchema` -> `ChatDetails`, branding the ids. The
 * one conversion of a chat in the tree.
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
  ...(d.command === undefined ? {} : { command: d.command }),
  ...(d.images === undefined
    ? {}
    : {
        images: d.images.map(i => ({ ...i, sha256: i.sha256 as Sha256 })),
      }),
})

/** A stored message -> its chat details, or undefined if it is not a chat. */
export const decodeChat = (message: unknown): ChatDetails | undefined =>
  decodeWith(ChatSchema, message, ({ details }) => detailsFromStored(details))

/**
 * A stored message -> what the projections render. A chat becomes role `chat`
 * with its author; a land, update, stack or carry-on message becomes role
 * `land`, `update`, `stack` or `carry-on` with its one line (ADR-0033,
 * ADR-0038, ADR-0082); a cards entry
 * becomes role `pinned` with the cards it read (ADR-0048); anything else
 * passes through unchanged for `core` to judge.
 */
export function renderableMessage(message: unknown): AgentMessageLike {
  const land = decodeLand(message)
  if (land !== undefined)
    return { role: "land", content: landLine(land), merged: land.yours }
  const update = decodeUpdate(message)
  if (update !== undefined)
    return {
      role: "update",
      content: updateLine(update),
      merged: [update.merged],
    }
  const stack = decodeStack(message)
  if (stack !== undefined) return { role: "stack", content: stackLine(stack) }
  const carryOn = decodeCarryOn(message)
  if (carryOn !== undefined)
    return { role: "carry-on", content: carryOnLine(carryOn) }
  // Not a message: the column draws a marker above the prompt it came with.
  const pinned = decodePinned(message)
  if (pinned !== undefined) return { role: "pinned", content: "", pinned }
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
        ...(chat.command === undefined ? {} : { command: chat.command.name }),
        ...(chat.images === undefined ? {} : { images: chat.images }),
      }
}

/**
 * After a run ends: a compelled message pi refused to run is still a person's
 * message, so it is appended, with no reply, rather than lost. A run pi
 * admitted, whatever became of the model's call, is done: its prompt is in
 * the tree. Pure.
 */
export const settleRun = (
  ran: { readonly kind: "ok" } | { readonly kind: "refused" },
): "done" | "keep" => (ran.kind === "refused" ? "keep" : "done")

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
  /**
   * The agent is compelled here for the first time: create the thread's lane
   * at `at`, under the id `lane`, then run.
   */
  | {
      readonly kind: "createAndRun"
      readonly at: Position
      readonly lane: LaneName
      readonly details: ChatDetails
    }
  /**
   * The lane runs, or has cards queued: nothing is written, and the sender's
   * client queues its card behind them (ADR-0048).
   */
  | { readonly kind: "busy" }
  /** Another writer took the slot. Nothing is written; the sender chooses. */
  | { readonly kind: "conflict"; readonly by: WriterId | null }
  /** Nothing is written: a `/package:name` that names no command. */
  | Refusal

/**
 * Whether a message with no mention asks the agent: in a thread with a lane,
 * or from a Start Agent column. A branch is a new thread, with no lane of its
 * own yet, so only a Start Agent column makes it ask (ADR-0021). A branch from
 * agent work asks through the `@agent ` its composer starts with.
 */
export const agentByDefault = (send: {
  readonly mode: PlanMode
  readonly lane: ThreadLane
  readonly asksAgent: boolean
}): boolean =>
  (send.mode !== "branch" && send.lane.kind === "lane") || send.asksAgent

/**
 * Who a chat is for, as the host decides it and the composer foresees it
 * (ADR-0021, ADR-0036): its mentions, else the thread's default (the agent
 * where the thread has a lane or the column is a Start Agent column). A
 * command is for the agent, as `@agent` is, whoever else it names. The people
 * it names are kept either way: the composer shows them.
 */
export function addressChat(input: {
  readonly mentions: readonly Mention[]
  readonly participants: readonly string[]
  readonly mode: PlanMode
  readonly lane: ThreadLane
  readonly asksAgent: boolean
  /** The text is a command. */
  readonly command: boolean
}): Address {
  const to = address({
    mentions: input.mentions,
    participants: input.participants,
    agentByDefault: agentByDefault(input),
  })
  return input.command
    ? { ...to, compels: { kind: "agent", agent: THE_AGENT } }
    : to
}

/**
 * Decide what a human message does. Pure; the host gathers every input inside
 * one serial step, so each decision names exactly where to write.
 *
 * - Who it is for is `addressChat`, which the composer runs too.
 * - `branch` starts a thread at `at` and never continues a lane: plain, it is
 *   appended there with no lane; compelled, it creates a new lane there.
 * - A thread lane that is running, or has cards queued, is busy: a message
 *   is not written, and its card is queued behind them, since a lane is never
 *   written while it runs (S21).
 * - A compelled `reply` that another writer raced, or that finds the lane busy,
 *   is a conflict: the sender chooses to queue or to branch. Plain chat never
 *   conflicts.
 * - `queue` is the host taking a queued card: it is the queue's turn, so
 *   only a run makes the lane busy.
 */
export function planChat(input: {
  readonly author: WriterId
  readonly authorName: string
  readonly text: string
  readonly mode: PlanMode
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
  /**
   * The ids a lane this message creates may take (ADR-0057): the one its
   * sender's column reserved, unless pi holds it already (`held`), else
   * `spare`, which the host made.
   */
  readonly newLane: {
    readonly reserved: LaneName | null
    readonly held: ReadonlySet<string>
    readonly spare: LaneName
  }
  /** The other people who wrote in its card; empty for a message written alone. */
  readonly contributors: readonly WriterId[]
  /** The images its text shows, as `planImages` found them in the store. */
  readonly images: readonly ImageRef[]
  /**
   * Your working copy's root when the thread works, or will work, in its own
   * copy: paths under it are stored as the lane sees them, under `/mnt/host-working-copy`, so
   * people and the model read the same text (ADR-0034). Null otherwise.
   */
  readonly hostWorkingCopy: string | null
  /**
   * The command its first word names, expanded (ADR-0036); `unknown` when it
   * has the form of one and names none; `unreadable` when its file could not
   * be read; null when it is not one.
   */
  readonly command:
    | CommandRef
    | { readonly unknown: string }
    | { readonly unreadable: string }
    | null
}): ChatDecision {
  const { lane, end, race } = input.thread
  const branch = input.mode === "branch"
  const { command } = input
  if (command !== null && "unknown" in command)
    return refused(ERR.UNKNOWN_COMMAND, `no command /${command.unknown}`)
  if (command !== null && "unreadable" in command)
    return refused(
      ERR.UNKNOWN_COMMAND,
      `the file of /${command.unreadable} could not be read`,
    )
  const { compels } = addressChat({
    mentions: input.mentions,
    participants: input.participants,
    mode: input.mode,
    lane,
    asksAgent: input.asksAgent,
    command: command !== null,
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
    ...(command === null ? {} : { command }),
    ...(input.images.length === 0 ? {} : { images: input.images }),
  }
  const compelled = compels.kind === "agent"
  const { reserved, held, spare } = input.newLane
  const created = reserved === null || held.has(reserved) ? spare : reserved

  if (branch) {
    return compelled
      ? { kind: "createAndRun", at: input.at, lane: created, details }
      : { kind: "appendToTree", parent: input.at, details }
  }

  if (lane.kind === "none") {
    if (!compelled) return { kind: "appendToTree", parent: end, details }
    if (input.mode === "reply" && race !== null)
      return { kind: "conflict", by: race.by }
    return { kind: "createAndRun", at: end, lane: created, details }
  }

  const name: LaneName = lane.name
  const busy = input.mode === "queue" ? lane.running : isBusy(lane)
  if (!compelled) {
    return busy
      ? { kind: "busy" }
      : { kind: "appendToLane", lane: name, details }
  }
  if (input.mode === "reply" && (race !== null || busy)) {
    return { kind: "conflict", by: race?.by ?? lane.askedBy }
  }
  return busy ? { kind: "busy" } : { kind: "run", lane: name, details }
}
