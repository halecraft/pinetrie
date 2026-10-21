// web/column-menu — a card column's head as `columnHead` decides, a thread's,
// a note column's and a media column's alike, folded or not: its start, the
// toggle (⇤ or ⇥, or a bin on a thread not yet started) and the card's box;
// its handle, the one part a drag starts from; and, unfolded, its ⋯ at the
// end.

import {
  COLUMN_MENU_LABEL,
  type ColumnHead,
  type ColumnMenuSection,
  type Density,
  type Intent,
} from "@pinetrie/interface"
import type { CardId } from "@pinetrie/threads"
import { dragProps } from "@pinetrie/web-core"
import type { ReactNode } from "react"
import { IconButton } from "./button.tsx"
import { InventoryIcon, TrashIcon } from "./icons.tsx"
import { Menu } from "./menu.tsx"

/**
 * A head's start: the toggle, then the box. The toggle comes first, so it
 * is in the same place folded or not, and a second click lands on it. A fold
 * moves the box and flips the toggle (`data-fold-box`, `data-fold-toggle`,
 * `use-fold-motion.ts`) rather than fading them.
 */
export function ColumnHeadStart(p: {
  head: ColumnHead
  onIntent: (intent: Intent) => void
}) {
  const { toggle, box } = p.head
  const { intent } = box
  return (
    <>
      {toggle !== null && (
        <IconButton
          label={toggle.words.title}
          className={toggle.words.className}
          data-fold-toggle=""
          onClick={() => p.onIntent(toggle.intent)}
        >
          {toggle.intent.kind === "trash" ? <TrashIcon /> : toggle.words.label}
        </IconButton>
      )}
      <input
        aria-label={box.title}
        checked={box.ticked}
        className="column-box"
        data-fold-box=""
        disabled={intent === null}
        onChange={() => {
          if (intent !== null) p.onIntent(intent)
        }}
        title={box.title}
        type="checkbox"
      />
    </>
  )
}

/**
 * A column's handle: its mark and name, folded or not, the only part of its
 * head a drag starts from, so no press there is also a click. `title` says
 * more of it, a strip's focus. With no card (the canvas column, a column no
 * card holds) it draws the same, and nothing drags it.
 */
export function ColumnHandle(p: {
  card: CardId | null
  title?: string
  className?: string
  /** Its thread's name, which the browser suite finds a column by. */
  thread?: string
  children: ReactNode
}) {
  return (
    <span
      {...(p.card === null ? {} : dragProps({ kind: "card", card: p.card }))}
      className={`head-handle${p.className === undefined ? "" : ` ${p.className}`}`}
      data-role="handle"
      data-thread={p.thread}
      title={p.title}
    >
      {p.children}
    </span>
  )
}

/**
 * An unfolded head's ⋯: what changes the canvas everyone shares. Rename and
 * Pin a card open what the page draws itself; a column without Pin a card
 * passes nothing for it.
 */
export function ColumnMenu(p: {
  sections: readonly ColumnMenuSection[]
  onIntent: (intent: Intent) => void
  /** Every column's ⋯ offers its title's row to a reader who may write. */
  onRename: () => void
  onPin?: () => void
  /** Read the column so: its reading choices, which a list column has none of. */
  onDensity?: (density: Density) => void
}) {
  if (p.sections.length === 0) return null
  return (
    <Menu
      className="column-more"
      label={COLUMN_MENU_LABEL}
      sections={p.sections.map(section => ({
        key: section.key,
        items: section.items.map(item => ({
          key: item.key,
          className: `column-${item.key}`,
          ...(item.kind === "density" ? { checked: item.checked } : {}),
          title: item.title,
          // Take has one icon wherever it is offered.
          label:
            item.kind === "intent" && item.intent.kind === "put-away" ? (
              <>
                <InventoryIcon way="take" /> {item.label}
              </>
            ) : (
              item.label
            ),
          onChoose: () => {
            if (item.kind === "intent") p.onIntent(item.intent)
            else if (item.kind === "rename") p.onRename()
            else if (item.kind === "density") p.onDensity?.(item.density)
            else p.onPin?.()
          },
        })),
      }))}
      trigger="⋯"
      triggerClassName="column-menu"
    />
  )
}
