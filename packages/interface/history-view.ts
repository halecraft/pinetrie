// interface/history-view — a folder project's history page, decided as a
// value: accepted work's line from its newest (`lineStates`), each entry
// kept with who made it, when and how, the review of what it changed
// (`readableSpan`, the host's own rule, so a review shows exactly where the
// host answers one), its concurrent saves, and a restore of it; then how
// many states are no longer kept. Worded here, in `madeWords`.

import {
  type DiffSpan,
  lineStates,
  type PointId,
  type RestorePreview,
  type StateMade,
  type StateRecord,
  type ThreadId,
  type WriterId,
} from "@pinetrie/core"
import {
  type FolderAcceptedRecord,
  type ReviewFacts,
  readableSpan,
} from "@pinetrie/rules"
import type { RestoreActing } from "@pinetrie/session"
import { count, whenWords } from "./counts.ts"
import { actingSaid } from "./outcome-words.ts"

/** One state of accepted work as the history shows it. */
export interface HistoryEntry {
  readonly id: PointId
  readonly made: StateMade
  /** What it was, worded (`madeWords`). */
  readonly words: string
  /** Who made it, by name; null for the host's own read. */
  readonly who: string | null
  readonly when: string
  /** What it changed, from its first parent: null where the host would refuse one. */
  readonly review: DiffSpan | null
  /** A restore of it, from accepted work's newest; null for the newest, which the folder holds. */
  readonly restore: RestorePreview | null
  /** The concurrent saves made on it, newest first. */
  readonly saves: readonly HistoryEntry[]
}

export interface HistoryView {
  /** Accepted work's kept line states, newest first. */
  readonly entries: readonly HistoryEntry[]
  /** How many of its line's states are no longer kept, worded; "" for none. */
  readonly notKept: string
}

/** A state's way of being made, as the history says it. */
export function madeWords(
  made: StateMade,
  laneName: (lane: ThreadId) => string,
  states: ReadonlyMap<PointId, StateRecord>,
): string {
  switch (made.kind) {
    case "read":
      return "saved in the project's folder"
    case "accept":
      return `accepted ${laneName(made.lane)}'s changes`
    case "restore": {
      const of = states.get(made.of)
      return of === undefined
        ? "restored an earlier version"
        : `restored the version of ${whenWords(of.at)}`
    }
    case "concurrent":
      return "written through a file held open across an accept"
    // A lane's own states are never on accepted work's line.
    case "start":
    case "turn":
    case "catch-up":
    case "resolve":
    case "bases-merged":
      return "a thread's own state"
  }
}

/** What the history page draws, from the session's states and accepted work's record. */
export function historyView(input: {
  readonly states: ReadonlyMap<PointId, StateRecord>
  readonly accepted: FolderAcceptedRecord | null
  readonly personName: (writer: WriterId) => string
  readonly laneName: (lane: ThreadId) => string
}): HistoryView {
  const { states, accepted } = input
  if (accepted === null) return { entries: [], notKept: "" }
  const facts: ReviewFacts = {
    proposedByLane: new Map(),
    revisions: new Map(),
    accepted,
    conflicts: [],
  }
  const kept = new Set(accepted.kept)
  const entry = (r: StateRecord): HistoryEntry => {
    const [first] = r.parents
    const span = first === undefined ? null : readableSpan(facts, first, r.id)
    return {
      id: r.id,
      made: r.made,
      words: madeWords(r.made, input.laneName, states),
      who: r.by === null ? null : input.personName(r.by),
      when: whenWords(r.at),
      review:
        span === null ? null : { kind: "range", from: span.from, to: span.to },
      restore:
        r.id === accepted.newest ? null : { of: r.id, from: accepted.newest },
      saves: [],
    }
  }
  const line = lineStates(states, accepted.newest)
  const saves = [...states.values()].filter(
    r => r.made.kind === "concurrent" && kept.has(r.id),
  )
  const entries = line
    .filter(r => kept.has(r.id))
    .map(r => ({
      ...entry(r),
      saves: saves
        .filter(s => s.parents[0] === r.id)
        .sort((a, b) => b.at - a.at)
        .map(entry),
    }))
  const gone = line.length - entries.length
  return {
    entries,
    notKept:
      gone === 0
        ? ""
        : `${count(gone, "older version is", "older versions are")} no longer kept`,
  }
}

/** The history page's own words, beside each entry's (`madeWords`). */
export const restoreWords = {
  offer: "restore this version",
  confirm: "restore",
  cancel: "cancel",
  held: "the project's folder already holds this version",
  preview: (when: string) =>
    `restoring writes the version of ${when} into the project's folder: these are its changes from what the folder holds now`,
  review: "what it changed",
  empty: "no states yet: the project's folder has not been read",
} as const

/** Your restore as the history says it: out now, or what it was refused or failed with. */
export const restoreStatus = (
  acting: RestoreActing | null,
): { readonly waiting: boolean; readonly said: string | null } => ({
  waiting: acting?.kind === "sent",
  said: actingSaid(acting),
})
