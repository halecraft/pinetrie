// core/reports — what a reader is told of a run: an ask's digest, how the
// thread's last run ended, and the thread's focus.

import type { EntryId, ThreadId, WriterId } from "./ids.ts"

/** What a digest says: a model's reply on an ask's work, as read. */
export interface DigestBody {
  /** One line of at most `HEADLINE_WORDS` words (`@pinetrie/rules`' `digest.ts`). */
  readonly headline: string
  /**
   * At most `MAX_POINTS` markdown lines, one point each; empty when the work
   * in between adds nothing to the ask's last word.
   */
  readonly points: readonly string[]
}

/**
 * An ask's digest: replaced whole on each write, so a value, not a text.
 * A live one, written while its run lasts, has no points: they change on
 * each write, and only a final digest's are worth drawing.
 */
export type DigestRecord =
  | {
      /** The ask's prompt: the digest's key. */
      readonly prompt: EntryId
      /** When it was written, in ms since the epoch. */
      readonly at: number
      readonly final: false
      readonly headline: string
    }
  | ({
      readonly prompt: EntryId
      readonly at: number
      /** Written after its run ended: kept, and never replaced by a live one. */
      readonly final: true
    } & DigestBody)

/**
 * A thread's focus: what it is doing now, in a few words, named by a model
 * after each of its runs. A session record keyed by its thread.
 */
export interface FocusRecord {
  readonly thread: ThreadId
  /** At most `FOCUS_WORDS` words (`@pinetrie/rules`' `focus.ts`). */
  readonly focus: string
  /** The ask whose run's end named it: an older ask's focus never replaces it. */
  readonly ask: EntryId
  /** When it was written, in ms since the epoch. */
  readonly at: number
}

/** How urgently a model says a run's end asks the people in its thread to look. */
export type ReaderUrgency = "needsYou" | "worthARead" | "done"

/**
 * How a thread's last run ended: what happened, never what it asks of whom.
 * Each client decides that for its person (`attentionLevel`).
 */
export type RunEndReport =
  /** The run has stopped running, and the model has not answered yet. */
  | { readonly kind: "pending" }
  /** The model's answer; `reason` is null for `done`. */
  | {
      readonly kind: "modelSaid"
      readonly urgency: ReaderUrgency
      readonly reason: string | null
    }
  | { readonly kind: "failed"; readonly error: string }
  /** `by` is null for a stop made before stops were recorded. */
  | { readonly kind: "stopped"; readonly by: WriterId | null }
  /** The request failed, its answer was no urgency line, or its host stopped. */
  | { readonly kind: "unclassified" }

/** A thread's last run's end report: a session record keyed by its lane. */
export interface RunEndReportRecord {
  readonly lane: ThreadId
  /** The run's prompt. */
  readonly ask: EntryId
  /**
   * The run's last entry, from its asks (`AskIndex.last`), never the lane's
   * tip: a queued card popped at the run's end can move the tip before this
   * is read.
   */
  readonly end: EntryId
  readonly report: RunEndReport
}
