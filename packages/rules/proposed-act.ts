// proposed-act — an action on proposed changes other than a split, planned
// whole: accept, describe again, squash or refresh, each with the fact the
// thread is told once it is carried out.

import type {
  AcceptanceDecision,
  AcceptanceFacts,
  ErrCode,
  ProposedChangesFact,
  ProposedChangesGather,
  ProposedChangesSeen,
  Rebuild,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import { acceptedFact, actionFact } from "./fact.ts"
import { planAcceptance, planDescribeAgain, planRebuild } from "./proposed.ts"

/** What an action on proposed changes does, with its fact; or why not. */
export type ProposedAct =
  | { readonly kind: "refused"; readonly code: ErrCode }
  /** Describe the proposed changes again, once the command is done. */
  | { readonly kind: "describe"; readonly fact: ProposedChangesFact }
  | {
      readonly kind: "accept"
      readonly decision: Extract<
        AcceptanceDecision,
        { readonly kind: "accept" }
      >
      readonly fact: ProposedChangesFact
    }
  /** Rebuilt from the lane's tip, as one: a squash or a refresh. */
  | {
      readonly kind: "rebuild"
      readonly rebuild: Rebuild
      readonly fact: ProposedChangesFact
    }

/**
 * An action on `lane`'s proposed changes by `by`, from what was gathered for
 * it: an acceptance (`planAcceptance`), a description asked again
 * (`planDescribeAgain`), or a squash or refresh (`planRebuild`).
 */
export function planProposedAct(
  input: {
    readonly lane: ThreadId
    readonly by: WriterId
    readonly gathered: ProposedChangesGather | null
  } & (
    | { readonly action: "describe" }
    | {
        readonly action: "accept"
        /** What the acceptance was shown; null when it names none. */
        readonly seen: ProposedChangesSeen | null
        readonly acceptance: AcceptanceFacts | null
        readonly editing: ReadonlySet<string>
        readonly acceptedBookmark: string
        readonly to: string | null
        readonly now: number
      }
    | {
        readonly action: "squash" | "refresh"
        /** The lane's unfinished description, which a rebuild keeps. */
        readonly unfinished: string
      }
  ),
): ProposedAct {
  const { lane, by, gathered } = input
  switch (input.action) {
    case "describe": {
      const refused = planDescribeAgain(gathered)
      return refused === null
        ? { kind: "describe", fact: actionFact("describe", lane, by) }
        : { kind: "refused", code: refused }
    }
    case "accept": {
      const decision = planAcceptance({
        lane,
        gathered,
        seen: input.seen,
        acceptance: input.acceptance,
        editing: input.editing,
        acceptedBookmark: input.acceptedBookmark,
        to: input.to,
        now: input.now,
      })
      if (decision.kind === "refused") return decision
      return {
        kind: "accept",
        decision,
        fact: acceptedFact({
          lane,
          by,
          decision,
          acceptedBookmark: input.acceptedBookmark,
        }),
      }
    }
    case "squash":
    case "refresh": {
      const planned = planRebuild(gathered, input.unfinished)
      if (planned.kind === "refused")
        return { kind: "refused", code: planned.why }
      return {
        kind: "rebuild",
        rebuild: planned,
        fact: actionFact(input.action, lane, by),
      }
    }
  }
}
