// web/column-menu — how a card column's head ends, a thread's and a note
// column's alike: its ⋯, what `columnMenu` offers, then its ×,
// which trashes the card.

import type { CardId, CardWidth } from "@pinetrie/core"
import {
  COLUMN_MENU_LABEL,
  type ColumnMenuSection,
  columnMenu,
  type Intent,
  TRASH_COLUMN,
} from "@pinetrie/interface"
import { InventoryIcon } from "./icons.tsx"
import { Menu } from "./menu.tsx"

export function ColumnHeadEnd(p: {
  card: CardId
  width: CardWidth
  /** The column the × is clicked in, where a refusal is said. */
  columnKey: string
  /** Whether the reader may trash it: no × otherwise. */
  writable: boolean
  onIntent: (intent: Intent) => void
}) {
  return (
    <>
      <ColumnMenu
        onIntent={p.onIntent}
        sections={columnMenu({ card: p.card, width: p.width })}
      />
      {p.writable && (
        <button
          aria-label={TRASH_COLUMN}
          className="close"
          onClick={() =>
            p.onIntent({
              kind: "discard",
              card: p.card,
              at: { kind: "column", key: p.columnKey },
            })
          }
          title={TRASH_COLUMN}
          type="button"
        >
          ×
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
            item.intent.kind === "takeIntoInventory" ? (
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
