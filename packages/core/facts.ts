// core/facts — what the host tells a thread as a fact in it: who stopped a run,
// who joined or left, an ask unanswered or undelivered, a round spent, a branch
// made, a budget spent.

import type { ArchivedCanvas } from "./board.ts"
import type { CanvasId, EntryId, ThreadId, WriterId } from "./ids.ts"

/**
 * Who stopped an ask's run, as a fact in its thread: queued as a fact card when
 * Stop is pressed, and appended as the run ends, so the agent's next run reads
 * it. pi's entries say a run was aborted, never by whom.
 */
export interface StopFact {
  readonly kind: "stopped"
  readonly lane: ThreadId
  /** The ask whose run was stopped: its prompt. */
  readonly prompt: EntryId
  readonly by: WriterId
  /** When Stop was pressed, in ms since the epoch. */
  readonly at: number
  /**
   * The message whose allowance was spent, when it was the allowance that
   * stopped the run, and `by` is whose message it was; absent for a Stop.
   */
  readonly allowance?: EntryId
}

/**
 * Who joined or left a thread's members: a person dismissed an agent, or the
 * agent left. Read back by `threadMembers`.
 */
export type MemberFact =
  | {
      readonly kind: "dismissed"
      readonly lane: ThreadId
      readonly member: ThreadId
      readonly by: WriterId
    }
  | {
      readonly kind: "left"
      readonly lane: ThreadId
      readonly member: ThreadId
      /** The person behind the run that left (`promptAuthor`). */
      readonly by: WriterId
    }

/**
 * An ask another thread's agent did not answer: its run was stopped or failed.
 * In the thread that asked; `member` is the asked thread, `by` the person
 * behind the chain.
 */
export interface UnansweredFact {
  readonly kind: "unanswered"
  readonly lane: ThreadId
  readonly member: ThreadId
  readonly why: "stopped" | "failed"
  readonly by: WriterId
}

/** Where a thread is: `threadReach` (`@pinetrie/rules`) reads it. */
export type Reach =
  | { readonly kind: "open"; readonly canvas: CanvasId }
  | {
      readonly kind: "archived"
      readonly canvas: CanvasId
      readonly record: ArchivedCanvas
    }
  | { readonly kind: "held"; readonly by: WriterId }
  /** In the trash of `canvas`'s canvas, until it is restored or deleted. */
  | { readonly kind: "trashed"; readonly canvas: CanvasId }
  | { readonly kind: "gone" }

/** A thread out of reach: its canvas archived, held in an inventory, trashed, or gone. */
export type Away = Exclude<Reach, { readonly kind: "open" }>

/**
 * An answer that could not be sent: the thread that asked went out of reach
 * while it was answered. In the answering thread; `to` is the thread that
 * asked, `why` where it is now.
 */
export interface UndeliveredFact {
  readonly kind: "undelivered"
  readonly lane: ThreadId
  readonly to: ThreadId
  readonly toName: string
  readonly why: Away
  readonly by: WriterId
}

/**
 * What the request after a round of answers told the people: a line for them,
 * in the thread whose message asked. `by` is whose it was.
 */
export interface RoundFact {
  readonly kind: "round"
  readonly lane: ThreadId
  readonly line: string
  readonly by: WriterId
}

/**
 * A person pressed Start or Open on an agent's proposal, in the thread that
 * proposed it. It tells the agent and people; whether the proposal is spent
 * is read from its branches' records, which a queued fact would lag.
 */
export interface BranchedFact {
  readonly kind: "branched"
  readonly lane: ThreadId
  readonly by: WriterId
  /** The `propose_branches` result's entry. */
  readonly proposal: EntryId
  readonly how: "started" | "opened"
  /** The titles of the rows pressed, in the proposal's order. */
  readonly titles: readonly string[]
}

/**
 * Agents spent an allowance: its message's tokens ran out, in the thread whose
 * message set it. `by` is whose message it was.
 */
export interface AllowanceSpentFact {
  readonly kind: "allowance-spent"
  readonly lane: ThreadId
  readonly allowance: EntryId
  readonly limit: number
  readonly by: WriterId
}
