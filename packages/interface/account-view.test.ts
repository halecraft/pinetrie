import { describe, expect, test } from "vitest"
import {
  type AccountItem,
  accountView,
  accountWords,
  inventoryWords,
} from "./account-view.ts"

describe("accountView", () => {
  const inventory = { count: 1, open: false }
  test.each([
    [false, 0, ["profile", "signOut"], null],
    [false, 4, ["profile", "signOut"], null],
    [true, 0, ["inbox", "inventory", "profile", "signOut"], null],
    [true, 4, ["inbox", "inventory", "profile", "signOut"], 4],
  ])("folded %s, %i needing you", (folded, badge, kinds, onAvatar) => {
    const view = accountView({ folded, badge, inventory })
    expect(view.items.map(i => i.kind)).toEqual(kinds)
    expect(view.badge).toBe(onAvatar)
  })
  test("folded, the inbox and the inventory carry their counts", () => {
    const view = accountView({ folded: true, badge: 12, inventory })
    expect(view.items.slice(0, 2)).toEqual([
      { kind: "inbox", badge: 12 },
      { kind: "inventory", count: 1, open: false },
    ])
  })
})

describe("accountWords", () => {
  test.each<[AccountItem, ReturnType<typeof accountWords>]>([
    [{ kind: "inbox", badge: 3 }, { label: "Inbox" }],
    [
      { kind: "inventory", count: 2, open: false },
      { label: "Inventory", title: "your inventory: 2 cards" },
    ],
    [{ kind: "inventory", count: 2, open: true }, { label: "Close inventory" }],
    [{ kind: "profile" }, { label: "Profile", title: "your name and picture" }],
    [
      { kind: "signOut" },
      {
        label: "Sign in as someone else",
        title: "forget who this device says you are, and ask again",
      },
    ],
  ])("%j", (item, words) => {
    expect(accountWords(item)).toEqual(words)
  })
  test.each([
    [0, "your inventory: empty"],
    [1, "your inventory: 1 card"],
    [18, "your inventory: 18 cards"],
  ])("the inventory's toggle with %i cards", (n, label) => {
    expect(inventoryWords(n).label).toBe(label)
  })
})
