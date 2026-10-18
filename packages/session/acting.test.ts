import { type ProposedChangesAction, threadIdFor } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
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

const A = threadIdFor("a")
const B = threadIdFor("b")
const sent = (
  id: string,
  action: ProposedChangesAction = "accept",
): Acting<ProposedChangesAction> => ({
  kind: "sent",
  id,
  action,
  to: null,
})
const send = (
  id: string,
  action: ProposedChangesAction = "accept",
): ActingEvent<ProposedChangesAction> => ({
  kind: "sent",
  id,
  action,
  to: null,
})
const answered = (
  id: string,
  outcome: Outcome,
): ActingEvent<ProposedChangesAction> => ({
  kind: "answered",
  id,
  outcome,
})
const REFUSED: Outcome = {
  kind: "refused",
  code: "refused",
  message: "nothing to accept",
}

describe("nextActing: what is said of your last command on one thing", () => {
  test.each([
    ["a send is sent at once", null, send("1"), sent("1")],
    [
      "a send replaces a refusal",
      { kind: "refused", code: "refused", action: "accept", message: "x" },
      send("2", "squash"),
      sent("2", "squash"),
    ],
    [
      "a refusal is kept, with its message",
      sent("1"),
      answered("1", REFUSED),
      {
        kind: "refused",
        code: "refused",
        action: "accept",
        message: "nothing to accept",
      },
    ],
    [
      "a failure is kept, with its message",
      sent("1"),
      answered("1", { kind: "failed", message: "jj said no" }),
      { kind: "failed", action: "accept", message: "jj said no" },
    ],
    [
      "accepted clears it",
      sent("1"),
      answered("1", { kind: "accepted" }),
      null,
    ],
    [
      "proposed clears it",
      sent("1"),
      answered("1", { kind: "proposed" }),
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
    expect(nextActing<ProposedChangesAction>(prev, event)).toEqual(next)
  })
})

describe("sendActing: the session's store, around one command", () => {
  test("sent at once, the refusal on reply, per lane; an acceptance clears it", async () => {
    const store = snapshotStore<ActingState>(NO_ACTING)
    let reply: (o: Outcome) => void = () => {}
    const out = sendActing(
      store,
      { kind: "proposed", lane: A, action: "accept", to: "wip/x" },
      () => new Promise(resolve => (reply = resolve)),
      "1",
    )
    expect(store.current().proposedByLane.get(A)).toEqual({
      kind: "sent",
      id: "1",
      action: "accept",
      to: "wip/x",
    })
    expect(store.current().proposedByLane.has(B)).toBe(false)
    reply(REFUSED)
    expect(await out).toEqual(REFUSED)
    expect(store.current().proposedByLane.get(A)).toEqual({
      kind: "refused",
      code: "refused",
      action: "accept",
      message: "nothing to accept",
    })
    await sendActing(
      store,
      { kind: "proposed", lane: A, action: "accept", to: null },
      () => Promise.resolve({ kind: "accepted" }),
      "2",
    )
    expect(store.current().proposedByLane.has(A)).toBe(false)
  })
  test("accepted work's command is kept apart from every lane's", async () => {
    const store = snapshotStore<ActingState>(NO_ACTING)
    await sendActing(
      store,
      { kind: "accepted", action: "publish" },
      () => Promise.resolve({ kind: "failed", message: "jj said no" }),
      "1",
    )
    expect(store.current()).toEqual({
      ...NO_ACTING,
      accepted: { kind: "failed", action: "publish", message: "jj said no" },
    })
  })
  test("an ssh answer is kept per lane, apart from its proposed changes", async () => {
    const store = snapshotStore<ActingState>(NO_ACTING)
    await sendActing(
      store,
      { kind: "access", lane: A, answer: "allow" },
      () =>
        Promise.resolve({
          kind: "refused",
          code: "not_owner",
          message: "not yours",
        }),
      "1",
    )
    expect(store.current().access.get(A)).toEqual({
      kind: "refused",
      code: "not_owner",
      action: "allow",
      message: "not yours",
    })
    expect(store.current().proposedByLane.has(A)).toBe(false)
  })
})
