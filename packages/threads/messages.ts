// threads/messages — an entry and its message as the reads decode them: one
// variant per role, each with the fields that role carries. The stored row is
// pi's and the host's, loose; `@pinetrie/rules`' `renderableMessage` is its one
// decoder, so nothing past it reads a role it was not given.

import type {
  CanvasId,
  EntryId,
  ImageRef,
  LatestFrom,
  PointId,
  Share,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import type { CardId } from "./card-ids.ts"
import type {
  AnswerDetails,
  IncomingDetails,
  RelayDetails,
} from "./mentions.ts"
import type { Proposal } from "./threads.ts"

/**
 * A part of a message's content, as read: its text, a call it makes, or an
 * image stored as a blob. The edge leaves out every other part (pi's
 * thinking, an image whose bytes are inline): nothing shows them.
 */
export type MessagePart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "toolCall"
      readonly id: string
      readonly name: string
      readonly arguments: unknown
    }
  | ({ readonly type: "image" } & ImageRef)

/** What a message says: a plain text, or its parts. */
export type MessageContent = string | readonly MessagePart[]

/**
 * What a thread is told when its base has new work: a behind entry's details,
 * decoded. `to` is the base's state it was told of, so it is told once per
 * state.
 */
export interface BehindView {
  readonly from: LatestFrom
  readonly to: PointId
  /** The files catching up would change. */
  readonly files: readonly string[]
  /** Those of `files` this thread's work changes too. */
  readonly overlap: readonly string[]
  /** The files the thread's proposed changes conflict in with the base now. */
  readonly conflicts: readonly string[]
}

/** One pinned card as a run read it. */
export interface PinnedCardRead {
  readonly id: CardId
  readonly text: string
  /** The card's owner, named in what the model read by their display name then. */
  readonly by: WriterId
}

/** The pinned cards a run read: a cards entry's details, decoded. */
export interface PinnedView {
  /** The lane of the run that read them. */
  readonly lane: ThreadId
  /** Every card pinned at the run's start, in order. */
  readonly cards: readonly PinnedCardRead[]
  /** Cards the model had read that are no longer pinned, with their first line. */
  readonly retired: readonly {
    readonly id: CardId
    readonly line: string
  }[]
}

/** The cards pinned to a canvas a run read: a canvas's cards entry, decoded. */
export interface CanvasPinnedView {
  /** The canvas they are pinned to. */
  readonly canvas: CanvasId
  /** Every card pinned to it at the run's start, in order. */
  readonly cards: readonly PinnedCardRead[]
  /** Cards the model had read that are no longer pinned, with their first line. */
  readonly retired: readonly {
    readonly id: CardId
    readonly line: string
  }[]
}

/**
 * The canvas's cards a run was told of: a canvas entry's details, decoded. One
 * line per card in the canvas's order, at most a cap of them, and how many more
 * there are.
 */
export interface CanvasView {
  readonly canvas: CanvasId
  /** The canvas's title, as told. */
  readonly title: string
  readonly lines: readonly string[]
  /** How many cards the list left out past its cap. */
  readonly more: number
}

/**
 * What a run's context carries besides the conversation: the newest entry of
 * each kind, which a compaction keeps in view.
 */
export interface ContextInView {
  readonly pinned?: PinnedView
  readonly canvasPinned?: CanvasPinnedView
  readonly canvas?: CanvasView
}

/** A person's message, decoded from the host's own (`pinetrie.message`). */
export interface PersonMessage {
  readonly role: "person"
  readonly content: string
  /** The speaker's display name, as written. */
  readonly author: string
  /** Whether it compelled the agent to reply. */
  readonly compelled: boolean
  /** The writer who sent it, from the transport. */
  readonly writer: WriterId
  /** The id of the send that wrote it, for its column. */
  readonly sendId: string
  /** The other people who wrote in the card it was sent from. */
  readonly contributors?: readonly WriterId[]
  /** The command it ran, qualified. */
  readonly command?: string
  /** The `/blob/` images its text shows. */
  readonly images?: readonly ImageRef[]
  /** The files its text shares, images among them. */
  readonly shared?: readonly Share[]
  /** The other threads' agents it asks and invites. */
  readonly asks?: readonly ThreadId[]
  readonly invites?: readonly ThreadId[]
}

