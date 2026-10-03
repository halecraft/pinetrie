import { encodeOutcome } from "@pineta/protocol/codec"
import type { Command, Reply } from "@pineta/protocol/messages"
import { expect, test } from "vitest"
import { hostLine } from "./host-line.ts"

/** A Line's two ends, in memory: what was sent, and a way to reply. */
function wire() {
  const sent: Command[] = []
  const queue: Reply[] = []
  let wake: (() => void) | null = null
  const replies: AsyncIterable<Reply> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queue.shift()
        if (next !== undefined) yield next
        else await new Promise<void>(resolve => (wake = resolve))
      }
    },
  }
  return {
    sent,
    line: hostLine({ send: c => void sent.push(c), replies }),
    reply(r: Reply) {
      queue.push(r)
      wake?.()
    },
  }
}

test("a reply answers the request that carries its id, with its rev", async () => {
  const w = wire()
  const named = w.line.request({ kind: "name", name: "Ada" }, "r-1")
  const stopped = w.line.request({ kind: "name", name: "Bea" }, "r-2")
  expect(w.sent.map(c => c.id)).toEqual(["r-1", "r-2"])
  w.reply(encodeOutcome("r-2", { kind: "moved" }, 7))
  w.reply(encodeOutcome("r-1", { kind: "named" }))
  expect(await stopped).toEqual({ outcome: { kind: "moved" }, rev: 7 })
  expect((await named).outcome).toEqual({ kind: "named" })
})

test("a request still waiting when the host leaves fails, saying so", async () => {
  const w = wire()
  const waiting = w.line.request({ kind: "name", name: "Ada" })
  w.line.settleAll("the host left before answering")
  expect(await waiting).toEqual({
    outcome: { kind: "failed", message: "the host left before answering" },
    rev: null,
  })
})
