// web/inventory-toggle — opens and closes your inventory's panel
// (ADR-0048), as an icon in the footer's corner beside your inbox
// (ADR-0098). While the sidebar is folded, the account menu toggles it instead
// (`account-menu.tsx`).

import { inventoryWords } from "@pinetrie/interface"
import { InventoryIcon } from "./icons.tsx"

/** Your inventory's toggle: whether its panel is open, and its cards. */
export interface InventoryToggleProps {
  readonly open: boolean
  readonly count: number
  readonly onToggle: () => void
}

export function InventoryToggle({
  open,
  count,
  onToggle,
}: InventoryToggleProps) {
  const words = inventoryWords(count)
  return (
    <button
      aria-label={words.label}
      aria-pressed={open}
      className="inventory-toggle"
      onClick={onToggle}
      title={words.label}
      type="button"
    >
      <InventoryIcon />
      {count > 0 && (
        <span aria-hidden className="inventory-count">
          {count}
        </span>
      )}
    </button>
  )
}
