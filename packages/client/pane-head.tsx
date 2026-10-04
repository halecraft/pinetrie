// client/pane-head — the head of a column's pane (ADR-0078), whatever it
// shows: a line, a title, anything else the subject offers, and the close
// control, which over a narrow screen goes back to the thread.

import { type ReactNode, useLayoutEffect, useRef } from "react"
import { paneCloseWords } from "./pane.ts"

export function PaneHead({
  line,
  title,
  extra,
  narrow,
  close,
}: {
  /** What the subject is: an offer's line, an ask's. */
  line?: string | undefined
  title?: string | undefined
  extra?: ReactNode
  narrow: boolean
  close: () => void
}) {
  // Opening moves focus into the pane, where Escape closes it.
  const head = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    head.current?.focus({ preventScroll: true })
  }, [])
  const words = paneCloseWords(narrow)
  return (
    <div className="pane-head" ref={head} tabIndex={-1}>
      {line !== undefined && <span className="pane-line">{line}</span>}
      {title !== undefined && <span className="pane-title">{title}</span>}
      {extra}
      <button
        aria-label={words.label}
        className="pane-close"
        onClick={close}
        title={words.label}
        type="button"
      >
        {words.glyph}
      </button>
    </div>
  )
}
