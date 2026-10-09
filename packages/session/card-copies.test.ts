import { type CardId, textCardId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { hostLetGo, spentCards } from "./card-copies.ts"

const C1: CardId = textCardId("c0000000-0000-7000-8000-000000000001")

describe("hostLetGo", () => {
  const letGo = { hadHost: true, hasHost: false, hostConnected: true }
  test("the host left the document while connected", () => {
    expect(hostLetGo(letGo)).toBe(true)
  })
  test("an undo past a card's creation, yours or another's: the host stays", () => {
    expect(hostLetGo({ ...letGo, hasHost: true })).toBe(false)
  })
  test("a card the host has not reached yet", () => {
    expect(hostLetGo({ ...letGo, hadHost: false })).toBe(false)
  })
  test("a host that departed", () => {
    expect(hostLetGo({ ...letGo, hostConnected: false })).toBe(false)
  })
})

test("spentCards: only the cards let go of whose records are gone", () => {
  const C2: CardId = textCardId("c0000000-0000-7000-8000-000000000002")
  expect(spentCards([C1, C2], id => id === C1)).toEqual([C2])
  expect(spentCards([C1], () => true)).toEqual([])
})
