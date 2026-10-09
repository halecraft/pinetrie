import { type CardId, textCardId } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  type EditorEvent,
  type EditorState,
  editorState,
  needsCard,
  startText,
} from "./card-state.ts"
import { sendable } from "./send.ts"

const AGENT = { text: "@agent ", blank: true }
const C1: CardId = textCardId("c0000000-0000-7000-8000-000000000001")
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
      step(bound, {
        kind: "input",
        text: "",
        card: textCardId("c0000000-0000-7000-8000-000000000002"),
      }),
    ).toEqual({ state: bound, acts: [] })
  })

  test("a card found attaches; a card gone detaches", () => {
    expect(step(local, { kind: "found", card: C1 })).toEqual({
      state: bound,
      acts: ["attach"],
    })
    expect(
      step(bound, {
        kind: "found",
        card: textCardId("c0000000-0000-7000-8000-000000000002"),
      }).state,
    ).toBe(bound)
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
      step(bound, {
        kind: "input",
        text: "",
        card: textCardId("c0000000-0000-7000-8000-000000000002"),
      }),
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