/** The agent's message, as pi wrote it. */
export interface AssistantMessage {
  readonly role: "assistant"
  readonly content: MessageContent
  /**
   * Why pi's request ended. `aborted` is a Stop and `error` a failure; either
   * carries `errorMessage`.
   */
  readonly stopReason?: string
  readonly errorMessage?: string
}

/**
 * A tool's result, as pi wrote it, with what a host tool's says as a fact:
 * what a `catch_up` merged, a `propose_branches` proposal.
 */
export interface ToolResultMessage {
  readonly role: "toolResult"
  readonly content: MessageContent
  /** The call it answers. */
  readonly toolCallId: string
  readonly isError: boolean
  readonly merged?: readonly PointId[]
  readonly proposal?: Proposal
}

/** A fact the host wrote in the thread, as its one line. */
interface FactMessage {
  readonly role: "fact"
  readonly content: string
  /** A stop's fact: the ask whose run was stopped, and who stopped it. */
  readonly stopped?: {
    readonly prompt: EntryId
    readonly by: WriterId
    /** A spent allowance's message, when the allowance stopped it. */
    readonly allowance?: EntryId
  }
  /** A member's fact: who left the thread's members. */
  readonly member?: { readonly gone: ThreadId }
  /** What its line leaves out, such as jj's ids, shown as its title. */
  readonly detail?: string
}

/**
 * A message of an entry, decoded: one variant per role. pi's own roles are
 * `user`, `system`, `assistant` and `toolResult`; every other is the host's,
 * decoded from its custom message.
 */
export type AgentMessageLike =
  | PersonMessage
  | { readonly role: "user"; readonly content: MessageContent }
  | { readonly role: "system"; readonly content: MessageContent }
  | AssistantMessage
  | ToolResultMessage
  /** A resolution's prompt: the states merged into the lane. */
  | Merging<"land">
  /** An update: the states merged into the lane. */
  | Merging<"update">
  /** A split's prompt. */
  | { readonly role: "stack"; readonly content: string }
  /** A Resume's carry-on. */
  | { readonly role: "carry-on"; readonly content: string }
  | FactMessage
  /** The base's new work the thread was told of. */
  | {
      readonly role: "behind"
      readonly content: string
      readonly behind: BehindView
    }
  /** An ask from another thread. */
  | {
      readonly role: "relay"
      readonly content: string
      readonly relay: RelayDetails
    }
  /** An asked agent's answer. */
  | {
      readonly role: "answer"
      readonly content: string
      readonly answer: AnswerDetails
    }
  /** What an asked agent was told of the thread that asked. */
  | {
      readonly role: "incoming"
      readonly content: string
      readonly incoming: IncomingDetails
    }
  /** The cards a run read: no message, a marker above its prompt. */
  | {
      readonly role: "pinned"
      readonly content: ""
      readonly pinned: PinnedView
    }
  | {
      readonly role: "canvas-pinned"
      readonly content: ""
      readonly canvasPinned: CanvasPinnedView
    }
  | {
      readonly role: "canvas"
      readonly content: ""
      readonly canvas: CanvasView
    }

interface Merging<R extends "land" | "update"> {
  readonly role: R
  readonly content: string
  readonly merged: readonly PointId[]
}

/** Every role a decoded message has. */
export type Role = AgentMessageLike["role"]

/** The kinds of entry pi writes. */
const ENTRY_TYPES = [
  "message",
  "compaction",
  "branch_summary",
  "custom",
] as const

export type EntryType = (typeof ENTRY_TYPES)[number]

export const isEntryType = (s: string): s is EntryType =>
  (ENTRY_TYPES as readonly string[]).includes(s)

