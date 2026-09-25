// The protocol codec: the one place wire sentinels are understood.
//
// It owns every SHAPE rule. These cases moved here from planCommand's tests
// when the rules did, and keep their meaning: in particular, empty text is
// still reported ahead of a missing parent.

import assert from "node:assert/strict"
import {
  atEntry,
  ERR,
  entryId,
  ROOT,
  referenceId,
  runId,
  THE_AGENT,
} from "@pineta/core"
import { test } from "vitest"
import {
  decodeCommand,
  decodeReply,
  encodeIntent,
  encodeOutcome,
  type Outcome,
} from "./codec.ts"
import { reply } from "./messages.ts"

const refusalCode = (x: ReturnType<typeof decodeCommand>) =>
  x.kind === "refused" ? x.code : `not refused: ${x.kind}`

test('decode: parentId "" is the root: a new conversation for chat, no anchor for a thread', () => {
  const chat = decodeCommand({
    kind: "chat",
    text: "hi",
    parentId: "",
    mode: "reply",
  })
  assert.equal(chat.kind === "chat" ? chat.at.kind : "", "root")
  assert.equal(
    refusalCode(
      decodeCommand({ kind: "thread", text: "session", parentId: "" }),
    ),
    ERR.NO_PARENT,
  )
})

test("decode: a chat needs text and a known mode", () => {
  assert.equal(
    refusalCode(decodeCommand({ kind: "chat", text: "  ", mode: "reply" })),
    ERR.EMPTY_MESSAGE,
  )
  assert.equal(
    refusalCode(decodeCommand({ kind: "chat", text: "hi", mode: "shout" })),
    ERR.UNKNOWN_KIND,
  )
})

test("decode: the removed verbs are unknown", () => {
  for (const kind of ["prompt", "branch", "navigate"])
    assert.equal(
      refusalCode(decodeCommand({ kind, text: "x" })),
      ERR.UNKNOWN_KIND,
    )
})

test("decode: an unknown kind is refused, not guessed", () => {
  assert.equal(refusalCode(decodeCommand({ kind: "fold" })), ERR.UNKNOWN_KIND)
  assert.equal(refusalCode(decodeCommand(null)), ERR.UNKNOWN_KIND)
})

test("encodeIntent -> decodeCommand round-trips every intent", () => {
  const intents = [
    {
      kind: "chat",
      text: "hi @agent",
      at: ROOT,
      mode: "reply",
      mentions: [{ kind: "agent", agent: THE_AGENT }],
    },
    {
      kind: "chat",
      text: "hi @bob",
      at: atEntry(entryId("e-5")),
      mode: "queue",
      mentions: [{ kind: "person", name: "bob" }],
    },
    {
      kind: "chat",
      text: "aside",
      at: atEntry(entryId("e-3")),
      mode: "branch",
      mentions: [],
    },
    { kind: "name", name: "Alice" },
    { kind: "reference", to: { kind: "entry", id: entryId("e-7") }, at: ROOT },
    {
      kind: "reference",
      to: { kind: "span", id: entryId("e-7"), start: 0, end: 2 },
      at: atEntry(entryId("e-8")),
    },
    {
      kind: "thread",
      at: entryId("e-6"),
      compels: { kind: "agent", agent: THE_AGENT },
    },
    { kind: "thread", at: entryId("e-6"), compels: { kind: "none" } },
  ] as const
  for (const intent of intents) {
    assert.deepEqual(decodeCommand(encodeIntent("c-1", intent)), intent)
  }
})

test("encodeOutcome -> decodeReply round-trips every outcome", () => {
  const outcomes: Outcome[] = [
    { kind: "started", runId: runId("r-1") },
    { kind: "queued", position: 2 },
    { kind: "conflict", by: "Bea" },
    { kind: "referenced", id: referenceId("x-1") },
    { kind: "appended", id: entryId("e-1") },
    { kind: "named" },
    { kind: "threaded" },
    { kind: "refused", code: ERR.UNKNOWN_TARGET, message: "nope" },
  ]
  for (const outcome of outcomes) {
    assert.deepEqual(decodeReply(encodeOutcome("c-1", outcome)), outcome)
  }
})

test("decodeReply: an unrecognised code stays inside the ErrCode set", () => {
  const wire = reply({ id: "c", outcome: "refused", errorCode: "made-up" })
  const out = decodeReply(wire)
  assert.equal(out.kind === "refused" ? out.code : "", ERR.UNKNOWN_KIND)
})
