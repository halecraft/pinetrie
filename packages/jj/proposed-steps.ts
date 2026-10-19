// A decision about proposed changes, from `@pinetrie/rules`, as the steps it
// runs on your repo and what the host does after. Each decision carries the
// facts its steps need, so each kind has one translation, and none that runs
// nothing. Every decision that moves proposed changes end with one mark
// (`markSteps`), so the host's version follows it; every one that removes
// proposed changes forgets it.

import {
  type AcceptanceDecision,
  type DescribeDecision,
  type Placed,
  type ProposedChangesRecord,
  type ProposedSource,
  proposedMessage,
  type Rebuild,
  type RefreshDecision,
  revisionChangeIds,
  type ThreadId,
  type ThreadName,
} from "@pinetrie/core"
import { proposedBookmark } from "./lane/names.ts"
import {
  forgetSteps,
  markSteps,
  planAbandonProposed,
  planAcceptanceSteps,
  planDescribe,
  planProposedChanges,
  planRebuildProposed,
  planRefreshProposed,
} from "./plan.ts"
import type { RepoStep } from "./step.ts"

/** Who proposed changes' messages name: the host's trailers (`proposedMessage`). */
interface ProposedChangesAt {
  readonly lane: ThreadId
  readonly name: ThreadName
  /** The lane's tip entry, for `Pinetrie-Entry`. */
  readonly entry: string
}

/** What a build needs besides: the WIP line, and a fresh nonce its commits are named by (`nonceRevset`). */
export interface BuildAt extends ProposedChangesAt {
  /** The WIP line proposed changes carry until an agent describes it (`unfinishedDescription`). */
  readonly unfinished: string
  /** `pinetrie-proposed-<uuid>`, fresh for each build: the host makes it. */
  readonly nonce: string
}

/** What a decision runs on your repo, and what the host does after. */
export interface ProposedChangesEffects {
  readonly steps: readonly RepoStep[]
  readonly after:
    | { readonly kind: "nothing" }
    /** Write the record from the proposed changes at the place's target: read again only when steps ran. */
    | { readonly kind: "record"; readonly place: Placed }
    /** Your edit and the host's crossed: repair each change (`repairProposedChanges`), then record. */
    | {
        readonly kind: "repair"
        readonly place: Placed
        readonly changeIds: readonly string[]
      }
    | { readonly kind: "remove" }
    /** An acceptance: write the record marked accepted. */
    | { readonly kind: "accepted"; readonly record: ProposedChangesRecord }
  /** The proposed changes' content changed: it is described once the lane stops. */
  readonly built: boolean
}

const NOTHING: ProposedChangesEffects = {
  steps: [],
  after: { kind: "nothing" },
  built: false,
}

/** Each source's message with the host's trailers and the ledger of the place it is built at. */
const sourcesAt = (
  rebuild: Rebuild,
  at: Omit<ProposedChangesAt, "name">,
): readonly ProposedSource[] =>
  rebuild.sources.map(source => ({
    ...source,
    description: proposedMessage(source.description, {
      lane: at.lane,
      entry: at.entry,
      name: rebuild.name,
      ledger: { source: rebuild.place.tip, start: rebuild.place.start },
    }),
  }))

/**
 * Proposed changes built anew: its old revisions abandoned (none for a build),
 * then a commit per source on its start, rebased onto its target
 * (`planProposedChanges`), marked, then its record.
 */
export function rebuildEffects(
  rebuild: Rebuild,
  at: Omit<ProposedChangesAt, "name"> & { readonly nonce: string },
): ProposedChangesEffects {
  const { place } = rebuild
  return {
    steps: [
      ...planAbandonProposed(rebuild.changeIds),
      ...planProposedChanges({
        name: rebuild.name,
        start: place.start,
        sources: sourcesAt(rebuild, at),
        target: place.target,
        nonce: at.nonce,
      }),
      ...markSteps(proposedBookmark(rebuild.name)),
    ],
    after: { kind: "record", place },
    built: true,
  }
}