export interface EntryLike {
  readonly id: EntryId
  readonly parentId: EntryId | null
  readonly type: EntryType
  /** The thread whose commit wrote it: the row's column. */
  readonly thread: ThreadId
  /**
   * A message entry's message; absent on an entry of any other type, and on
   * a message whose role the reads leave out (`renderableMessage`).
   */
  readonly message?: AgentMessageLike
  /**
   * A compaction only: the context entries its retained tail carries (the
   * newest of each kind), which the model reads after the summary; absent
   * when it carries none.
   */
  readonly carried?: ContextInView
  /** When it was written, in ms since the epoch: the row's column. */
  readonly timestamp?: number
}

/**
 * A tool call, as stored: what it is, not how it reads. Its words are
 * `@pinetrie/interface`'s (`callLabel`, `callPurpose`).
 */
export interface ToolCall {
  readonly id: string
  /** The tool's name as the model called it: a `ToolId`, or a tool pine·trie does not register. */
  readonly name: string
  /** What it touched, whole: a path, a command, or a search's pattern and path (`callSubject`). */
  readonly subject?: string
  /** What it is for, in the model's plain words (`callIntent`), which a tool that takes one requires. */
  readonly intent?: string
  /** Its result, when the result is on the same path. */
  readonly result?: ToolResult
}

/** A tool's result. */
export interface ToolResult {
  /** As stored: a terminal tool's (`isTerminalOutputTool`) keeps its output's SGR, which a row draws and the model never reads. */
  readonly text: string
  readonly isError: boolean
  /** The images it returned, stored as blobs. */
  readonly images: readonly ImageRef[]
}

interface Said {
  readonly id: EntryId
  /** The thread its entry is in. */
  readonly thread: ThreadId
  readonly text: string
}

interface Relayed<R extends "relay" | "answer"> extends Said {
  readonly role: R
  readonly author: string
  readonly from: ThreadId
}

/** A message a reader sees: one variant per role a column shows. */
export type TranscriptMessage =
  | (Said & {
      readonly role: "person"
      /** The speaker's display name as sent. */
      readonly author: string
      readonly compelled: boolean
      /** Who sent it, so a reader can look up their current name. */
      readonly writer: WriterId
      /** The send that wrote it. */
      readonly sendId: string
      /** The other people who wrote in the card it was sent from. */
      readonly contributors?: readonly WriterId[]
      /** The command it ran, qualified. */
      readonly command?: string
      /** The `/blob/` images its text shows. */
      readonly images?: readonly ImageRef[]
      /** The files its text shares, images among them. */
      readonly shared?: readonly Share[]
    })
  /** An ask relayed from another thread: spoken by its asker. */
  | Relayed<"relay">
  /** An asked agent's answer: spoken by the answering thread. */
  | Relayed<"answer">
  | (Said & {
      readonly role: "assistant"
      /** The tools it called, each with its result once known; absent for none. */
      readonly toolCalls?: readonly ToolCall[]
    })
  /** A resolution's prompt, and an update: the states merged into the lane. */
  | (Said & { readonly role: "land"; readonly merged: readonly PointId[] })
  | (Said & { readonly role: "update"; readonly merged: readonly PointId[] })
  /** What an asked agent was told: the thread it came from. */
  | (Said & { readonly role: "incoming"; readonly from: ThreadId })
  /** A fact: what its line leaves out, as its title. */
  | (Said & { readonly role: "fact"; readonly detail?: string })
  | (Said & { readonly role: "user" })
  | (Said & { readonly role: "stack" })
  | (Said & { readonly role: "carry-on" })
  | (Said & { readonly role: "behind" })

/** The proposal a `propose_branches` result holds; undefined for any other message. */
export const messageProposal = (
  message: AgentMessageLike | undefined,
): Proposal | undefined =>
  message?.role === "toolResult" ? message.proposal : undefined

/** Who wrote a person's message; undefined for any other message. */
export const messageWriter = (
  message: AgentMessageLike | undefined,
): WriterId | undefined =>
  message?.role === "person" ? message.writer : undefined

/** The tools an assistant message called; none for any other message. */
export const transcriptCalls = (
  message: TranscriptMessage,
): readonly ToolCall[] =>
  message.role === "assistant" ? (message.toolCalls ?? []) : []
