// web/review-pane — a review in a column's pane: of its proposed changes, or of
// what an ask changed. A file list, when there is more than one file, beside
// one scroll of every file's diff, each file's head pinned while its diff is in
// view. `review.ts` decides what it shows; `useFetched` reads. The pane's frame
// (`pane.tsx`) gives it its width, Escape and focus.

import type { RevisionReview } from "@pinetrie/core"
import {
  DIFF_LINES_SHOWN,
  diffLines,
  type FileRow,
  MOVED_UNCHANGED,
  type ReviewPref,
  type ReviewTarget,
  reviewPrefWords,
  reviewView,
  revisionReadWords,
  sectionState,
} from "@pinetrie/interface"
import { decodeRevisionReview, diffUrl, reviewUrl } from "@pinetrie/rules"
import { memo, useContext, useEffect, useRef, useState } from "react"
import { Button, IconButton } from "./button.tsx"
import { PaneHead } from "./pane-head.tsx"
import { ReviewMedia } from "./review-media.tsx"
import { ReviewPrefsContext } from "./review-prefs.ts"
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
  target: ReviewTarget
  /** The strip's line, "a stack of 3 · 5 files ready", or an ask's. */
  line: string
  /** Over a narrow screen, its close control goes back to the thread. */
  narrow: boolean
  close: () => void
}

/**
 * `target` and `line` are rebuilt on every render of the column
 * (`columnView`, `paneView`); `close` is stable.
 */
const REVIEW_PANE_PROPS = {
  target: "value",
  line: "value",
  narrow: "value",
  close: "identity",
} as const

function ReviewPaneView(p: ReviewPaneProps) {
  const revisions = useFetched(
    p.target.spans.map(s => reviewUrl(s)),
    readReview,
  )
  const view = reviewView(p.target, revisions)
  const diffs = useRef<HTMLDivElement>(null)

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

  const { prefs, setPrefs } = useContext(ReviewPrefsContext)
  const toggle = (pref: ReviewPref) => {
    const words = reviewPrefWords(pref, prefs[pref])
    return (
      <IconButton
        label={words.label}
        aria-pressed={prefs[pref]}
        className="review-pref"
        data-pref={pref}
        key={pref}
        onClick={() => setPrefs({ ...prefs, [pref]: !prefs[pref] })}
        title={words.label}
      >
        {words.glyph}
      </IconButton>
    )
  }

  return (
    <div
      className="review"
      data-list-folded={prefs.listFolded || undefined}
      data-wrap={prefs.wrap || undefined}
    >
      <PaneHead
        close={p.close}
        extra={
          <>
            {toggle("wrap")}
            {view.listed && toggle("listFolded")}
          </>
        }
        line={p.line}
        narrow={p.narrow}
        title={view.title}
      />
      <div className="review-body">
        {view.listed && (
          <nav aria-label="files" className="review-list">
            {view.revisions.map(r => (
              <div className="review-list-revision" key={r.key}>
                {r.state.kind !== "ready" ? (
                  <div className="review-note">
                    {r.state.kind === "loading" ? "…" : r.state.reason}
                  </div>
                ) : (
                  <>
                    {view.title === undefined && (
                      <div className="review-list-title">
                        {r.state.value.title}
                      </div>
                    )}
                    {r.state.value.files.map(f => (
                      <Button
                        look="plain"
                        aria-current={
                          current === f.key ? "location" : undefined
                        }
                        className="review-list-file"
                        data-conflicts={f.conflicts || undefined}
                        data-editing={f.editing || undefined}
                        key={f.key}
                        onClick={() => jump(f.key)}
                        title={f.shown}
                      >
                        <span className="review-letter">{f.letter}</span>{" "}
                        <span className="review-path">{f.shown}</span>
                      </Button>
                    ))}
                  </>
                )}
              </div>
            ))}
          </nav>
        )}
        <div className="review-diffs" onScroll={onScroll} ref={diffs}>
          {view.revisions.map(r => (
            <div className="review-revision" key={r.key}>
              {r.state.kind !== "ready" ? (
                <div className="review-note">
                  {revisionReadWords(
                    r.state.kind === "loading" ? null : r.state.reason,
                  )}
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
                    {r.state.value.widens !== "" && (
                      <div className="review-widens">
                        {r.state.value.widens}
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
    </div>
  )
}

export { readReview }

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
  // A media row or a move draws no diff, so none is fetched.
  const lined = row.media === null && !row.moved
  const [diff] = useFetched(
    open && wanted && lined ? [diffUrl(row.span, row.path)] : [],
    readText,
  )
  const state = sectionState(row.startsCollapsed, toggled, wanted, diff ?? null)
  const lines = diff?.kind === "ready" ? diffLines(diff.value) : []
  return (
    <section
      className="review-file"
      data-conflicts={row.conflicts || undefined}
      data-key={row.key}
      data-letter={row.letter}
      data-media={row.media?.kind}
      data-state={row.media !== null || row.moved ? "shown" : state}
      data-editing={row.editing || undefined}
      ref={self}
    >
      <div className="review-file-head">
        <Button
          look="plain"
          aria-expanded={open}
          className="review-toggle"
          onClick={() => setToggled(t => !t)}
        >
          {open ? "▾" : "▸"}
        </Button>
        <span className="review-letter">{row.letter}</span>
        <span className="review-path">{row.shown}</span>
        {row.lines !== "" && <span className="review-lines">{row.lines}</span>}
        {row.conflicts && <span className="review-flag">conflicts</span>}
        {row.editing && <span className="review-flag">you're editing</span>}
      </div>
      {row.media !== null ? (
        open && <ReviewMedia media={row.media} />
      ) : row.moved ? (
        <div className="review-note">{MOVED_UNCHANGED}</div>
      ) : state === "collapsed" ? (
        row.startsCollapsed && (
          <Button
            look="outline"
            className="review-show"
            onClick={() => setToggled(t => !t)}
          >
            show {row.changed} changed lines
          </Button>
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

export const ReviewFile = memo(
  ReviewFileView,
  sameProps<ReviewFileProps>(REVIEW_FILE_PROPS),
)

/** A watch for a section drawn on its own, outside a review's scroll: near the view at once. */
export const SHOWN_NOW: Watch = (_el, near) => {
  near()
  return () => {}
}
