// chat — a human message in the conversation tree.
//
// A chat message is a pi `CustomMessage` (`role: "custom"`), not a custom
// entry (S19). pi's default conversion sends it to the model as a `user`
// message with its `content`, so `content` carries the speaker ("Alice: …")
// and needs no projector. A message that compels the agent IS the agent's
// prompt, so its thread's lane runs it; one that compels nobody is appended
// with no run (ADR-0120). Who a message is for comes from its mentions, then
// from whether its thread has a lane (`address`, ADR-0021).
//
// `details` holds the structured fields, which readers decode here and never
// parse back out of `content`. Its images are references: the model is given
// their bytes after `content`, by `withChatImages` (ADR-0042), and `content`
// itself stays text.

import {
  type AgentCandidate,
  type AgentId,
  type AgentMessageLike,
  address,
  CATCH_UP_TOOL,
  CONFLICT_TOOL,
  type CommandRef,
  type CommitId,
  commitId,
  ERR,
  IMAGE_MIMES,
  type ImageMime,
  type ImageRef,
  type Mention,
  type PlanMode,
  type Position,
  planModeOf,
  type Recipients,
  type Refusal,
  type Responder,
  refused,
  type SendAt,
  type Sha256,
  sendWaits,
  type TaskId,
  THE_AGENT,
  type ThreadId,
  type ThreadLane,
  type WorkflowStateId,
  type WriterId,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { type BaseNews, behindLine, decodeBehind } from "./behind.ts"
import { canvasFactLine, decodeCanvas, decodeCanvasFact } from "./canvas.ts"
import { decodeWith, ThreadIdSchema } from "./decode.ts"
import { decodeFact, factLine } from "./fact.ts"
import { decodeLand, type LandMessage, landLine } from "./land.ts"
import { type LinkedQuote, withQuotes } from "./links.ts"
import { decodePinned } from "./pinned.ts"
import {
  type AnswerMessage,
  decodeAnswer,
  decodeHeard,
  decodeRelay,
  heardLine,
  type RelayMessage,
} from "./relay.ts"
import { decodeStack, type StackMessage, stackLine } from "./stack.ts"
import { type CarryOnMessage, carryOnLine, decodeCarryOn } from "./stop.ts"
import { decodeTaskPinned } from "./task-pinned.ts"
import { decodeUpdate, updateLine } from "./update.ts"
import { showHostWorkingCopy } from "./work.ts"

export const CHAT_TYPE = "pinetrie.chat"

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
  /** Other threads' agents it asks, members already (ADR-0128). */
  asks: Type.Optional(Type.Array(ThreadIdSchema)),
  /** Other threads' agents it invites: they become members (ADR-0128). */
  invites: Type.Optional(Type.Array(ThreadIdSchema)),
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
  /** Other threads' agents it asks (ADR-0128); absent when none. */
  readonly asks?: readonly ThreadId[]
  /** Other threads' agents it invites (ADR-0128); absent when none. */
  readonly invites?: readonly ThreadId[]
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
 * stack message (ADR-0105), a carry-on message (ADR-0082), or an ask relayed
 * from another thread, or an answer that wakes its asker (ADR-0128).
 */
export type PromptMessage =
  | ChatMessage
  | LandMessage
  | StackMessage
  | CarryOnMessage
  | RelayMessage
  | AnswerMessage

/**
 * The text the model reads: what was typed, or for a command its expansion,
 * frozen when it was sent. The speaker's name is part of it, so pi's own
 * conversion carries attribution into context and a rename later cannot
 * rewrite what the agent already saw.
 */
export const attributed = (d: ChatDetails): string =>
  `${d.authorName}: ${d.command?.expanded ?? d.text}`

/**
 * A chat as stored: what the model reads is its attributed text, then each
 * past referent it links to quoted under it (`withQuotes`, ADR-0126),
 * frozen as it was sent, as the past never changes.
 */
export const encodeChat = (
  details: ChatDetails,
  timestamp: number,
  quotes: readonly LinkedQuote[] = [],
): ChatMessage => ({
  role: "custom",
  customType: CHAT_TYPE,
  content: withQuotes(attributed(details), quotes),
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
  ...(d.asks === undefined ? {} : { asks: d.asks }),
  ...(d.invites === undefined ? {} : { invites: d.invites }),
})

/** A stored message -> its chat details, or undefined if it is not a chat. */
export const decodeChat = (message: unknown): ChatDetails | undefined =>
  decodeWith(ChatSchema, message, ({ details }) => detailsFromStored(details))

/**
 * What a tool result of the host's tools says as a fact (ADR-0080), from its
 * `details`, never its text: an `ask_about_conflict` the host took, or the
 * commits a `catch_up` merged. Undefined for any other message.
 */
function toolResultFacts(
  message: unknown,
):
  | { readonly asked: true }
  | { readonly merged: readonly CommitId[] }
  | undefined {
  if (typeof message !== "object" || message === null) return undefined
  const m = message as {
    role?: unknown
    toolName?: unknown
    details?: unknown
  }
  if (m.role !== "toolResult") return undefined
  const details =
    typeof m.details === "object" && m.details !== null
      ? (m.details as { asked?: unknown; merged?: unknown })
      : {}
  if (m.toolName === CONFLICT_TOOL && details.asked === true)
    return { asked: true }
  if (
    m.toolName === CATCH_UP_TOOL &&
    Array.isArray(details.merged) &&
    details.merged.every(c => typeof c === "string" && c !== "")
  )
    return { merged: details.merged.map(c => commitId(c as string)) }
  return undefined
}

/**
 * A stored message -> what the projections render. A chat becomes role `chat`
 * with its author; a land, update, stack or carry-on message becomes role
 * `land`, `update`, `stack` or `carry-on` with its one line (ADR-0033,
 * ADR-0105, ADR-0082), as a fact becomes role `fact` and a base's news role
 * `behind` (ADR-0080); a cards entry becomes role `pinned` with the cards it
 * read (ADR-0048), a task's cards entry role `task-pinned`, and a canvas
 * entry role `canvas` with the list it told (ADR-0116); an ask relayed from
 * another thread, an answer and what an asked agent heard become roles
 * `relay`, `answer` and `heard` with their details (ADR-0128); a host tool's
 * result keeps its role and gains what it says as a fact (`asked`, `merged`,
 * ADR-0080); anything else passes through unchanged for `core` to judge.
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
  const fact = decodeFact(message)
  if (fact !== undefined)
    return fact.kind === "stopped"
      ? {
          role: "fact",
          content: factLine(fact),
          stopped: {
            prompt: fact.prompt,
            by: fact.by,
            ...(fact.budget === undefined ? {} : { budget: fact.budget }),
          },
        }
      : fact.kind === "dismissed" || fact.kind === "left"
        ? {
            role: "fact",
            content: factLine(fact),
            member: { gone: fact.member },
          }
        : { role: "fact", content: factLine(fact) }
  const relay = decodeRelay(message)
  if (relay !== undefined) return { role: "relay", content: relay.text, relay }
  const answer = decodeAnswer(message)
  if (answer !== undefined)
    return { role: "answer", content: answer.text, answer }
  const heard = decodeHeard(message)
  if (heard !== undefined)
    return { role: "heard", content: heardLine(heard), heard }
  const behind = decodeBehind(message)
  if (behind !== undefined)
    return { role: "behind", content: behindLine(behind), behind }
  const carryOn = decodeCarryOn(message)
  if (carryOn !== undefined)
    return { role: "carry-on", content: carryOnLine(carryOn) }
  // Not a message: the column draws a marker above the prompt it came with.
  const pinned = decodePinned(message)
  if (pinned !== undefined) return { role: "pinned", content: "", pinned }
  const taskPinned = decodeTaskPinned(message)
  if (taskPinned !== undefined)
    return { role: "task-pinned", content: "", taskPinned }
  const canvas = decodeCanvas(message)
  if (canvas !== undefined) return { role: "canvas", content: "", canvas }
  const canvasFact = decodeCanvasFact(message)
  if (canvasFact !== undefined)
    return { role: "fact", content: canvasFactLine(canvasFact) }
  const result = toolResultFacts(message)
  if (result !== undefined)
    return { ...(message as AgentMessageLike), ...result }
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
        ...(chat.asks === undefined ? {} : { asks: chat.asks }),
        ...(chat.invites === undefined ? {} : { invites: chat.invites }),
      }
}

/**
 * The person behind a run (ADR-0080), from its prompt as stored: a chat's
 * author, a land or stack message's `by`, or for an ask relayed from another
 * thread and an answer, the person behind the chain (ADR-0128). Null for
 * anything else.
 */
export function promptAuthor(message: unknown): WriterId | null {
  const chat = decodeChat(message)
  if (chat !== undefined) return chat.author
  return (
    decodeLand(message)?.by ??
    decodeStack(message)?.by ??
    decodeRelay(message)?.by ??
    decodeAnswer(message)?.by ??
    null
  )
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

/**
 * What a send that starts a thread needs for its card (ADR-0116, ADR-0117):
 * the task its card goes on, and the board state a new task lands in, null
 * for the first open one. The thread is the decision's own.
 */
export interface ThreadStarts {
  readonly task: TaskId
  readonly state: WorkflowStateId | null
}

export type ChatDecision =
  /**
   * No lane at this thread: append with no lane, parented at exactly
   * `parent`, in `thread`; first, on a branch, what its card `starts`.
   */
  | {
      readonly kind: "appendToTree"
      readonly thread: ThreadId
      readonly parent: Position
      readonly details: ChatDetails
      readonly starts: ThreadStarts | null
    }
  /** The thread's lane is idle: append through it. */
  | {
      readonly kind: "appendToLane"
      readonly thread: ThreadId
      readonly details: ChatDetails
    }
  /** The thread's lane is idle and the agent is compelled: run. */
  | {
      readonly kind: "run"
      readonly thread: ThreadId
      readonly details: ChatDetails
    }
  /**
   * The agent is compelled here for the first time: create the thread's lane
   * at `at`, named by the thread's id, then run; first, on a branch, what
   * its card `starts`.
   */
  | {
      readonly kind: "createAndRun"
      readonly at: Position
      readonly thread: ThreadId
      readonly details: ChatDetails
      readonly starts: ThreadStarts | null
    }
  /**
   * The thread's lane is idle and the agent is compelled, but its work
   * changes no file and its base has new work (ADR-0080): catch it up, then
   * plan the chat again.
   */
  | { readonly kind: "catch-up-first"; readonly thread: ThreadId }
  /**
   * The lane runs, or has cards queued: nothing is written, and the sender's
   * client queues its card behind them (ADR-0048).
   */
  | { readonly kind: "busy" }
  /** Another writer wrote at the slot first. Nothing is written; the sender chooses. */
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
  /** Other threads' agents on the task's canvas (ADR-0128). */
  readonly agents: readonly AgentCandidate[]
  readonly mode: PlanMode
  readonly lane: ThreadLane
  readonly asksAgent: boolean
  /** The text is a command. */
  readonly command: boolean
}): Recipients {
  const to = address({
    mentions: input.mentions,
    participants: input.participants,
    agents: input.agents,
    agentByDefault: agentByDefault(input),
  })
  return input.command
    ? { ...to, compels: { kind: "agent", agent: THE_AGENT } }
    : to
}

