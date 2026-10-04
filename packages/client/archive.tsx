// client/archive — the Archive tab: every root, open or archived, to find,
// preview and restore (ADR-0029). Its body is a list, since it is for finding
// a root; the selected root is previewed read-only beside it. Its list shows
// the session's message count.

import { type EntryId, idTime, type WriterId } from "@pineta/core"
import { type ReactNode, useState } from "react"
import {
  ARCHIVE_FILTERS,
  type ArchiveFilter,
  type ArchiveRow,
} from "./archive-rows.ts"
import { CardPip } from "./card-pip.tsx"
import { ago, plural } from "./counts.ts"
import { nameFor } from "./presence.tsx"
import {
  type MessageCount,
  messageCountTitle,
  messageCountWords,
} from "./root-label.ts"

export function ArchiveTab({
  rows,
  filter,
  onFilter,
  query,
  onQuery,
  selected,
  onSelect,
  labelOf,
  nameOf,
  myColor,
  preview,
  count,
}: {
  /** `archiveIndex` over the filter and query below. */
  rows: readonly ArchiveRow[]
  filter: ArchiveFilter
  onFilter: (filter: ArchiveFilter) => void
  query: string
  onQuery: (query: string) => void
  selected: EntryId | null
  onSelect: (root: EntryId) => void
  labelOf: (root: EntryId) => string
  nameOf: ReadonlyMap<WriterId, string>
  /** Your colour, for the pip on a row holding a card of yours. */
  myColor: string
  /** The selected root, read-only: its rail and one column. */
  preview: (root: EntryId) => ReactNode
  count: MessageCount
}) {
  const [now] = useState(() => Date.now())
  return (
    <section className="archive" aria-label="every thread">
      <div className="archive-list">
        <div className="archive-controls">
          <input
            aria-label="search threads"
            className="archive-search"
            onChange={e => onQuery(e.target.value)}
            placeholder="search"
            value={query}
          />
          <div className="archive-filters">
            {ARCHIVE_FILTERS.map(f => (
              <button
                aria-pressed={filter === f}
                className="archive-filter"
                data-filter={f}
                key={f}
                onClick={() => onFilter(f)}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>
          <p className="archive-count" title={messageCountTitle(count)}>
            {messageCountWords(count)}
          </p>
        </div>
        {rows.length === 0 && (
          <p className="archive-empty">
            {filter === "all" && query === ""
              ? "Nothing here yet. Start with ＋."
              : "No thread matches."}
          </p>
        )}
        <ul className="archive-rows">
          {rows.map(row => {
            const { root } = row.summary
            const state = row.record?.state === "archived" ? "archived" : "open"
            const time = idTime(row.summary.newest)
            return (
              <li key={root}>
                <button
                  aria-current={selected === root}
                  className="archive-row"
                  data-root={root}
                  data-state={state}
                  onClick={() => onSelect(root)}
                  type="button"
                >
                  <span className="archive-label">{labelOf(root)}</span>
                  <span className="archive-meta">
                    {state}
                    {time === null ? "" : ` · ${ago(time, now)}`} ·{" "}
                    {row.summary.writers
                      .map(w => nameFor(nameOf, w))
                      .join(", ")}{" "}
                    · {plural(row.summary.messages, "message")}
                  </span>
                  {row.card && <CardPip color={myColor} />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="archive-preview">
        {selected === null ? (
          <p className="archive-hint">Choose a thread to see it here.</p>
        ) : (
          preview(selected)
        )}
      </div>
    </section>
  )
}
