// interface/conflicts-view — a folder lane's open conflicts as its pane
// shows them: per path, what each side changed from the version both began
// from (each a review's row for that path), and the three versions to
// choose. Worded here, in `conflictChoiceWords`.

import {
  type ConflictChoice,
  type ConflictRecord,
  type DiffSpan,
  type PointId,
  type StateRecord,
  stateLane,
  type ThreadId,
} from "@pinetrie/core"

/** One side of a conflict: what it changed from the base, as a review's span. */
interface ConflictSide {
  readonly side: "ours" | "theirs"
  readonly label: string
  readonly span: DiffSpan
}

/** A conflicted path, its two sides, and its three choices. */
export interface ConflictShown {
  readonly path: string
  readonly sides: readonly [ConflictSide, ConflictSide]
  readonly choices: readonly {
    readonly choose: ConflictChoice
    readonly label: string
  }[]
}

/** What a choice of a conflict's version says: `theirs` names the thread it came from, or accepted work. */
function conflictChoiceWords(
  choose: ConflictChoice,
  theirsFrom: string | null,
): string {
  switch (choose) {
    case "ours":
      return "keep this thread's"
    case "theirs":
      return theirsFrom === null
        ? "take accepted work's"
        : `take ${theirsFrom}'s`
    case "base":
      return "take the version both began from"
  }
}

/** The pane's own words. */
export const conflictsWords = {
  title: "choose versions",
  none: "no conflict of this thread's own is open: get the latest to find what conflicts",
  ours: "this thread's changes",
  theirs: (from: string | null) =>
    from === null ? "accepted work's changes" : `${from}'s changes`,
} as const

const CHOICES: readonly ConflictChoice[] = ["ours", "theirs", "base"]

/** `lane`'s open conflicts, sorted by path, as its pane shows them. */
export function conflictsView(input: {
  readonly lane: ThreadId
  readonly conflicts: readonly ConflictRecord[]
  readonly states: ReadonlyMap<PointId, StateRecord>
  readonly laneName: (lane: ThreadId) => string
}): readonly ConflictShown[] {
  return input.conflicts
    .filter(c => c.lane === input.lane)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(c => {
      const theirs = input.states.get(c.theirs)
      const from = theirs === undefined ? null : stateLane(theirs)
      const theirsFrom = from === null ? null : input.laneName(from)
      const span = (to: PointId): DiffSpan => ({
        kind: "range",
        from: c.base,
        to,
      })
      return {
        path: c.path,
        sides: [
          { side: "ours", label: conflictsWords.ours, span: span(c.ours) },
          {
            side: "theirs",
            label: conflictsWords.theirs(theirsFrom),
            span: span(c.theirs),
          },
        ],
        choices: CHOICES.map(choose => ({
          choose,
          label: conflictChoiceWords(choose, theirsFrom),
        })),
      }
    })
}
