// client/send — what the composer shows after a send, as a pure decision.

import type { Outcome } from "@pineta/protocol/codec"

export interface SendSettled {
  /**
   * Text to put back in the composer, or null to leave it. A message the host
   * did not write comes back, so nothing typed is lost: a conflict, or a
   * refusal such as a root archived a moment before (ADR-0029).
   */
  readonly restore: string | null
  readonly status: string
  /** A reply another writer raced: the sender chooses to queue or branch. */
  readonly conflict: {
    readonly text: string
    readonly by: string | null
  } | null
}

const ordinal = (n: number): string =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`

export function settleSend(outcome: Outcome, message: string): SendSettled {
  switch (outcome.kind) {
    case "conflict":
      return {
        restore: message,
        status: "",
        conflict: { text: message, by: outcome.by },
      }
    case "refused":
      return {
        restore: message,
        status: `not sent: ${outcome.message}`,
        conflict: null,
      }
    case "queued":
      return {
        restore: null,
        status: `waiting · ${ordinal(outcome.position + 1)} in line`,
        conflict: null,
      }
    default:
      return { restore: null, status: "", conflict: null }
  }
}
