// What the types make impossible to write. Each `@ts-expect-error` fails
// `pnpm run typecheck` if the line below it ever compiles.

import { type Send, threadIdFor, writerId } from "@pinetrie/core"
import { expect, test } from "vitest"
import { ROOT_ID } from "../fakes.ts"
import { type SendDeps, sendMessage } from "./send.ts"

test("a send the gate did not clear does not compile", () => {
  const unchecked: Send = {
    kind: "send",
    text: "x",
    root: ROOT_ID,
    at: { kind: "queue", thread: threadIdFor("t") },
    mentions: [],
    card: null,
    pinned: [],
    base: null,
    state: null,
  }
  const deps = {} as SendDeps
  const call = () =>
    // @ts-expect-error: only `planGate` makes the `Cleared<Send>` it takes
    sendMessage(deps, writerId("ada@x.io"), "s-1", unchecked)
  expect(call).toBeTypeOf("function")
})
