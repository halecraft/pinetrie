// web/menu — a popover whose box is a list of items, in sections. Placement
// and closing are `Popover`'s (`popover.tsx`).

import { type ReactNode, useId } from "react"
import { Popover, type TriggerProps } from "./popover.tsx"

/** A menu's items that can take focus, in order. */
const focusable = (list: HTMLElement | null): HTMLButtonElement[] => [
  ...(list?.querySelectorAll<HTMLButtonElement>(
    ':is([role="menuitem"], [role="menuitemradio"]):not(:disabled)',
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
  /**
   * One of a choice, marked when it is the current one: drawn as a radio
   * item with a ✓. Absent for an item that does something.
   */
  readonly checked?: boolean
  readonly onChoose: () => void
}

/**
 * A run of a menu's items under one heading, after lines of text that say
 * how things stand (`notes`), which are not items and take no focus.
 */
export interface MenuSection {
  readonly key: string
  readonly heading?: string
  readonly notes?: readonly string[]
  readonly items: readonly MenuItem[]
}

export function Menu({
  className,
  trigger,
  triggerClassName,
  label,
  title,
  sections,
  onToggle,
  gone,
  opensOn,
  triggerProps,
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
   * The first section's heading is the menu's, shown above the list,
   * outside it, and the list takes its name from it. Each later section is a
   * group inside the list, named by its own.
   */
  sections: readonly MenuSection[]
  /** `Popover`'s: told when the menu opens or closes. */
  onToggle?: (open: boolean) => void
  /** `Popover`'s: no trigger is drawn, except while the menu is open. */
  gone?: boolean
  /** `Popover`'s: what opens the menu, and what else its trigger carries. */
  opensOn?: "click" | "contextmenu"
  triggerProps?: TriggerProps
}) {
  return (
    <Popover
      boxClassName="popover menu"
      className={className}
      gone={gone}
      heading={sections[0]?.heading}
      label={label}
      // Opened, the first item takes focus.
      onOpen={box => focusable(box)[0]?.focus()}
      onToggle={onToggle}
      opensOn={opensOn}
      role="menu"
      title={title}
      trigger={trigger}
      triggerClassName={triggerClassName}
      triggerProps={triggerProps}
    >
      {({ close, headingId }) => (
        <div
          aria-label={headingId === undefined ? label : undefined}
          aria-labelledby={headingId}
          onKeyDown={e => {
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
          {sections.map((section, i) => (
            <Section
              close={close}
              first={i === 0}
              key={section.key}
              section={section}
            />
          ))}
        </div>
      )}
    </Popover>
  )
}

/**
 * One section: a group named by its heading, but the first, whose heading
 * names the whole menu. A group's notes describe it, so a screen reader
 * reads them with it.
 */
function Section({
  section,
  first,
  close,
}: {
  section: MenuSection
  first: boolean
  close: (refocus: boolean) => void
}) {
  const notesId = useId()
  const { heading, notes = [], items } = section
  const described = notes.length === 0 ? undefined : notesId
  const body = (
    <>
      {notes.length > 0 && (
        <div className="menu-notes" id={notesId}>
          {notes.map(note => (
            <p className="menu-note" key={note}>
              {note}
            </p>
          ))}
        </div>
      )}
      {items.map(item => (
        <Item close={close} item={item} key={item.key} />
      ))}
    </>
  )
  if (first || heading === undefined)
    return (
      <div className="menu-section" role="none">
        {body}
      </div>
    )
  return (
    <fieldset
      aria-describedby={described}
      aria-label={heading}
      className="menu-section"
    >
      <p aria-hidden className="menu-heading">
        {heading}
      </p>
      {body}
    </fieldset>
  )
}

/** An item: one that does something, or one of a choice, with its ✓. */
function Item({
  item,
  close,
}: {
  item: MenuItem
  close: (refocus: boolean) => void
}) {
  const shared = {
    ...Object.fromEntries(
      Object.entries(item.data ?? {}).map(([k, v]) => [`data-${k}`, v]),
    ),
    className: item.className,
    disabled: item.disabled,
    onClick: () => {
      if (!item.keepOpen) close(false)
      item.onChoose()
    },
    title: item.title,
    type: "button" as const,
  }
  if (item.checked === undefined)
    return (
      <button {...shared} role="menuitem">
        {item.label}
      </button>
    )
  return (
    <button {...shared} aria-checked={item.checked} role="menuitemradio">
      <span aria-hidden className="menu-check">
        {item.checked ? "✓" : ""}
      </span>
      {item.label}
    </button>
  )
}
