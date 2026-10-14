// jj/lane/fetch-plan — which of a lane's commits your repo may already have,
// after a move that needs the lane fetched into it.

import type { CommitId } from "@pinetrie/core"
import type { Merged, TurnCommitted } from "@pinetrie/lanes"

/** A move of the lane's bookmark: a turn's revision, or a merge's result. */
export type LaneMove =
  | {
      readonly kind: "turn"
      readonly made: TurnCommitted
      /** The lane's bookmark before the turn. */
      readonly before: CommitId | null
    }
  | { readonly kind: "merge"; readonly merged: Merged }

/**
 * The fetch a move needs: the commits a bundle may leave out when your repo
 * has them, or null for none. A turn that committed: the bookmark before it.
 * A clean merge: the lane before it and what it merged. Nothing merged: the
 * lane, when a mark naming accepted work was made. A conflicted merge
 * fetches nothing: the resolution's turns fetch the lane as they commit.
 */
export function planFetch(move: LaneMove): readonly (CommitId | null)[] | null {
  if (move.kind === "turn")
    return move.made.commit === null ? null : [move.before]
  const { merged } = move
  switch (merged.kind) {
    case "nothing":
      return merged.mark === null ? null : [merged.ours]
    case "clean":
      return [merged.ours, merged.from]
    case "conflicted":
      return null
  }
}
