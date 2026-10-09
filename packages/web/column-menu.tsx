// web/column-menu — a card column's ⋯ (ADR-0116): what `columnMenu` offers,
// drawn as a menu in the column's head.

import {
  COLUMN_MENU_LABEL,
  type ColumnMenuItem,
  type Intent,
} from "@pinetrie/interface"
import { Menu } from "./menu.tsx"

export function ColumnMenu(p: {
  items: readonly ColumnMenuItem[]
  onIntent: (intent: Intent) => void
}) {
  return (
    <Menu
      className="column-more"
      label={COLUMN_MENU_LABEL}
      sections={[
        {
          key: "canvas",
          items: p.items.map(item => ({
            key: item.key,
            className: `column-${item.key}`,
            title: item.title,
            label: item.label,
            onChoose: () => p.onIntent(item.intent),
          })),
        },
      ]}
      trigger="⋯"
      triggerClassName="column-menu"
    />
  )
}
