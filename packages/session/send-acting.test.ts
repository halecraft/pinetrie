import { ERR, threadIdFor } from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { describe, expect, test } from "vitest"
import { type ActingState, NO_ACTING } from "./acting.ts"
import { sendActing } from "./send-acting.ts"
import { snapshotStore } from "./store.ts"

const A = threadIdFor("a")
const B = threadIdFor("b")
const REFUSED: Outcome = {
  kind: "refused",
  code: "refused",
  message: "nothing to accept",
}

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
          code: ERR.NOT_OWNER,
          message: "not yours",
        }),
      "1",
    )
    expect(store.current().access.get(A)).toEqual({
      kind: "refused",
      code: ERR.NOT_OWNER,
      action: "allow",
      message: "not yours",
    })
    expect(store.current().proposedByLane.has(A)).toBe(false)
  })
})
