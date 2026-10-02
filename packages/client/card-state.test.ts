import { type CardId, cardId } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  alreadySent,
  type EditorEvent,
  type EditorState,
  editorState,
  hostLetGo,
  isRedo,
  needsCard,
  spentCards,
  startText,
} from "./card-state.ts"
import { sendable } from "./send.ts"

const AGENT = { text: "@agent ", blank: true }
const C1: CardId = cardId("c-1")
const local: EditorState = { kind: "local", last: null }
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

  test("an emptied box claims the redo key, with a card to redo or not; a bound one never", () => {
    expect(step(local, { kind: "redo" })).toEqual({
      state: local,
      acts: [],
      claims: true,
    })
    expect(step(bound, { kind: "redo" })).toEqual({
      state: bound,
      acts: [],
      claims: false,
    })
    const sending: EditorState = { kind: "sending", card: C1 }
    expect(step(sending, { kind: "redo" }).claims).toBe(false)
  })

  test("local becomes a card only on an input worth keeping", () => {
    expect(step(local, { kind: "input", text: "@agent ", card: C1 })).toEqual({
      state: local,
      acts: [],
      claims: false,
    })
    expect(step(local, { kind: "input", text: "@agent x", card: C1 })).toEqual({
      state: bound,
      acts: ["create", "attach"],
      claims: false,
    })
    // Bound, typing is the binding's: nothing to decide.
    expect(
      step(bound, { kind: "input", text: "", card: cardId("c-2") }),
    ).toEqual({ state: bound, acts: [], claims: false })
  })

  test("a card found attaches; a card gone detaches", () => {
    expect(step(local, { kind: "found", card: C1 })).toEqual({
      state: bound,
      acts: ["attach"],
      claims: false,
    })
    expect(step(bound, { kind: "found", card: cardId("c-2") }).state).toBe(
      bound,
    )
    expect(step(bound, { kind: "gone" })).toEqual({
      state: { kind: "local", last: C1 },
      acts: ["detach"],
      claims: false,
    })
  })

  test("a box whose card went can redo it, until it holds a card again", () => {
    const left: EditorState = { kind: "local", last: C1 }
    expect(step(left, { kind: "redo" })).toEqual({
      state: left,
      acts: ["redo"],
      claims: true,
    })
    // The redo brings the card's record back, which the column finds.
    expect(step(left, { kind: "found", card: C1 })).toEqual({
      state: bound,
      acts: ["attach"],
      claims: false,
    })
    expect(
      step(left, { kind: "input", text: "new", card: cardId("c-2") }).state,
    ).toEqual({ kind: "bound", card: cardId("c-2") })
  })

  test("sending: spent empties the box; a conflict or refusal keeps the card", () => {
    const sending = step(bound, { kind: "send" })
    expect(sending).toEqual({
      state: { kind: "sending", card: C1 },
      acts: [],
      claims: false,
    })
    // The host spends the card while the reply is on its way.
    expect(step(sending.state, { kind: "gone" }).state).toEqual(sending.state)
    expect(step(sending.state, { kind: "settled", spent: true })).toEqual({
      state: local,
      acts: ["detach"],
      claims: false,
    })
    expect(step(sending.state, { kind: "settled", spent: false })).toEqual({
      state: bound,
      acts: [],
      claims: false,
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

test("alreadySent: the unqueued cards the host took anyway, and no others", () => {
  const C2: CardId = cardId("c-2")
  const C3: CardId = cardId("c-3")
  expect(alreadySent(new Set([C1, C2]), [C2, C3])).toEqual([C2])
  expect(alreadySent(new Set([C1]), [])).toEqual([])
})

test("isRedo: the keys and input events attach redoes on", () => {
  const key = (
    k: string,
    mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey", boolean>>,
  ) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...mods,
  })
  expect(isRedo(key("z", { metaKey: true, shiftKey: true }))).toBe(true)
  expect(isRedo(key("Z", { ctrlKey: true, shiftKey: true }))).toBe(true)
  expect(isRedo(key("y", { ctrlKey: true }))).toBe(true)
  expect(isRedo({ inputType: "historyRedo" })).toBe(true)
  expect(isRedo(key("z", { metaKey: true }))).toBe(false)
  expect(isRedo(key("y", { metaKey: true }))).toBe(false)
  expect(isRedo(key("y", {}))).toBe(false)
  expect(isRedo({ inputType: "historyUndo" })).toBe(false)
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
