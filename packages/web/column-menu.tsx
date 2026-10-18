// web/column-menu — how a card column's head ends, a thread's and a note
// column's alike, as `columnHeadEnd` decides: its ⋯, then one button, ⇤,
// which folds it for you, or a bin on a thread not yet started, which trashes
// it.

import type { CardId, CardWidth } from "@pinetrie/core"
import {
  COLUMN_MENU_LABEL,
  type ColumnMenuSection,
  columnHeadEnd,
  type Intent,
} from "@pinetrie/interface"
import { InventoryIcon, TrashIcon } from "./icons.tsx"
import { Menu } from "./menu.tsx"

export function ColumnHeadEnd(p: {
  card: CardId
  width: CardWidth
  /** Whether the reader may trash it: no trash in ⋯, and no bin, otherwise. */
  writable: boolean
  /** A thread not yet started: a bin in place of ⇤. */
  unstarted: boolean
  onIntent: (intent: Intent) => void
}) {
  const end = columnHeadEnd(p)
  const { button } = end
  return (
    <>
      <ColumnMenu onIntent={p.onIntent} sections={end.menu} />
      {button !== null && (
        <button
          aria-label={button.words.title}
          className={button.words.className}
          onClick={() => p.onIntent(button.intent)}
          title={button.words.title}
          type="button"
        >
          {button.intent.kind === "discard" ? (
            <TrashIcon />
          ) : (
            button.words.label
          )}
        </button>
      )}
    </>
  )
}

function ColumnMenu(p: {
  sections: readonly ColumnMenuSection[]
  onIntent: (intent: Intent) => void
}) {
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
            item.intent.kind === "putAway" ? (
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
