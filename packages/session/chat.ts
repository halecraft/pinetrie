// session/chat — a chat as this client asks the host for it: how it is sent
// (`ChatHow`), and what sending it does (`planChatRequest`). Pure.

import {
  type CardId,
  type CardRecord,
  type ChatMode,
  type Intent,
  type LaneName,
  moveOf,
  type Position,
  parseMentions,
  type RootId,
  type SentCard,
  type WorkflowStateId,
  type WorkSetting,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { IN_COLUMN, type Pending, pendingOf } from "./card-moves.ts"

/** How a chat is sent: its mode, its column's lane, and its send id. */
export interface ChatHow {
  readonly mode?: ChatMode
  /** The lane the sender's column is bound to. */
  readonly lane?: LaneName
  /** A Start Agent column. */
  readonly asksAgent?: boolean
  /** Where a lane this send creates works; absent, the lane above's setting (ADR-0032). */
  readonly work?: WorkSetting
  /** The send's id, minted by a fresh column so it can find its message. */
  readonly id?: string
  /** The card the text is sent from, which the host spends once it is sent. */
  readonly card?: CardId
  /**
   * The cards pinned at the column's thread end: the run waits for each as
   * this client has it (ADR-0048).
   */
  readonly pinned?: readonly CardId[]
  /** The column it is sent from, where a refusal of its card's move is said. */
  readonly column?: string
  /** The lane id the column reserved: what a lane this send creates is called (ADR-0057). */
  readonly reserved?: LaneName
  /** The root a new tab minted as it opened: where its first send starts (ADR-0066). */
  readonly root?: RootId
  /** The WIP bookmark a lane this send creates starts from; absent, the line (ADR-0060). */
  readonly base?: string
  /**
   * The workflow state a root this send starts lands in; absent, the first
   * open state (ADR-0085).
   */
  readonly state?: WorkflowStateId
}

/** A chat as the host is asked for it: `how`'s defaults filled in. */
function chatIntent(input: {
  readonly text: string
  readonly at: Position
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
    mode: how.mode ?? "reply",
    lane: how.lane ?? null,
    asksAgent: how.asksAgent === true,
    mentions: parseMentions(text),
    work: how.work ?? null,
    card: input.card,
    pinned: input.pinned,
    reserved: how.reserved ?? null,
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
 * version as this client has it, which the host waits for (S96). It never
 * refuses: the gather has already minted and held a root for a send at the
 * root (`RootDocs.rootFor`), so a refusal added here must move that minting
 * after the plan.
 */
export function planChatRequest(input: {
  readonly text: string
  readonly at: Position
  readonly how: ChatHow
  readonly root: RootId
  /** The card `how.card` names as drawn, with its text's version now; null when none is drawn. */
  readonly card: {
    readonly record: CardRecord
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
        : pendingOf(
            id,
            moveOf(card.record, null),
            IN_COLUMN(how.column ?? ""),
            null,
          ),
  }
}

/**
 * Whether a send's answer started a root: a thread at the root written, as
 * a conversation or a run (ADR-0085). The session then puts the root in your
 * list, so a root you start is yours.
 */
export const startsRoot = (at: Position, outcome: Outcome): boolean =>
  at.kind === "root" &&
  (outcome.kind === "appended" || outcome.kind === "started")