/**
 * Where a message into a thread goes, by its lane's state (ADR-0120,
 * ADR-0128): the one table a person's chat (`planChat`), a relayed ask and
 * an answer (`relay.ts`) are all planned with.
 *
 * - No lane: appended with no lane, or, compelled, the lane is created and
 *   runs. A compelled `reply` another writer raced is a conflict.
 * - A lane that runs, or has cards queued (`sendWaits`), is busy; in `queue`
 *   mode (the host's own send) only a run is. A busy lane is never written
 *   (S21): the message waits as a card, or, for a message that `steers`
 *   (an answer), is steered into the run at its next boundary.
 * - An idle lane appends, or, compelled, runs. A compelled `reply` that
 *   finds it raced or busy is a conflict, so its sender chooses.
 */
export type Delivery =
  | { readonly kind: "appendToTree" }
  | { readonly kind: "createAndRun" }
  | { readonly kind: "appendToLane"; readonly thread: ThreadId }
  | { readonly kind: "run"; readonly thread: ThreadId }
  | { readonly kind: "steer"; readonly thread: ThreadId }
  | { readonly kind: "busy" }
  | { readonly kind: "conflict"; readonly by: WriterId | null }

export function planDelivery(input: {
  readonly lane: ThreadLane
  readonly compelled: boolean
  readonly mode: PlanMode
  readonly race: { readonly by: WriterId } | null
  /** It may enter a running lane by a steer: only an answer (ADR-0128). */
  readonly steers: boolean
}): Delivery {
  const { lane, compelled, mode, race } = input
  if (lane.kind === "none") {
    if (!compelled) return { kind: "appendToTree" }
    if (mode === "reply" && race !== null)
      return { kind: "conflict", by: race.by }
    return { kind: "createAndRun" }
  }
  const thread: ThreadId = lane.name
  if (input.steers && lane.running) return { kind: "steer", thread }
  const busy = mode === "queue" ? lane.running : sendWaits(lane)
  if (!compelled)
    return busy ? { kind: "busy" } : { kind: "appendToLane", thread }
  if (mode === "reply" && (race !== null || busy))
    return { kind: "conflict", by: race?.by ?? lane.askedBy }
  return busy ? { kind: "busy" } : { kind: "run", thread }
}

