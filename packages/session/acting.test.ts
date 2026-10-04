import { laneNameForThread, type OfferAction } from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { describe, expect, test } from "vitest"
import {
  type Acting,
  type ActingEvent,
  type ActingState,
  NO_ACTING,
  nextActing,
  sendActing,
} from "./acting.ts"
import { snapshotStore } from "./store.ts"

const A = laneNameForThread("a")
const B = laneNameForThread("b")
const sent = (
  id: string,
  action: OfferAction = "integrate",
): Acting<OfferAction> => ({
  kind: "sent",
  id,
  action,
  to: null,
})
const send = (
  id: string,
  action: OfferAction = "integrate",
): ActingEvent<OfferAction> => ({ kind: "sent", id, action, to: null })
const answered = (id: string, outcome: Outcome): ActingEvent<OfferAction> => ({
  kind: "answered",
  id,
  outcome,
})
const REFUSED: Outcome = {
  kind: "refused",
  code: "refused",
  message: "nothing to integrate",
}

describe("nextActing: what is said of your last command on one thing", () => {
  test.each([
    ["a send is sent at once", null, send("1"), sent("1")],
    [
      "a send replaces a refusal",
      { kind: "refused", action: "integrate", message: "x" },
      send("2", "squash"),
      sent("2", "squash"),
    ],
    [
      "a refusal is kept, with its message",
      sent("1"),
      answered("1", REFUSED),
      { kind: "refused", action: "integrate", message: "nothing to integrate" },
    ],
    [
      "a failure is kept, with its message",
      sent("1"),
      answered("1", { kind: "failed", message: "jj said no" }),
      { kind: "failed", action: "integrate", message: "jj said no" },
    ],
    [
      "integrated clears it",
      sent("1"),
      answered("1", { kind: "integrated" }),
      null,
    ],
    ["offered clears it", sent("1"), answered("1", { kind: "offered" }), null],
    [
      "a split's start clears it",
      sent("1", "split"),
      answered("1", { kind: "started", runId: "r" as never }),
      null,
    ],
    [
      "an answer to a send since replaced changes nothing",
      sent("2"),
      answered("1", REFUSED),
      sent("2"),
    ],
    [
      "an answer with nothing out changes nothing",
      null,
      answered("1", REFUSED),
      null,
    ],
  ] as const)("%s", (_, prev, event, next) => {
    expect(nextActing<OfferAction>(prev, event)).toEqual(next)
  })
})

describe("sendActing: the session's store, around one command", () => {
  test("sent at once, the refusal on reply, per lane; an integration clears it", async () => {
    const store = snapshotStore<ActingState>(NO_ACTING)
    let reply: (o: Outcome) => void = () => {}
    const out = sendActing(
      store,
      { kind: "offer", lane: A, action: "integrate", to: "wip/x" },
      () => new Promise(resolve => (reply = resolve)),
      "1",
    )
    expect(store.current().offers.get(A)).toEqual({
      kind: "sent",
      id: "1",
      action: "integrate",
      to: "wip/x",
    })
    expect(store.current().offers.has(B)).toBe(false)
    reply(REFUSED)
    expect(await out).toEqual(REFUSED)
    expect(store.current().offers.get(A)).toEqual({
      kind: "refused",
      action: "integrate",
      message: "nothing to integrate",
    })
    await sendActing(
      store,
      { kind: "offer", lane: A, action: "integrate", to: null },
      () => Promise.resolve({ kind: "integrated" }),
      "2",
    )
    expect(store.current().offers.has(A)).toBe(false)
  })
  test("the line's command is kept apart from every lane's", async () => {
    const store = snapshotStore<ActingState>(NO_ACTING)
    await sendActing(
      store,
      { kind: "line", action: "land" },
      () => Promise.resolve({ kind: "failed", message: "jj said no" }),
      "1",
    )
    expect(store.current()).toEqual({
      offers: new Map(),
      line: { kind: "failed", action: "land", message: "jj said no" },
    })
  })
})
