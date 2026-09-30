import { type CardId, cardId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  type EditorEvent,
  type EditorState,
  editorState,
  needsCard,
} from "./card-state.ts"
import { sendable } from "./send.ts"

const AGENT = { text: "@agent ", blank: true }
const C1: CardId = cardId("c-1")
const local: EditorState = { kind: "local" }
const bound: EditorState = { kind: "bound", card: C1 }
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
  test("local becomes a card only on an input worth keeping", () => {
    expect(step(local, { kind: "input", text: "@agent ", card: C1 })).toEqual({
      state: local,
      act: null,
    })
    expect(step(local, { kind: "input", text: "@agent x", card: C1 })).toEqual({
      state: bound,
      act: "create",
    })
    // Bound, typing is the binding's: nothing to decide.
    expect(
      step(bound, { kind: "input", text: "", card: cardId("c-2") }),
    ).toEqual({ state: bound, act: null })
  })

  test("a card found attaches; a card gone detaches", () => {
    expect(step(local, { kind: "found", card: C1 })).toEqual({
      state: bound,
      act: "attach",
    })
    expect(step(bound, { kind: "found", card: cardId("c-2") }).state).toBe(
      bound,
    )
    expect(step(bound, { kind: "gone" })).toEqual({
      state: local,
      act: "detach",
    })
  })

  test("sending: spent empties the box; a conflict or refusal keeps the card", () => {
    const sending = step(bound, { kind: "send" })
    expect(sending).toEqual({ state: { kind: "sending", card: C1 }, act: null })
    // The host spends the card while the reply is on its way.
    expect(step(sending.state, { kind: "gone" }).state).toEqual(sending.state)
    expect(step(sending.state, { kind: "settled", spent: true })).toEqual({
      state: local,
      act: "detach",
    })
    expect(step(sending.state, { kind: "settled", spent: false })).toEqual({
      state: bound,
      act: null,
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