/**
 * Decide what a human message does. Pure; the host gathers every input inside
 * one serial step, so each decision names exactly where to write.
 *
 * - Who it is for is `addressChat`, which the composer runs too.
 * - A `branch` starts its thread at its fork and never continues a lane:
 *   plain, it is appended there with no lane; compelled, it creates the
 *   thread's lane there. What its card needs comes with it (`starts`).
 * - Every decision that writes names the thread it writes in (`thread`):
 *   each entry is that thread's (ADR-0125).
 * - A thread lane that is running, or has cards queued, is busy: a message
 *   is not written, and its card is queued behind them, since a lane is never
 *   written while it runs (S21).
 * - A compelled `end` send that another writer raced, or that finds the lane
 *   busy, is a conflict: the sender chooses to queue or to branch. Plain chat
 *   never conflicts.
 * - `queue` is the host popping a queued card: it is the queue's turn, so
 *   only a run makes the lane busy.
 * - A lane is always named by its thread's id (ADR-0117): no other name is
 *   ever chosen.
 * - A run on a lane whose work changes no file, and whose base has new work,
 *   catches the lane up first (`catch-up-first`, ADR-0080), once per send.
 */
export function planChat(input: {
  readonly author: WriterId
  readonly authorName: string
  readonly text: string
  /** Where it goes. */
  readonly at: SendAt
  /** The thread, from `threadOfSend`. */
  readonly thread: {
    readonly end: Position
    readonly lane: ThreadLane
    readonly race: { readonly by: WriterId } | null
  }
  readonly mentions: readonly Mention[]
  /** Every participant's display name (`participants`). */
  readonly participants: readonly string[]
  /** Other threads' agents on the task's canvas (ADR-0128). */
  readonly agents: readonly AgentCandidate[]
  readonly asksAgent: boolean
  /** The command's id. */
  readonly sendId: string
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
  /**
   * What the thread's base has for it (`planBaseNews`, ADR-0080), and whether
   * this send has already caught it up: `pinetrie.base` is rewritten only at
   * the next refresh, so it still says the base has news.
   */
  readonly news: BaseNews["kind"]
  readonly caughtUp: boolean
  /** The board state a branch's new task lands in; null for the first open one. */
  readonly state: WorkflowStateId | null
}): ChatDecision {
  const { lane, end, race } = input.thread
  const { at } = input
  const mode = planModeOf(at)
  const branch = at.kind === "branch"
  const { command } = input
  if (command !== null && "unknown" in command)
    return refused(ERR.UNKNOWN_COMMAND, `no command /${command.unknown}`)
  if (command !== null && "unreadable" in command)
    return refused(
      ERR.UNKNOWN_COMMAND,
      `the file of /${command.unreadable} could not be read`,
    )
  const { compels, asks, invites } = addressChat({
    mentions: input.mentions,
    participants: input.participants,
    agents: input.agents,
    mode,
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
    ...(asks.length === 0 ? {} : { asks }),
    ...(invites.length === 0 ? {} : { invites }),
  }
  const compelled = compels.kind === "agent"

  if (branch) {
    const starts = { task: at.task, state: input.state }
    const thread = at.thread
    return compelled
      ? { kind: "createAndRun", at: end, thread, details, starts }
      : { kind: "appendToTree", thread, parent: end, details, starts }
  }

  const to = planDelivery({
    lane,
    compelled,
    mode,
    race,
    steers: false,
  })
  switch (to.kind) {
    case "appendToTree":
      return {
        kind: "appendToTree",
        thread: at.thread,
        parent: end,
        details,
        starts: null,
      }
    case "createAndRun":
      return {
        kind: "createAndRun",
        at: end,
        thread: at.thread,
        details,
        starts: null,
      }
    case "appendToLane":
      return { kind: "appendToLane", thread: to.thread, details }
    case "busy":
    case "conflict":
      return to
    case "steer":
    case "run":
      break
  }
  const name: ThreadId = to.thread
  return input.news === "catch-up" && !input.caughtUp
    ? { kind: "catch-up-first", thread: name }
    : { kind: "run", thread: name, details }
}
