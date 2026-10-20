// web/column-menu — a card column's head as `columnHead` decides, a thread's,
// a note column's and a media column's alike, folded or not: its start, the
// toggle (⇤ or ⇥, or a bin on a thread not yet started) and the card's box;
// and, unfolded, its ⋯ at the end.

import {
  COLUMN_MENU_LABEL,
  type ColumnHead,
  type ColumnMenuSection,
  type Intent,
} from "@pinetrie/interface"
import { IconButton } from "./button.tsx"
import { InventoryIcon, TrashIcon } from "./icons.tsx"
import { Menu } from "./menu.tsx"

/**
 * A head's start: the toggle, then the box. The toggle comes first, so it
 * is in the same place folded or not, and a second click lands on it.
 */
export function ColumnHeadStart(p: {
  head: ColumnHead
  onIntent: (intent: Intent) => void
}) {
  const { toggle, box } = p.head
  const { intent } = box
  return (
    <>
      {toggle !== null && (
        <IconButton
          label={toggle.words.title}
          className={toggle.words.className}
          onClick={() => p.onIntent(toggle.intent)}
        >
          {toggle.intent.kind === "trash" ? <TrashIcon /> : toggle.words.label}
        </IconButton>
      )}
      <input
        aria-label={box.title}
        checked={box.ticked}
        className="column-box"
        disabled={intent === null}
        onChange={() => {
          if (intent !== null) p.onIntent(intent)
        }}
        title={box.title}
        type="checkbox"
      />
    </>
  )
}

/** An unfolded head's ⋯: what changes the canvas everyone shares. */
export function ColumnMenu(p: {
  sections: readonly ColumnMenuSection[]
  onIntent: (intent: Intent) => void
}) {
  if (p.sections.length === 0) return null
  return (
    <Menu
      className="column-more"
      label={COLUMN_MENU_LABEL}
      sections={p.sections.map(section => ({
        key: section.key,
        items: section.items.map(item => ({
          key: item.key,
          className: `column-${item.key}`,
          title: item.title,
          // Take has one icon wherever it is offered.
          label:
            item.intent.kind === "put-away" ? (
              <>
                <InventoryIcon way="take" /> {item.label}
              </>
            ) : (
              item.label
            ),
          onChoose: () => p.onIntent(item.intent),
        })),
      }))}
      trigger="⋯"
      triggerClassName="column-menu"
    />
  )
}
