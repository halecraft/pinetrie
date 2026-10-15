import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
import { claimFocus } from "./focus-claim.ts"

test("what you opened or made takes focus once; nothing else does", () => {
  const column = { kind: "column", key: "k" } as const
  const board = { kind: "board" } as const
  const card = { kind: "card", card: cardIdFor("k") } as const
  for (const key of [column, board, card]) {
    expect(claimFocus(key, { ...key })).toEqual({ focus: true, armed: null })
    expect(claimFocus(null, key)).toEqual({ focus: false, armed: null })
    for (const other of [column, board, card].filter(o => o !== key))
      expect(claimFocus(key, other)).toEqual({ focus: false, armed: key })
  }
  expect(claimFocus(column, { kind: "column", key: "other" })).toEqual({
    focus: false,
    armed: column,
  })
  expect(claimFocus(card, { kind: "card", card: cardIdFor("other") })).toEqual({
    focus: false,
    armed: card,
  })
})
