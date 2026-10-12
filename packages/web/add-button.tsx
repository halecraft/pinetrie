// web/add-button — ＋, a split button: its main action, and the rest in its
// ▾. What it starts and its words are its `StartButton`'s
// (`start-button.ts`, `@pinetrie/interface`): at the sidebar's foot, on each
// board column, and past a canvas's last column.

import type { Intent, StartButton } from "@pinetrie/interface"
import { Menu } from "./menu.tsx"

export function AddButton({
  add,
  folded = false,
  onIntent,
}: {
  add: StartButton
  /** ＋ alone, its ▾ under it: in a folded list, or past a canvas's last column. */
  folded?: boolean
  onIntent: (intent: Intent) => void
}) {
  const { main } = add
  return (
    <span className={folded ? "add-root folded" : "add-root"}>
      <button
        aria-label={folded ? main.name : undefined}
        className={`add-${main.key}`}
        onClick={() => onIntent(main.intent)}
        title={main.title}
        type="button"
      >
        {folded ? "＋" : `＋ ${main.label}`}
      </button>
      <Menu
        className="add-more"
        sections={[
          {
            key: "add",
            items: add.more.map(item => ({
              key: item.key,
              className: `add-${item.key}`,
              title: item.title,
              label: item.label,
              onChoose: () => onIntent(item.intent),
            })),
          },
        ]}
        label={add.moreLabel}
        trigger="▾"
        triggerClassName="add-menu"
      />
    </span>
  )
}
