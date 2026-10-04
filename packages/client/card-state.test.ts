import { type CardId, cardId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type EditorEvent,
  type EditorState,
  editorState,
  hostLetGo,
  needsCard,
  shownBelow,
  spentCards,
  startText,
} from "./card-state.ts"
import { sendable } from "./send.ts"

const AGENT = { text: "@agent ", blank: true }
const C1: CardId = cardId("c-1")
const local: EditorState = { kind: "local" }
const bound: EditorState = { kind: "bound", card: C1 }
const blank: EditorState = { kind: "blank" }
const step = (s: EditorState, e: EditorEvent) => editorState(s, e, AGENT)

test("needsCard: only what could be sent, and it agrees with sendable", () => {
  const cases: [string, typeof AGENT | undefined, boolean][] = [
    ["", undefined, false],
    ["   \n", undefined, false],
    ["@agent ", AGENT, false],
    ["@agent", AGENT, false],
    ["@agent fix it", AGENT, true],
    ["hello", undefined, true],
  ]
  for (const [text, prefill, want] of cases) {
    expect(needsCard(text, prefill)).toBe(want)
    expect(needsCard(text, prefill)).toBe(
      sendable(text, prefill, false) !== null,
    )
  }
})

describe("editorState", () => {
  test("a new card is created, then attached: never bound before it exists", () => {
    expect(step(local, { kind: "input", text: "x", card: C1 }).acts).toEqual([
      "create",
      "attach",
    ])
  })

  test("local becomes a card only on an input worth keeping", () => {
    expect(step(local, { kind: "input", text: "@agent ", card: C1 })).toEqual({
      state: local,
      acts: [],
    })
    expect(step(local, { kind: "input", text: "@agent x", card: C1 })).toEqual({
      state: bound,
      acts: ["create", "attach"],
    })
    // Bound, typing is the binding's: nothing to decide.
    expect(
      step(bound, { kind: "input", text: "", card: cardId("c-2") }),
    ).toEqual({ state: bound, acts: [] })
  })

  test("a card found attaches; a card gone detaches", () => {
    expect(step(local, { kind: "found", card: C1 })).toEqual({
      state: bound,
      acts: ["attach"],
    })
    expect(step(bound, { kind: "found", card: cardId("c-2") }).state).toBe(
      bound,
    )
    expect(step(bound, { kind: "gone" })).toEqual({
      state: local,
      acts: ["detach"],
    })
  })

  test("an undo past its creation empties the card but keeps it (ADR-0059): typing in the box goes on in the same card", () => {
    // Emptied, the card is still found, and no event detaches the box; only
    // `gone` does, when it is sent or removed.
    expect(step(bound, { kind: "found", card: C1 }).state).toBe(bound)
    expect(
      step(bound, { kind: "input", text: "", card: cardId("c-2") }),
    ).toEqual({ state: bound, acts: [] })
  })

  test("sending: spent empties the box; a conflict or refusal keeps the card", () => {
    const sending = step(bound, { kind: "send" })
    expect(sending).toEqual({
      state: { kind: "sending", card: C1 },
      acts: [],
    })
    // The host spends the card while the reply is on its way.
    expect(step(sending.state, { kind: "gone" }).state).toEqual(sending.state)
    expect(step(sending.state, { kind: "settled", spent: true })).toEqual({
      state: local,
      acts: ["detach"],
    })
    expect(step(sending.state, { kind: "settled", spent: false })).toEqual({
      state: bound,
      acts: [],
    })
  })

  test("a send from the box alone has no card to keep", () => {
    const sending = step(local, { kind: "send" })
    expect(sending.state).toEqual({ kind: "sending", card: null })
    expect(
      step(sending.state, { kind: "settled", spent: false }).state,
    ).toEqual(local)
  })
})

describe('"+ card": a blank box (PLAN-2026-10-04-cards-per-place)', () => {
  test("new empties the box and lets go of its card", () => {
    expect(step(bound, { kind: "new" })).toEqual({
      state: blank,
      acts: ["detach"],
    })
    // A send in flight finishes first.
    const sending: EditorState = { kind: "sending", card: C1 }
    expect(step(sending, { kind: "new" }).state).toBe(sending)
  })

  test("a blank box takes no card it finds, so the one set aside stays above", () => {
    expect(step(blank, { kind: "found", card: C1 })).toEqual({
      state: blank,
      acts: [],
    })
    expect(step(blank, { kind: "gone" }).state).toBe(blank)
  })

  test("typing in a blank box creates a new card, at the first input worth keeping", () => {
    expect(step(blank, { kind: "input", text: "@agent ", card: C1 })).toEqual({
      state: blank,
      acts: [],
    })
    expect(step(blank, { kind: "input", text: "next", card: C1 })).toEqual({
      state: bound,
      acts: ["create", "attach"],
    })
  })

  test("after a send from a blank box settles, the box is local again and takes your newest card", () => {
    const sending = step(blank, { kind: "send" }).state
    expect(sending).toEqual({ kind: "sending", card: null })
    expect(step(sending, { kind: "settled", spent: true }).state).toEqual(local)
    expect(step(local, { kind: "found", card: C1 }).state).toEqual(bound)
  })
})

describe("shownBelow", () => {
  const C2 = cardId("c-2")
  test("before the composer says, and while local, it shows your newest", () => {
    expect(shownBelow(undefined, C1)).toBe(C1)
    expect(shownBelow(local, C1)).toBe(C1)
    expect(shownBelow(local, undefined)).toBe(null)
  })
  test("bound or sending, the card it holds", () => {
    expect(shownBelow({ kind: "bound", card: C2 }, C1)).toBe(C2)
    expect(shownBelow({ kind: "sending", card: C2 }, C1)).toBe(C2)
  })
  test('a blank box shows nothing, so the card "+ card" set aside is drawn above', () => {
    expect(shownBelow(blank, C1)).toBe(null)
  })
})

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
  const C2: CardId = cardId("c-2")
  expect(spentCards([C1, C2], id => id === C1)).toEqual([C2])
  expect(spentCards([C1], () => true)).toEqual([])
})

test("startText: a fresh column's prefill, unless it opens with a message or a card", () => {
  const prefill = { text: "@agent ", blank: true }
  expect(startText({ pending: undefined, card: undefined, prefill })).toBe(
    "@agent ",
  )
  expect(startText({ pending: { text: "hi" }, card: undefined, prefill })).toBe(
    "",
  )
  expect(
    startText({ pending: undefined, card: undefined, prefill: undefined }),
  ).toBe("")
})
