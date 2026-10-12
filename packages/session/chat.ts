// session/chat — a chat as this client asks the host for it: how it is sent
// (`ChatHow`), and what sending it does (`planChatRequest`).

import {
  type ChatAt,
  type ChatMode,
  type Intent,
  type Position,
  parseMentions,
  type RootId,
  type SentCard,
  type TaskId,
  type TextCard,
  type TextCardId,
  type ThreadId,
  type WorkflowStateId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { IN_COLUMN, type Pending, sendPendingOf } from "./card-moves.ts"

/** How a chat is sent: from what column and card, and its send id. */
export interface ChatHow {
  /** A Start Agent column. */
  readonly asksAgent?: boolean
  /** The send's id, when its sender names one. */
  readonly id?: string
  /** The card the text is sent from, which the host spends once it is sent. */
  readonly card?: TextCardId
  /**
   * The cards pinned at the column's thread end: the run waits for each as
   * this client has it.
   */
  readonly pinned?: readonly TextCardId[]
  /** The column it is sent from, where a refusal of its card's move is said. */
  readonly column?: string
  /** The root a new tab minted as it opened: where its first send starts. */
  readonly root?: RootId
  /** The WIP bookmark a lane this send creates starts from; absent, accepted work. */
  readonly base?: string
  /**
   * The workflow state a root this send starts lands in; absent, the first
   * open state.
   */
  readonly state?: WorkflowStateId
}

/**
 * Where a send from a column goes (`ChatAt`): an unstarted thread's
 * starts it at its fork, or at the root for a new tab's, in `task`, the
 * task the column is on; any other continues its thread from the end it
 * shows.
 */
export const chatAtOf = (
  mode: ChatMode,
  thread: ThreadId,
  at: Position,
  task: TaskId,
): ChatAt =>
  mode === "reply" && at.kind === "entry"
    ? { kind: "end", thread, seen: at.id }
    : { kind: "branch", thread, at: at.kind === "entry" ? at.id : null, task }

/** A chat as the host is asked for it: `how`'s defaults filled in. */
function chatIntent(input: {
  readonly text: string
  readonly at: ChatAt
  readonly how: ChatHow
  readonly root: RootId
  readonly card: SentCard | null
  readonly pinned: readonly SentCard[]
}): Extract<Intent, { kind: "chat" }> {
  const { text, how } = input
  return {
    kind: "chat",
    text,
    root: input.root,
    at: input.at,
    asksAgent: how.asksAgent === true,
    mentions: parseMentions(text),
    card: input.card,
    pinned: input.pinned,
    base: how.base ?? null,
    state: how.state ?? null,
  }
}

/** What sending a chat does: what the host is asked, under which id, and what is drawn meanwhile. */
export interface ChatRequestPlan {
  readonly intent: Extract<Intent, { kind: "chat" }>
  /** The request id, stored as the message's `sendId`. */
  readonly id: string
  /**
   * The card this send spends, drawn out of its composer until this tab's
   * copy holds what the host did with it, spent or queued; null with no card.
   */
  readonly pending: Pending | null
}

/**
 * A chat as this client sends it, from what the session gathered: the root
 * it is written in, the card it is sent from as drawn, and each card's text
 * version as this client has it, which the host waits for. It never
 * refuses: the gather has already minted and held a root for a send at the
 * root (`RootDocs.rootFor`), so a refusal added here must move that minting
 * after the plan.
 */
export function planChatRequest(input: {
  readonly text: string
  readonly at: ChatAt
  readonly how: ChatHow
  readonly root: RootId
  /** The card `how.card` names as drawn, with its text's version now; null when none is drawn. */
  readonly card: {
    readonly record: TextCard
    readonly seen: string
  } | null
  /** Each of `how.pinned` with its text's version now. */
  readonly pinned: readonly SentCard[]
  /** The request id when `how.id` gives none. */
  readonly freshId: string
}): ChatRequestPlan {
  const { how, card } = input
  const id = how.id ?? input.freshId
  return {
    intent: chatIntent({
      text: input.text,
      at: input.at,
      how,
      root: input.root,
      card: card === null ? null : { id: card.record.id, seen: card.seen },
      pinned: input.pinned,
    }),
    id,
    pending:
      card === null
        ? null
        : sendPendingOf(id, card.record.id, IN_COLUMN(how.column ?? "")),
  }
}

/**
 * Whether a send's answer started a root: a thread at the root written, as
 * a conversation or a run. The session then puts the root in your
 * list, so a root you start is yours.
 */
export const startsRoot = (at: ChatAt, outcome: Outcome): boolean =>
  at.kind === "branch" &&
  at.at === null &&
  (outcome.kind === "appended" || outcome.kind === "started")
