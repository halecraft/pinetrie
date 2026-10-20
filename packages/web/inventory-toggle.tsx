// web/inventory-toggle — opens and closes your inventory's panel, as an icon in
// the footer's corner beside your inbox. A card dropped on it is taken into a
// free slot, and one held over it opens the panel (`heldOpens`). While the
// sidebar is folded, the account menu toggles it instead (`account-menu.tsx`).

import { dropProps, inventoryWords } from "@pinetrie/interface"
import { IconButton } from "./button.tsx"
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
    <IconButton
      label={words.label}
      aria-pressed={open}
      className="inventory-toggle"
      {...dropProps({ kind: "inventory", slot: null })}
      onClick={onToggle}
    >
      <InventoryIcon />
      {count > 0 && (
        <span aria-hidden className="inventory-count">
          {count}
        </span>
      )}
    </IconButton>
  )
}
