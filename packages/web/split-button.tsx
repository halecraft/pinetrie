// web/split-button — a button and a ▾ menu of the rest beside it: ＋'s
// (`AddButton`) and the send button's, when either has more than its main
// action. The ▾ is a `Menu` of one section.

import type { ReactNode } from "react"
import { Button, type ButtonLook } from "./button.tsx"
import { Menu, type MenuItem } from "./menu.tsx"

export function SplitButton(p: {
  /** The wrapper's class. */
  className: string
  main: {
    readonly look: ButtonLook
    readonly className: string
    readonly label: ReactNode
    readonly title?: string
    readonly ariaLabel?: string
    readonly disabled?: boolean
    readonly onClick: () => void
  }
  /** The ▾'s menu; null for none, a button alone. */
  more: {
    readonly key: string
    /** The ▾'s accessible name. */
    readonly label: string
    readonly className: string
    readonly triggerClassName: string
    readonly items: readonly MenuItem[]
  } | null
}) {
  const { main, more } = p
  return (
    <span className={p.className}>
      <Button
        look={main.look}
        aria-label={main.ariaLabel}
        className={main.className}
        disabled={main.disabled}
        onClick={main.onClick}
        title={main.title}
      >
        {main.label}
      </Button>
      {more !== null && (
        <Menu
          className={more.className}
          sections={[{ key: more.key, items: more.items }]}
          label={more.label}
          trigger="▾"
          triggerClassName={more.triggerClassName}
        />
      )}
    </span>
  )
}
