// web/column-menu — a card column's ⋯ (ADR-0116): what `columnMenu` offers,
// drawn as a menu in the column's head.

import {
  COLUMN_MENU_LABEL,
  type ColumnMenuSection,
  type Intent,
} from "@pinetrie/interface"
import { InventoryIcon } from "./icons.tsx"
import { Menu } from "./menu.tsx"

export function ColumnMenu(p: {
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
          // Take has one icon wherever it is offered (ADR-0132).
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
