// interface/account-view — the footer's corner and the menu your avatar opens.
// Folded, the corner is your avatar alone, carrying the inbox's badge, and
// the menu holds the inbox and the inventory too.

import { plural } from "./counts.ts"
import { INBOX } from "./inbox-view.ts"

export type AccountItem =
  | { readonly kind: "inbox"; readonly badge: number }
  | {
      readonly kind: "inventory"
      readonly count: number
      readonly open: boolean
    }
  | { readonly kind: "profile" }
  | { readonly kind: "setup" }
  | { readonly kind: "health" }
  | { readonly kind: "sign-out" }

interface AccountView {
  readonly items: readonly AccountItem[]
  /** The inbox's badge on your avatar: only while folded, and only above 0. */
  readonly badge: number | null
}

export function accountView(input: {
  readonly folded: boolean
  /** `inboxView`'s badge: the one count the inbox and the window's title share. */
  readonly badge: number
  readonly inventory: { readonly count: number; readonly open: boolean }
}): AccountView {
  const always: readonly AccountItem[] = [
    { kind: "profile" },
    { kind: "setup" },
    { kind: "health" },
    { kind: "sign-out" },
  ]
  if (!input.folded) return { items: always, badge: null }
  return {
    items: [
      { kind: "inbox", badge: input.badge },
      { kind: "inventory", ...input.inventory },
      ...always,
    ],
    badge: input.badge > 0 ? input.badge : null,
  }
}

/** An account menu item's words: its label, and a tooltip when the label needs one. */
interface AccountItemWords {
  readonly label: string
  readonly title?: string
}

/** An account menu item's words. A count is drawn beside the label, not in it. */
export function accountWords(item: AccountItem): AccountItemWords {
  switch (item.kind) {
    case "inbox":
      return { label: INBOX }
    case "inventory":
      return item.open
        ? { label: "Close inventory" }
        : { label: "Inventory", title: inventoryWords(item.count).label }
    case "profile":
      return { label: "Profile", title: "your name and picture" }
    case "setup":
      return {
        label: "Setup",
        title: "the host's model, sign-in and config files",
      }
    case "health":
      return {
        label: "Health",
        title:
          "how the machine your threads run on is doing, and what you can do",
      }
    case "sign-out":
      return {
        label: "Sign in as someone else",
        title: "forget who this device says you are, and ask again",
      }
  }
}

/** The inventory's toggle in the corner: an icon, so its words are its name. */
export const inventoryWords = (count: number): AccountItemWords => ({
  label: `your inventory: ${count === 0 ? "empty" : plural(count, "card")}`,
})
