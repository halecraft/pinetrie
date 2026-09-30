// client/review-pane — a column's review of its offer (ADR-0047): a file
// list beside one scroll of every file's diff, each file's head pinned while
// its diff is in view. `review.ts` decides what it shows; `useFetched` reads.

import type { RevisionReview } from "@pineta/core"
import { decodeRevisionReview, diffUrl, reviewUrl } from "@pineta/marginalia"
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ReviewTarget } from "./column-view.ts"
import {
  DIFF_LINES_SHOWN,
  diffLines,
  type FileRow,
  reviewView,
  sectionState,
} from "./review.ts"
import { sameProps } from "./same-props.ts"
import { useFetched } from "./use-fetched.ts"
import { useStable } from "./use-stable.ts"

const readReview = async (response: Response): Promise<RevisionReview> => {
  const review = decodeRevisionReview(await response.json())
  if (review === undefined) throw new Error("not a review")
  return review
}
const readText = (response: Response): Promise<string> => response.text()

/** How far below the view a section starts loading. */
const AHEAD = "1000px 0px"

/** Subscribe `el` to coming near the view; returns the unsubscribe. */
type Watch = (el: Element, near: () => void) => () => void

export interface ReviewPaneProps {
  /** The review's element id, which the strip's line controls. */
  id: string
  target: ReviewTarget
  /** The strip's line: "a stack of 3 · 5 files ready", and the rest. */
  line: string
  onClose: () => void
}

/**
 * `target` and `line` are rebuilt by `columnView` on every render of the
 * column, which redraws on every presence change (S54); `onClose` is stable.
 */
const REVIEW_PANE_PROPS = {
  id: "identity",
  target: "value",
  line: "value",
  onClose: "identity",
} as const

