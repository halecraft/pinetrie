// web/work-strip — a column's changes row, in its dock: the lane's proposed
// changes in your repo, as `workStripWords` words them. Its line opens the
// review; its bookmark, copied, finds it in jj or jjui; its main buttons act
// at once. The rest of its commands are the dock's ⋯'s "changes" section
// (`workStripMenu`), so the dock has one ⋯.

import type { WorkStrip, WorkStripButton } from "@pinetrie/interface"
import { reviewToggleTitle } from "@pinetrie/interface"
import { Button } from "./button.tsx"
import { COPIED, useCopy } from "./copy.ts"
import type { MenuSection } from "./menu.tsx"

/**
 * Proposed changes' bookmark, which a press copies. Where it can't be copied, a
 * press selects the bookmark's own text (`useCopy`).
 */
function Bookmark({ name }: { name: string }) {
  const { copied, copy } = useCopy()
  return (
    <Button
      look="plain"
      className="work-bookmark"
      onClick={e => copy(name, [e.currentTarget])}
      title={copied ? COPIED : "copy the bookmark, to find it in jj"}
    >
      {name}
    </Button>
  )
}

/** The changes row: its line, bookmark, note and main buttons. */
export function WorkStripView({
  strip,
  act,
  review,
}: {
  strip: WorkStrip
  act: (button: WorkStripButton) => void
  review: {
    readonly id: string
    readonly open: boolean
    readonly toggle: () => void
  }
}) {
  const { words } = strip
  return (
    <div
      className="work work-strip"
      data-role="changes"
      data-state={strip.state}
    >
      {strip.review === null ? (
        <span className="work-line" title={words.lineTitle ?? undefined}>
          {words.line}
        </span>
      ) : (
        <Button
          look="plain"
          aria-controls={review.id}
          aria-expanded={review.open}
          className="work-line"
          onClick={review.toggle}
          title={reviewToggleTitle(review.open)}
        >
          {words.line}
        </Button>
      )}
      {strip.bookmark !== null && <Bookmark name={strip.bookmark} />}
      {words.note !== null && (
        <span
          className="work-note"
          data-acting={strip.waiting ? "sent" : "said"}
          role="status"
        >
          {words.note}
        </span>
      )}
      <span className="work-space" />
      {words.buttons.map(({ button, label, title, disabled }) => (
        <Button
          look="outline"
          className={`work-${button}`}
          disabled={strip.waiting || disabled === true}
          key={button}
          onClick={() => act(button)}
          title={title}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

/** The changes' commands, as the dock's ⋯'s first section; null with none. */
export function workStripMenu(
  strip: WorkStrip,
  act: (button: WorkStripButton) => void,
): MenuSection | null {
  const { menu } = strip.words
  if (menu.length === 0) return null
  return {
    key: "changes",
    items: menu.map(({ button, label, title, disabled }) => ({
      key: button,
      label,
      className: `work-${button}`,
      disabled: strip.waiting || disabled === true,
      ...(title === undefined ? {} : { title }),
      onChoose: () => act(button),
    })),
  }
}
