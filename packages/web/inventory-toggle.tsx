// web/inventory-toggle — opens and closes your inventory's panel
// (ADR-0048): in the footer's corner, or, while your list is folded, in your
// profile (ADR-0088).

import { INVENTORY } from "@pinetrie/interface"

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
  return (
    <button
      aria-pressed={open}
      className="inventory-toggle"
      onClick={onToggle}
      title="your inventory: cards you keep for later"
      type="button"
    >
      {INVENTORY} {count}
    </button>
  )
}
