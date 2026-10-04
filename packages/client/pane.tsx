// client/pane — a column's pane (ADR-0078): beside the thread, or over a
// narrow screen as a modal dialog. It draws a `PaneView`, which `paneView`
// decided, and owns what every view needs: Escape, focus, and coming into
// view.

import type { Element } from "hast"
import {
  memo,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { BlobImage } from "./blob-image.tsx"
import { drawTree } from "./message-text.tsx"
import { OPEN_IN_TAB, type PaneView, paneLabel } from "./pane.ts"
import { PaneHead } from "./pane-head.tsx"
import { trackStyle } from "./rail.tsx"
import { ReviewPane } from "./review-pane.tsx"
import { useNarrow } from "./use-narrow.ts"

export function Pane({
  id,
  view,
  track,
  close,
}: {
  /** What the strip's review line controls. */
  id: string
  view: PaneView
  /** The column's colour: a dialog in `body` does not inherit it. */
  track: number
  /** Stable (`useStable`). */
  close: () => void
}) {
  const narrow = useNarrow()
  const shown =
    view.kind === "review" ? (
      <ReviewPane
        close={close}
        line={view.line}
        narrow={narrow}
        target={view.target}
      />
    ) : view.kind === "table" ? (
      <TablePane
        close={close}
        narrow={narrow}
        table={view.table}
        title={view.title}
      />
    ) : (
      <ImagePane
        alt={view.alt}
        close={close}
        narrow={narrow}
        src={view.src}
        title={view.title}
      />
    )
  const label = paneLabel(view.kind)
  return narrow ? (
    <NarrowFrame close={close} id={id} label={label} track={track}>
      {shown}
    </NarrowFrame>
  ) : (
    <WideFrame close={close} id={id} label={label}>
      {shown}
    </WideFrame>
  )
}

interface FrameProps {
  id: string
  label: string
  close: () => void
  children: ReactNode
}

/**
 * Beside the thread, inside `.column`, which stays `#strip`'s direct child.
 * Opening brings it into view, as the strip may have to scroll right; closing
 * gives focus back to what had it, if focus was inside.
 */
function WideFrame({ id, label, close, children }: FrameProps) {
  const frame = useRef<HTMLElement>(null)
  // Read in render: the head takes focus in its own layout effect, which runs
  // before this component's.
  const [opener] = useState(() => document.activeElement)
  useLayoutEffect(() => {
    const el = frame.current
    el?.scrollIntoView({ inline: "nearest", block: "nearest" })
    // On unmount the section is still in the document here: React runs a
    // component's layout cleanups before it removes the elements below it.
    return () => {
      if (
        el?.contains(document.activeElement) === true &&
        opener instanceof HTMLElement &&
        opener.isConnected
      )
        opener.focus({ preventScroll: true })
    }
  }, [opener])
  return (
    <section
      aria-label={label}
      className="pane"
      id={id}
      onKeyDown={e => {
        if (e.key === "Escape") close()
      }}
      ref={frame}
    >
      {children}
    </section>
  )
}

/**
 * Over the page, in the top layer, which covers every stacking context and
 * makes the page behind inert. Escape closes a modal dialog itself, and
 * closing gives focus back to what had it (S66). Unmounted while open (its
 * subject gone, or ← pressed), it is closed first, so focus still returns.
 * In `body`: the column's `--track` does not reach it, so it sets its own.
 */
function NarrowFrame({
  id,
  label,
  close,
  track,
  children,
}: FrameProps & { track: number }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const el = dialog.current
    el?.showModal()
    return () => {
      if (el?.open === true) el.close()
    }
  }, [])
  return createPortal(
    <dialog
      aria-label={label}
      className="pane"
      data-narrow
      id={id}
      onClose={e => {
        // Only a close the reader made: the cleanup's own, of a dialog
        // unmounted or (StrictMode) mounted again and so open by now, is
        // dispatched later, and would close the pane after it.
        const el = e.currentTarget
        if (el.isConnected && !el.open) close()
      }}
      ref={dialog}
      style={trackStyle(track)}
    >
      {children}
    </dialog>,
    document.body,
  )
}

interface TablePaneProps {
  /** The message's own table, as `paneView` found it. */
  table: Element
  title: string
  narrow: boolean
  close: () => void
}

/**
 * A message's table, scrolling both ways, its header row pinned. Its own
 * images open the pane too; it has no bar, being outside any message.
 * Memoised: the column hands it the same table until its messages change.
 */
const TablePane = memo(function TablePaneView({
  table,
  title,
  narrow,
  close,
}: TablePaneProps) {
  const drawn = useMemo(
    () => drawTree({ type: "root", children: [table] }, { img: BlobImage }),
    [table],
  )
  return (
    <>
      <PaneHead close={close} narrow={narrow} title={title} />
      <div className="pane-body pane-table text">{drawn}</div>
    </>
  )
})

/**
 * A stored image, fitted to the pane's width; a click shows it at its own
 * size, scrolling, and back. Whether it is larger than the pane is a
 * measurement, so the choice is this component's.
 */
function ImagePane({
  src,
  alt,
  title,
  narrow,
  close,
}: {
  src: string
  alt: string
  title: string
  narrow: boolean
  close: () => void
}) {
  const [zoom, setZoom] = useState(false)
  return (
    <>
      <PaneHead
        close={close}
        extra={
          <a className="pane-link" href={src} rel="noopener" target="_blank">
            {OPEN_IN_TAB}
          </a>
        }
        narrow={narrow}
        title={title}
      />
      <div className="pane-body pane-image">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: a shortcut for the mouse; the link opens it whole */}
        <img
          alt={alt}
          data-zoom={zoom || undefined}
          onClick={() => setZoom(z => !z)}
          src={src}
        />
      </div>
    </>
  )
}
