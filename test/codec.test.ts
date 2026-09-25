// The protocol codec: the one place wire sentinels are understood.
//
// It owns every SHAPE rule. These cases moved here from planCommand's tests
// when the rules did, and keep their meaning: in particular, empty text is
// still reported ahead of a missing parent.

import assert from "node:assert/strict"
import { atEntry, ERR, entryId, ROOT, runId } from "@pineta/core"
import { test } from "vitest"
import {
  decodeCommand,
  decodeReply,
  encodeIntent,
  encodeOutcome,
  type Outcome,
} from "../protocol/codec.ts"

const refusalCode = (x: ReturnType<typeof decodeCommand>) =>
  x.kind === "refused" ? x.code : `not refused: ${x.kind}`

test('decode: parentId "" means the ROOT on a navigate', () => {
  assert.deepEqual(decodeCommand({ kind: "navigate", parentId: "" }), {
    kind: "navigate",
    to: ROOT,
  })
  assert.deepEqual(decodeCommand({ kind: "navigate", parentId: "e-7" }), {
    kind: "navigate",
    to: atEntry(entryId("e-7")),
  })
})

test('decode: parentId "" on a BRANCH is refused as no_parent', () => {
  // The same wire value means something different per kind, and only the
  // codec knows it.
  assert.equal(
    refusalCode(decodeCommand({ kind: "branch", text: "x", parentId: "  " })),
    ERR.NO_PARENT,
  )
})

test("decode: empty text is reported BEFORE a missing parent", () => {
  // Pinned order, moved from planCommand. Splitting the two rules between the
  // codec and planCommand would have silently reversed it.
  assert.equal(
    refusalCode(decodeCommand({ kind: "branch", text: "  ", parentId: "" })),
    ERR.EMPTY_PROMPT,
  )
  assert.equal(
    refusalCode(decodeCommand({ kind: "prompt", text: "   " })),
    ERR.EMPTY_PROMPT,
  )
})

test("decode: an unknown kind is refused, not guessed", () => {
  assert.equal(refusalCode(decodeCommand({ kind: "fold" })), ERR.UNKNOWN_KIND)
  assert.equal(refusalCode(decodeCommand(null)), ERR.UNKNOWN_KIND)
})

test("encodeIntent -> decodeCommand round-trips every intent", () => {
  const intents = [
    { kind: "prompt", text: "hi" },
    { kind: "branch", text: "aside", from: entryId("e-3") },
    { kind: "navigate", to: ROOT },
    { kind: "navigate", to: atEntry(entryId("e-4")) },
  ] as const
  for (const intent of intents) {
    assert.deepEqual(decodeCommand(encodeIntent("c-1", intent)), intent)
  }
})

test("encodeOutcome -> decodeReply round-trips every outcome", () => {
  const outcomes: Outcome[] = [
    { kind: "started", runId: runId("r-1") },
    { kind: "navigated" },
    { kind: "refused", code: ERR.UNKNOWN_TARGET, message: "nope" },
  ]
  for (const outcome of outcomes) {
    assert.deepEqual(decodeReply(encodeOutcome("c-1", outcome)), outcome)
  }
})

test("decodeReply: an unrecognised code stays inside the ErrCode set", () => {
  const wire = {
    id: "c",
    accepted: false,
    runId: "",
    errorCode: "made-up",
    errorMessage: "",
  }
  const out = decodeReply(wire)
  assert.equal(out.kind === "refused" ? out.code : "", ERR.UNKNOWN_KIND)
})
