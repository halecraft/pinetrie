// web/match-list — a column's matches while a search applies, laid over its
// thread: `columnMatches`' rows, drawn as they come. A row shows its message
// with `open-at`, whose plan leaves the search (`leavingSearch`,
// `packages/interface/intent.ts`).

import type { EntryId } from "@pinetrie/core"
import type { ColumnMatches } from "@pinetrie/interface"
import { memo } from "react"
import { Button } from "./button.tsx"

function MatchListView({
  matches,
  onOpen,
}: {
  matches: ColumnMatches
  onOpen: (entry: EntryId) => void
}) {
  return (
    <div className="match-list">
      {matches.none !== null && <p className="match-none">{matches.none}</p>}
      {matches.rows.map((row, n) =>
        row.kind === "gap" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a gap is only its place between matches
          <div className="match-gap" key={`gap-${n}`}>
            {row.words}
          </div>
        ) : (
          <Button
            look="outline"
            className="match-row"
            data-entry={row.id}
            key={row.id}
            onClick={() => onOpen(row.id)}
            title={
              row.at === null ? undefined : new Date(row.at).toLocaleString()
            }
          >
            <span className="match-head">
              <span className="match-who">{row.who}</span>
              {row.when !== null && (
                <span className="match-when">{row.when}</span>
              )}
            </span>
            {row.ask !== null && <span className="match-ask">{row.ask}</span>}
            <span className="match-text">
              {row.snippet.map((part, i) =>
                part.match ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a snippet's parts never move
                  <mark key={i}>{part.text}</mark>
                ) : (
                  part.text
                ),
              )}
            </span>
          </Button>
        ),
      )}
    </div>
  )
}

/** Redrawn only when its matches change, which `App` builds in a memo. */
export const MatchList = memo(MatchListView)
