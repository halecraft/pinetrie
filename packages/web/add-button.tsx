// web/add-button — ＋: its main action, and the rest in its ▾ when it has
// any (`SplitButton`). What it starts and its words are its `StartButton`'s
// (`start-button.ts`, `@pinetrie/interface`): at the sidebar's foot, on each
// board column, and past a canvas's last column.

import type { Intent, StartButton } from "@pinetrie/interface"
import { SplitButton } from "./split-button.tsx"

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
  const { main, more } = add
  return (
    <SplitButton
      className={folded ? "add-root folded" : "add-root"}
      main={{
        look: "outline",
        className: `add-${main.key}`,
        label: folded ? "＋" : `＋ ${main.label}`,
        title: main.title,
        ...(folded ? { ariaLabel: main.name } : {}),
        onClick: () => onIntent(main.intent),
      }}
      more={
        more === null
          ? null
          : {
              key: "add",
              label: more.label,
              className: "add-more",
              triggerClassName: "add-menu",
              items: more.items.map(item => ({
                key: item.key,
                className: `add-${item.key}`,
                title: item.title,
                label: item.label,
                onChoose: () => onIntent(item.intent),
              })),
            }
      }
    />
  )
}
