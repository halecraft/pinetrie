// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  ERR,
  checkEnvironment,
  compareVersions,
  findSeqKeys,
  laneNameForWriter,
  messageText,
  planCommand,
  projectTranscript,
  turnFinished,
} from "../core/index.mjs"

const READY = { ready: true, busy: false }

test("planCommand: a decision is a value, and it does not mutate state", () => {
  const before = { ...READY }
  const decision = planCommand(before, { kind: "prompt", text: "hi" }, "run-1")
  assert.equal(decision.kind, "run")
  assert.equal(decision.runId, "run-1")
  assert.equal(decision.next.busy, true)
  assert.deepEqual(before, READY, "planCommand must not mutate the state it is given")
})

test("planCommand: rejections are structured, not thrown", () => {
  assert.equal(planCommand(READY, { kind: "fold", text: "x" }, "r").code, ERR.UNKNOWN_KIND)
  assert.equal(planCommand(READY, { kind: "prompt", text: "   " }, "r").code, ERR.EMPTY_PROMPT)
  assert.equal(planCommand({ ready: false, busy: false }, { kind: "prompt", text: "x" }, "r").code, ERR.NOT_READY)
  assert.equal(planCommand({ ready: true, busy: true }, { kind: "prompt", text: "x" }, "r").code, ERR.BUSY)
})

test("planCommand/turnFinished: busy round-trips", () => {
  const running = planCommand(READY, { kind: "prompt", text: "hi" }, "r").next
  assert.equal(running.busy, true)
  assert.equal(turnFinished(running).busy, false)
})

test("laneNameForWriter: ADR-0011 — never 'main', always writer-derived", () => {
  assert.equal(laneNameForWriter("abc"), "w-abc")
  assert.notEqual(laneNameForWriter("abc"), "main")
  assert.throws(() => laneNameForWriter(""), /non-empty/)
  assert.throws(() => laneNameForWriter("a\u0000b"), /u0000/)
})

test("findSeqKeys: ADR-0013 — seq must not ride the wire", () => {
  assert.deepEqual(findSeqKeys({ id: "x", accepted: true }), [])
  assert.deepEqual(findSeqKeys({ a: { seq: 3 } }), ["$.a.seq"])
  assert.deepEqual(findSeqKeys([{ seq: 1 }]), ["$[0].seq"])
  assert.deepEqual(findSeqKeys(null), [])
})

test("projectTranscript: order comes from the parentId walk, not insertion or seq", () => {
  // Deliberately insert out of order, and give the entries misleading seqs.
  const entries = {
    c: { id: "c", parentId: "b", type: "message", seq: 1, message: { role: "assistant", content: "three" } },
    a: { id: "a", parentId: null, type: "message", seq: 9, message: { role: "user", content: "one" } },
    b: { id: "b", parentId: "a", type: "message", seq: 5, message: { role: "user", content: "two" } },
  }
  const out = projectTranscript(entries, "c")
  assert.deepEqual(out.map((m) => m.text), ["one", "two", "three"])
})

test("projectTranscript: an abandoned branch is not on the tip's path", () => {
  const entries = {
    a: { id: "a", parentId: null, type: "message", message: { role: "user", content: "root" } },
    b: { id: "b", parentId: "a", type: "message", message: { role: "assistant", content: "kept" } },
    x: { id: "x", parentId: "a", type: "message", message: { role: "assistant", content: "abandoned" } },
  }
  assert.deepEqual(projectTranscript(entries, "b").map((m) => m.text), ["root", "kept"])
})

test("projectTranscript: non-message entries and unknown roles are dropped", () => {
  const entries = {
    a: { id: "a", parentId: null, type: "message", message: { role: "user", content: "hi" } },
    m: { id: "m", parentId: "a", type: "custom", customType: "acp:plan" },
    s: { id: "s", parentId: "m", type: "message", message: { role: "toolResult", content: "noise" } },
  }
  assert.deepEqual(projectTranscript(entries, "s").map((m) => m.role), ["user"])
})

test("projectTranscript: a cycle is reported, not spun on", () => {
  const entries = {
    a: { id: "a", parentId: "b", type: "message", message: { role: "user", content: "a" } },
    b: { id: "b", parentId: "a", type: "message", message: { role: "user", content: "b" } },
  }
  assert.throws(() => projectTranscript(entries, "a"), /cycle/)
})

test("messageText: flattens pi's content parts", () => {
  assert.equal(messageText({ content: "plain" }), "plain")
  assert.equal(messageText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }), "ab")
  assert.equal(messageText({ content: [{ type: "image" }] }), "")
  assert.equal(messageText(undefined), "")
})

test("compareVersions / checkEnvironment: the deterministic build guards", () => {
  assert.equal(compareVersions("1.16.3", "1.13.4"), 1)
  assert.equal(compareVersions("1.13.4", "1.13.4"), 0)
  assert.equal(compareVersions("1.10.8", "1.13.4"), -1)
  assert.equal(compareVersions("1.9", "1.10"), -1, "numeric, not lexical")

  assert.equal(checkEnvironment({ hasStepInPlace: true, loroVersion: "1.16.3" }).ok, true)
  // Published @kyneta/schema 3.0.0 lacks stepInPlace — that is the whole point.
  assert.match(checkEnvironment({ hasStepInPlace: false, loroVersion: "1.16.3" }).problems[0], /stepInPlace/)
  assert.match(checkEnvironment({ hasStepInPlace: true, loroVersion: "1.10.8" }).problems[0], /below the 1.13.4 floor/)
})
