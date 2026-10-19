import type { Outcome } from "@pinetrie/protocol/codec"
import type { ProposedChangesAction } from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { type Acting, type ActingEvent, nextActing } from "./acting.ts"

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