/** The refresh decisions that write commit messages, from the lane's root: the only ones that read it. */
export type BuildDecision = Extract<
  RefreshDecision,
  { readonly kind: "build" | "rebuild" }
>

export const isBuild = (decision: RefreshDecision): decision is BuildDecision =>
  decision.kind === "build" || decision.kind === "rebuild"

/** What a build or a rebuild runs, its messages from `at`, and what the host writes after. */
export function buildEffects(
  decision: BuildDecision,
  at: BuildAt,
): ProposedChangesEffects {
  switch (decision.kind) {
    case "build":
      return rebuildEffects(
        {
          name: at.name,
          place: decision.place,
          changeIds: [],
          sources: [{ commit: decision.place.tip, description: at.unfinished }],
        },
        at,
      )
    case "rebuild": {
      // It holds more now: a work in progress again, its ledger the new tip
      // and start.
      const { place, proposed } = decision
      const [bottom] = revisionChangeIds(proposed)
      if (bottom === undefined) return NOTHING
      return {
        steps: [
          ...planRebuildProposed({
            changeId: bottom,
            start: place.start,
            tip: place.tip,
            target: place.target,
            description: proposedMessage(at.unfinished, {
              ...at,
              ledger: { source: place.tip, start: place.start },
            }),
          }),
          ...markSteps(proposed.bookmark),
        ],
        after: { kind: "record", place },
        built: true,
      }
    }
  }
}

/**
 * What every other refresh decision runs, and what the host writes after:
 * none writes a message, so none takes the lane's tip or WIP line.
 */
export function proposedChangesEffects(
  decision: Exclude<RefreshDecision, BuildDecision>,
  name: ThreadName,
): ProposedChangesEffects {
  switch (decision.kind) {
    case "untouched":
      return NOTHING
    case "forget":
      return {
        steps: decision.hostLeft ? forgetSteps(proposedBookmark(name)) : [],
        after: { kind: "remove" },
        built: false,
      }
    case "withdraw": {
      const changeIds = revisionChangeIds(decision.proposed)
      return changeIds.length === 0
        ? NOTHING
        : {
            steps: [
              ...planAbandonProposed(changeIds),
              ...forgetSteps(proposedBookmark(name)),
            ],
            after: { kind: "remove" },
            built: false,
          }
    }
    case "refresh": {
      const [bottom] = revisionChangeIds(decision.proposed)
      if (bottom === undefined) return NOTHING
      return {
        steps: [
          ...planRefreshProposed(bottom, decision.place.target),
          ...markSteps(decision.proposed.bookmark),
        ],
        after: { kind: "record", place: decision.place },
        built: false,
      }
    }
    case "mark":
      return {
        steps: markSteps(proposedBookmark(name)),
        after: { kind: "record", place: decision.place },
        built: false,
      }
    case "none":
    case "stale":
    case "leave":
      return {
        steps: [],
        after: { kind: "record", place: decision.place },
        built: false,
      }
    case "repair":
      return {
        steps: [],
        after: {
          kind: "repair",
          place: decision.place,
          changeIds: decision.changeIds,
        },
        built: false,
      }
  }
}

/** An acceptance: the destination moved forward to the proposed changes' top, the proposed changes' bookmark and its host version forgotten, then its record marked accepted. */
export const acceptanceEffects = (
  decision: Extract<AcceptanceDecision, { readonly kind: "accept" }>,
): ProposedChangesEffects => ({
  steps: planAcceptanceSteps({
    bookmark: decision.bookmark,
    top: decision.top,
    destination: decision.destination,
  }),
  after: { kind: "accepted", record: decision.accepted },
  built: false,
})

/** An agent's commit message on the proposed changes' one revision, with the host's trailers and its ledger, then its record. */
export const describeEffects = (
  decision: DescribeDecision,
  text: string,
  at: ProposedChangesAt,
): ProposedChangesEffects => ({
  steps: [
    ...planDescribe(
      decision.changeId,
      proposedMessage(text, { ...at, ledger: decision.ledger }),
    ),
    ...markSteps(proposedBookmark(decision.name)),
  ],
  after: { kind: "record", place: decision.place },
  built: false,
})