function ReviewPaneView(p: ReviewPaneProps) {
  const revisions = useFetched(p.target.commits.map(reviewUrl), readReview)
  const view = reviewView(p.target, revisions)
  const pane = useRef<HTMLElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const diffs = useRef<HTMLDivElement>(null)

  // Opening brings the review into view: the strip may have to scroll right.
  useLayoutEffect(() => {
    pane.current?.scrollIntoView({ inline: "nearest", block: "nearest" })
    head.current?.focus({ preventScroll: true })
  }, [])

  // One observer for every section, rooted at the diffs' scroll.
  const observer = useRef<IntersectionObserver | null>(null)
  const nearBy = useRef(new Map<Element, () => void>())
  const watch = useStable<Parameters<Watch>, ReturnType<Watch>>((el, near) => {
    if (observer.current === null)
      observer.current = new IntersectionObserver(
        entries => {
          for (const e of entries)
            if (e.isIntersecting) nearBy.current.get(e.target)?.()
        },
        { root: diffs.current, rootMargin: AHEAD },
      )
    const seen = observer.current
    nearBy.current.set(el, near)
    seen.observe(el)
    return () => {
      nearBy.current.delete(el)
      seen.unobserve(el)
    }
  })
  useEffect(() => () => observer.current?.disconnect(), [])

  // The section whose head is pinned: the last to have reached the top.
  const [current, setCurrent] = useState<string | null>(null)
  const onScroll = () => {
    const box = diffs.current
    if (box === null) return
    const top = box.getBoundingClientRect().top + 1
    let at: string | null = null
    for (const s of box.querySelectorAll<HTMLElement>(".review-file"))
      if (s.getBoundingClientRect().top <= top) at = s.dataset.key ?? null
    setCurrent(at)
  }
  const jump = (key: string) => {
    for (const s of diffs.current?.querySelectorAll<HTMLElement>(
      ".review-file",
    ) ?? [])
      if (s.dataset.key === key) s.scrollIntoView({ block: "start" })
  }

  const single = view.revisions.length === 1 ? view.revisions[0] : undefined
  const title =
    single?.state.kind === "ready" ? single.state.value.title : undefined
  return (
    <section
      aria-label="review of this thread's offer"
      className="review"
      id={p.id}
      onKeyDown={e => {
        if (e.key === "Escape") p.onClose()
      }}
      ref={pane}
    >
      <div className="review-head" ref={head} tabIndex={-1}>
        <span className="review-line">{p.line}</span>
        {title !== undefined && <span className="review-title">{title}</span>}
        <button
          aria-label="close the review"
          className="review-close"
          onClick={p.onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="review-body">
        <nav aria-label="files" className="review-list">
          {view.revisions.map(r => (
            <div className="review-list-revision" key={r.commit}>
              {r.state.kind !== "ready" ? (
                <div className="review-note">
                  {r.state.kind === "loading" ? "…" : r.state.reason}
                </div>
              ) : (
                <>
                  {single === undefined && (
                    <div className="review-list-title">
                      {r.state.value.title}
                    </div>
                  )}
                  {r.state.value.files.map(f => (
                    <button
                      aria-current={current === f.key ? "location" : undefined}
                      className="review-list-file"
                      data-conflicts={f.conflicts || undefined}
                      data-yours={f.yours || undefined}
                      key={f.key}
                      onClick={() => jump(f.key)}
                      title={f.shown}
                      type="button"
                    >
                      <span className="review-letter">{f.letter}</span>{" "}
                      <span className="review-path">{f.shown}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          ))}
        </nav>
        <div className="review-diffs" onScroll={onScroll} ref={diffs}>
          {view.revisions.map(r => (
            <div className="review-revision" key={r.commit}>
              {r.state.kind !== "ready" ? (
                <div className="review-note">
                  {r.state.kind === "loading"
                    ? "reading this revision…"
                    : `could not read this revision: ${r.state.reason}`}
                </div>
              ) : (
                <>
                  <div className="review-description">
                    <div className="review-revision-title">
                      {r.state.value.title}
                    </div>
                    {r.state.value.body !== "" && (
                      <div className="review-revision-body">
                        {r.state.value.body}
                      </div>
                    )}
                  </div>
                  {r.state.value.files.map(f => (
                    <ReviewFile key={f.key} row={f} watch={watch} />
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export const ReviewPane = memo(
  ReviewPaneView,
  sameProps<ReviewPaneProps>(REVIEW_PANE_PROPS),
)

interface ReviewFileProps {
  row: FileRow
  watch: Watch
}

/** A section holds up to `DIFF_LINES_SHOWN` lines: it redraws only when its row changes. */
const REVIEW_FILE_PROPS = { row: "value", watch: "identity" } as const

function ReviewFileView({ row, watch }: ReviewFileProps) {
  const [toggled, setToggled] = useState(false)
  // Once near the view, always: its URL stays fetched, and cached.
  const [wanted, setWanted] = useState(false)
  const self = useRef<HTMLElement>(null)
  useEffect(() => {
    if (wanted || self.current === null) return
    return watch(self.current, () => setWanted(true))
  }, [wanted, watch])
  const open = row.startsCollapsed === toggled
  const [diff] = useFetched(
    open && wanted ? [diffUrl(row.commit, row.path)] : [],
    readText,
  )
  const state = sectionState(row, toggled, wanted, diff ?? null)
  const lines = diff?.kind === "ready" ? diffLines(diff.value) : []
  return (
    <section
      className="review-file"
      data-conflicts={row.conflicts || undefined}
      data-key={row.key}
      data-letter={row.letter}
      data-state={state}
      data-yours={row.yours || undefined}
      ref={self}
    >
      <div className="review-file-head">
        <button
          aria-expanded={open}
          className="review-toggle"
          onClick={() => setToggled(t => !t)}
          type="button"
        >
          {open ? "▾" : "▸"}
        </button>
        <span className="review-letter">{row.letter}</span>
        <span className="review-path">{row.shown}</span>
        {row.lines !== "" && <span className="review-lines">{row.lines}</span>}
        {row.conflicts && <span className="review-flag">conflicts</span>}
        {row.yours && <span className="review-flag">you're editing</span>}
      </div>
      {state === "collapsed" ? (
        row.startsCollapsed && (
          <button
            className="review-show"
            onClick={() => setToggled(t => !t)}
            type="button"
          >
            show {row.changed} changed lines
          </button>
        )
      ) : state === "waiting" || state === "loading" ? (
        <div
          className="review-placeholder"
          style={{ height: `calc(${row.estimate} * var(--diff-line))` }}
        />
      ) : state === "too-large" ? (
        <div className="review-note">too large to show here · see it in jj</div>
      ) : state === "failed" ? (
        <div className="review-note">
          could not read this diff
          {diff?.kind === "failed" && diff.reason !== ""
            ? `: ${diff.reason}`
            : ""}
        </div>
      ) : (
        <pre className="review-diff">
          {lines.slice(0, DIFF_LINES_SHOWN).map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a diff's lines are only ever replaced whole
            <span data-kind={l.kind} key={i}>
              {l.text === "" ? " " : l.text}
            </span>
          ))}
          {lines.length > DIFF_LINES_SHOWN && (
            <span data-kind="meta">
              {lines.length - DIFF_LINES_SHOWN} more lines · see it in jj
            </span>
          )}
        </pre>
      )}
    </section>
  )
}

const ReviewFile = memo(
  ReviewFileView,
  sameProps<ReviewFileProps>(REVIEW_FILE_PROPS),
)
