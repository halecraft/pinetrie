// session/chat — a chat as this client asks the host for it: how it is sent
// (`SendHow`), and what sending it does (`planSendRequest`).

import {
  type CanvasId,
  type Intent,
  type MessageAt,
  type Position,
  parseMentions,
  type RootId,
  type SendMode,
  type SentCard,
  type TextCard,
  type TextCardId,
  type ThreadId,
  type WorkflowStateId,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { IN_COLUMN, type Pending, pendingSend } from "./card-moves.ts"

/** How a chat is sent: from what column and card, and its send id. */
export interface SendHow {
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
  /** The root a new canvas minted as it opened: where its first send starts. */
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
 * Where a send from a column goes (`MessageAt`): an unstarted thread's
 * starts it at its fork, or at the root for a new canvas's, in `canvas`, the
 * canvas the column is on; any other continues its thread from the end it
 * shows.
 */
export const columnMessageTarget = (
  mode: SendMode,
  thread: ThreadId,
  at: Position,
  canvas: CanvasId,
): MessageAt =>
  mode === "reply" && at.kind === "entry"
    ? { kind: "end", thread, seen: at.id }
    : { kind: "branch", thread, at: at.kind === "entry" ? at.id : null, canvas }

/** A chat as the host is asked for it: `how`'s defaults filled in. */
function sendIntent(input: {
  readonly text: string
  readonly at: MessageAt
  readonly how: SendHow
  readonly root: RootId
  readonly card: SentCard | null
  readonly pinned: readonly SentCard[]
}): Extract<Intent, { kind: "send" }> {
  const { text, how } = input
  return {
    kind: "send",
    text,
    root: input.root,
    at: input.at,
    mentions: parseMentions(text),
    card: input.card,
    pinned: input.pinned,
    base: how.base ?? null,
    state: how.state ?? null,
  }
}

/** What sending a chat does: what the host is asked, under which id, and what is drawn meanwhile. */
interface SendRequestPlan {
  readonly intent: Extract<Intent, { kind: "send" }>
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
export function planSendRequest(input: {
  readonly text: string
  readonly at: MessageAt
  readonly how: SendHow
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
}): SendRequestPlan {
  const { how, card } = input
  const id = how.id ?? input.freshId
  return {
    intent: sendIntent({
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
        : pendingSend(id, card.record.id, IN_COLUMN(how.column ?? "")),
  }
}

/**
 * Whether a send's answer started a root: a thread at the root written, as
 * a chat's message or a run. The session then puts the root in your
 * list, so a root you start is yours.
 */
export const startsRoot = (at: MessageAt, outcome: Outcome): boolean =>
  at.kind === "branch" &&
  at.at === null &&
  (outcome.kind === "appended" || outcome.kind === "started")
