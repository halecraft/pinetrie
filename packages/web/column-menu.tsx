// web/column-menu — a card column's ⋯ (ADR-0116): what `columnMenu` offers,
// drawn as a menu in the column's head.

import {
  COLUMN_MENU_LABEL,
  type ColumnMenuItem,
  type Intent,
} from "@pinetrie/interface"
import { Menu } from "./menu.tsx"

/** Each section's heading: the canvas's own items have none. */
const HEADINGS = {
  canvas: undefined,
  move: "Move to ▸",
  copy: "Copy to ▸",
} as const

export function ColumnMenu(p: {
  items: readonly ColumnMenuItem[]
  onIntent: (intent: Intent) => void
}) {
  const sections = (["canvas", "move", "copy"] as const).flatMap(section => {
    const items = p.items.filter(i => i.section === section)
    return items.length === 0
      ? []
      : [
          {
            key: section,
            heading: HEADINGS[section],
            items: items.map(item => ({
              key: item.key,
              className: `column-${item.key.replace(/-[kt]-.*$/, "")}`,
              title: item.title,
              label: item.label,
              onChoose: () => p.onIntent(item.intent),
            })),
          },
        ]
  })
  return (
    <Menu
      className="column-more"
      label={COLUMN_MENU_LABEL}
      sections={sections}
      trigger="⋯"
      triggerClassName="column-menu"
    />
  )
}
