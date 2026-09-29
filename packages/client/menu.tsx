// client/menu — a popover whose box is a list of items. Placement and closing
// are `Popover`'s (`popover.tsx`).

import type { ReactNode } from "react"
import { Popover } from "./popover.tsx"

/** A menu's items that can take focus, in order. */
const focusable = (list: HTMLElement | null): HTMLButtonElement[] => [
  ...(list?.querySelectorAll<HTMLButtonElement>(
    '[role="menuitem"]:not(:disabled)',
  ) ?? []),
]

export interface MenuItem {
  readonly key: string
  readonly label: ReactNode
  readonly className?: string
  readonly title?: string
  readonly disabled?: boolean
  /** Drawn as `data-*` attributes, for finding an item. */
  readonly data?: Readonly<Record<string, string>>
  /** The menu stays open after it is chosen: a filter, say. */
  readonly keepOpen?: boolean
  readonly onChoose: () => void
}

export function Menu({
  className,
  trigger,
  triggerClassName,
  label,
  title,
  heading,
  items,
}: {
  /** The wrapper's class; `open` is added while the menu is open. */
  className: string
  /** What the trigger button shows. */
  trigger: ReactNode
  triggerClassName: string
  /** The trigger's accessible name. */
  label: string
  title?: string
  /**
   * Shown above the items, outside the `role="menu"` list, which may hold only
   * menu items; the list takes its name from it.
   */
  heading?: string
  items: readonly MenuItem[]
}) {
  return (
    <Popover
      boxClassName="popover menu"
      className={className}
      heading={heading}
      label={label}
      // Opened, the first item takes focus.
      onOpen={box => focusable(box)[0]?.focus()}
      role="menu"
      title={title}
      trigger={trigger}
      triggerClassName={triggerClassName}
    >
      {({ close, headingId }) => (
        <div
          aria-label={headingId === undefined ? label : undefined}
          aria-labelledby={headingId}
          onKeyDown={e => {
            if (e.key === "Escape") {
              e.preventDefault()
              close(true)
              return
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
            e.preventDefault()
            const all = focusable(e.currentTarget)
            // `indexOf` would take `activeElement` only as a button; it is any element.
            // biome-ignore lint/complexity/useIndexOf: the types differ, see above
            const here = all.findIndex(b => b === document.activeElement)
            const step = e.key === "ArrowDown" ? 1 : all.length - 1
            all[(here + step) % all.length]?.focus()
          }}
          className="menu-items"
          role="menu"
        >
          {items.map(item => (
            <button
              {...Object.fromEntries(
                Object.entries(item.data ?? {}).map(([k, v]) => [
                  `data-${k}`,
                  v,
                ]),
              )}
              className={item.className}
              disabled={item.disabled}
              key={item.key}
              onClick={() => {
                if (!item.keepOpen) close(false)
                item.onChoose()
              }}
              role="menuitem"
              title={item.title}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
