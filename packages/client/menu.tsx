// client/menu — the one popover menu: a trigger button and a list of items.
//
// The list is `position: fixed`, placed under its trigger from the trigger's
// rect when it opens: the tab list scrolls sideways, which clips it
// vertically too, so a list positioned inside it would be cut off
// (`TECHNICAL.md`, Gotchas). Being fixed, it would drift from its trigger on a
// scroll or a resize, so either closes it.

import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

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
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const open = at !== null
  const wrapper = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const headingId = useId()

  const show = () => {
    const r = button.current?.getBoundingClientRect()
    if (r !== undefined)
      setAt({ top: r.bottom, right: window.innerWidth - r.right })
  }
  const close = (refocus: boolean) => {
    setAt(null)
    if (refocus) button.current?.focus()
  }

  // Opened, the first item takes focus.
  useLayoutEffect(() => {
    if (open) focusable(list.current)[0]?.focus()
  }, [open])

  // Closed by a click elsewhere, a scroll anywhere, or a resize.
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && wrapper.current?.contains(e.target))
        return
      setAt(null)
    }
    const drift = (e: Event) => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return
      setAt(null)
    }
    const shut = () => setAt(null)
    document.addEventListener("pointerdown", outside, true)
    window.addEventListener("scroll", drift, true)
    window.addEventListener("resize", shut)
    return () => {
      document.removeEventListener("pointerdown", outside, true)
      window.removeEventListener("scroll", drift, true)
      window.removeEventListener("resize", shut)
    }
  }, [open])

  return (
    <span className={open ? `${className} open` : className} ref={wrapper}>
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className={triggerClassName}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={e => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault()
            show()
          } else if (e.key === "Escape" && open) {
            e.preventDefault()
            close(true)
          }
        }}
        ref={button}
        title={title}
        type="button"
      >
        {trigger}
      </button>
      {at !== null && (
        <div
          className="menu"
          ref={box}
          style={{ position: "fixed", top: at.top, right: at.right }}
        >
          {heading !== undefined && (
            <p className="menu-heading" id={headingId}>
              {heading}
            </p>
          )}
          <div
            aria-label={heading === undefined ? label : undefined}
            aria-labelledby={heading === undefined ? undefined : headingId}
            onKeyDown={e => {
              if (e.key === "Escape") {
                e.preventDefault()
                close(true)
                return
              }
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
              e.preventDefault()
              const all = focusable(list.current)
              // `indexOf` would take `activeElement` only as a button; it is any element.
              // biome-ignore lint/complexity/useIndexOf: the types differ, see above
              const here = all.findIndex(b => b === document.activeElement)
              const step = e.key === "ArrowDown" ? 1 : all.length - 1
              all[(here + step) % all.length]?.focus()
            }}
            className="menu-items"
            id={listId}
            ref={list}
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
        </div>
      )}
    </span>
  )
}
