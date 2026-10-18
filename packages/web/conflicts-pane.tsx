// web/conflicts-pane — a folder lane's open conflicts in its pane, as
// `conflictsView` decided: per path, each side's changes from the version both
// began from, drawn as a review's section for that path (`ReviewFile`), and
// the three versions to choose. A choice is a command the session tracks;
// its refusal, while the thread runs, is said here.

import type { ConflictChoice, ThreadId } from "@pinetrie/core"
import {
  type ConflictShown,
  conflictsWords,
  reviewView,
} from "@pinetrie/interface"
import { reviewUrl } from "@pinetrie/rules"
import { PaneHead } from "./pane-head.tsx"
import { ReviewFile, readReview, SHOWN_NOW } from "./review-pane.tsx"
import { useFetched } from "./use-fetched.ts"

/** One side's section for `path`: the review's row for it, or its move's row that names it. */
function Side({
  side,
  path,
}: {
  side: ConflictShown["sides"][number]
  path: string
}) {
  const target = { spans: [side.span], conflicts: [], workingCopyEdits: [] }
  const view = reviewView(
    target,
    useFetched([reviewUrl(side.span)], readReview),
  )
  const state = view.revisions[0]?.state
  const row =
    state?.kind === "ready"
      ? state.value.files.find(
          f => f.path === path || f.shown.includes(`${path} =>`),
        )
      : undefined
  return (
    <div className="conflict-side" data-side={side.side}>
      <div className="conflict-side-label">{side.label}</div>
      {row === undefined ? (
        <div className="review-note">
          {state?.kind === "failed" ? state.reason : "…"}
        </div>
      ) : (
        <ReviewFile row={row} watch={SHOWN_NOW} />
      )}
    </div>
  )
}

export function ConflictsPane({
  lane,
  conflicts,
  choose,
  said,
  close,
  narrow,
}: {
  lane: ThreadId
  conflicts: readonly ConflictShown[]
  choose: (lane: ThreadId, path: string, choose: ConflictChoice) => void
  /** Your last choice's refusal or failure, worded; null for none. */
  said: string | null
  close: () => void
  narrow: boolean
}) {
  return (
    <div className="conflicts review">
      <PaneHead
        close={close}
        line=""
        narrow={narrow}
        title={conflictsWords.title}
      />
      <div className="conflicts-body">
        {said !== null && (
          <p className="conflicts-said" role="status">
            {said}
          </p>
        )}
        {conflicts.length === 0 && (
          <p className="review-note">{conflictsWords.none}</p>
        )}
        {conflicts.map(c => (
          <section className="conflict" data-path={c.path} key={c.path}>
            <h3 className="conflict-path">{c.path}</h3>
            {c.sides.map(s => (
              <Side key={s.side} path={c.path} side={s} />
            ))}
            <div className="conflict-choices">
              {c.choices.map(x => (
                <button
                  className="conflict-choice"
                  data-choose={x.choose}
                  key={x.choose}
                  onClick={() => choose(lane, c.path, x.choose)}
                  type="button"
                >
                  {x.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
