// Tests for core/ — the pure module. Deliberately small: these cover the
// decisions that are easy to get silently wrong, not every branch.

import assert from "node:assert/strict"
import {
  atEntry,
  type CommandDecision,
  checkEnvironment,
  compareVersions,
  type EnvironmentReport,
  ERR,
  entryId,
  findSeqKeys,
  type Intent,
  laneNameForWriter,
  latestTip,
  messageText,
  planAttach,
  planCommand,
  projectTranscript,
  ROOT,
  runId,
  turnFinished,
} from "@pineta/core"
import { test } from "vitest"

const READY = { ready: true, busy: false }

/**
 * Narrow a decision to its `reject` branch.
 *
 * `CommandDecision` is a discriminated union, so `.code` does not exist on the
 * `run` branch. Asserting the branch first is what the union is FOR: a test
 * that silently read `undefined` off the wrong branch used to pass.
 */
function rejection(decision: CommandDecision) {
  assert.equal(decision.kind, "reject", "expected a rejection")
  if (decision.kind !== "reject") throw new Error("unreachable")
  return decision
}

/** First problem from an environment report, asserted present. */
function firstProblem(report: EnvironmentReport): string {
  const problem = report.problems[0]
  assert.ok(problem !== undefined, "expected at least one problem")
  return problem
}

const prompt = (text: string): Intent => ({ kind: "prompt", text })
const RUN = runId("run-1")
const E1 = entryId("e-1")
const E2 = entryId("e-2")

test("planCommand: a decision is a value, and it does not mutate state", () => {
  const before = { ...READY }
  const decision = planCommand(before, prompt("hi"), RUN)
  assert.equal(decision.kind, "run")
  assert.deepEqual(before, READY, "input state untouched")
  assert.equal(decision.next.busy, true)
})

test("planCommand: only STATE policy lives here — not ready, and busy", () => {
  // Shape rules (empty text, a missing parent, an unknown kind) belong to the
  // protocol codec and are tested in test/codec.test.ts.
  assert.equal(
    rejection(planCommand({ ready: false, busy: false }, prompt("x"), RUN))
      .code,
    ERR.NOT_READY,
  )
  const busy = { ready: true, busy: true }
  assert.equal(rejection(planCommand(busy, prompt("x"), RUN)).code, ERR.BUSY)
  assert.equal(
    rejection(planCommand(busy, { kind: "branch", text: "x", from: E1 }, RUN))
      .code,
    ERR.BUSY,
  )
  // Moving the tip under a running turn would decide where its entries land.
  assert.equal(
    rejection(planCommand(busy, { kind: "navigate", to: ROOT }, RUN)).code,
    ERR.BUSY,
  )
})

test("planCommand/turnFinished: busy round-trips", () => {
  const running = planCommand(READY, prompt("hi"), RUN)
  assert.equal(turnFinished(running.next).busy, false)
})

test("planCommand: each writer's turn state is independent (ADR-0011)", () => {
  // The host keeps a TurnState per writer. Writer A running a turn must not
  // make writer B busy — the old single-lane host refused B here.
  const a = planCommand(READY, prompt("from A"), RUN)
  assert.equal(a.next.busy, true)
  const b = planCommand(READY, prompt("from B"), runId("run-2"))
  assert.equal(b.kind, "run", "B is not refused because A is running")
})

test("planCommand: a prompt attaches at the TIP; a branch at an entry", () => {
  const p = planCommand(READY, prompt("hi"), RUN)
  assert.deepEqual(p.kind === "run" ? p.from : null, { kind: "tip" })
  const b = planCommand(READY, { kind: "branch", text: "x", from: E1 }, RUN)
  assert.deepEqual(b.kind === "run" ? b.from : null, atEntry(E1))
})

test("planCommand: navigate is its own decision, and never makes the lane busy", () => {
  const n = planCommand(READY, { kind: "navigate", to: atEntry(E1) }, RUN)
  assert.equal(n.kind, "navigate")
  assert.equal(n.next.busy, false)
})

test("planAttach: every lane state against every target", () => {
  const none = { kind: "none" } as const
  const atRoot = { kind: "lane", at: ROOT } as const
  const atE1 = { kind: "lane", at: atEntry(E1) } as const

  // No lane yet: always create, never navigate. pi would ignore `createAt`
  // for a lane that exists, so this must only happen when there is none.
  assert.deepEqual(planAttach(none, atEntry(E1)), {
    kind: "create",
    at: atEntry(E1),
  })
  assert.deepEqual(planAttach(none, ROOT), { kind: "create", at: ROOT })
  assert.deepEqual(planAttach(none, { kind: "tip" }), {
    kind: "create",
    at: ROOT,
  })

  // Already there: stay. pi refuses to navigate to the current tip
  // (`current_tip`), so this must never become a navigate.
  assert.deepEqual(planAttach(atE1, atEntry(E1)), { kind: "stay" })
  assert.deepEqual(planAttach(atRoot, ROOT), { kind: "stay" })
  assert.deepEqual(planAttach(atE1, { kind: "tip" }), { kind: "stay" })

  // Elsewhere: navigate.
  assert.deepEqual(planAttach(atE1, atEntry(E2)), {
    kind: "navigate",
    to: atEntry(E2),
  })
  assert.deepEqual(planAttach(atRoot, atEntry(E1)), {
    kind: "navigate",
    to: atEntry(E1),
  })
  assert.deepEqual(planAttach(atE1, ROOT), { kind: "navigate", to: ROOT })
})

test("latestTip: the newest tip by id, independent of input order", () => {
  // Out of id order on purpose: a helper that returned the first or last tip
  // would pass an in-order input.
  assert.equal(latestTip(["b-2", null, "c-3", "a-1"]), "c-3")
  assert.equal(latestTip(["c-3", "a-1", "b-2"]), "c-3")
  assert.equal(latestTip([null, null]), null, "lanes with no tip are ignored")
  assert.equal(latestTip([]), null, "an empty session has no view")
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
    c: {
      id: "c",
      parentId: "b",
      type: "message",
      seq: 1,
      message: { role: "assistant", content: "three" },
    },
    a: {
      id: "a",
      parentId: null,
      type: "message",
      seq: 9,
      message: { role: "user", content: "one" },
    },
    b: {
      id: "b",
      parentId: "a",
      type: "message",
      seq: 5,
      message: { role: "user", content: "two" },
    },
  }
  const out = projectTranscript(entries, "c")
  assert.deepEqual(
    out.map(m => m.text),
    ["one", "two", "three"],
  )
})

test("projectTranscript: an abandoned branch is not on the tip's path", () => {
  const entries = {
    a: {
      id: "a",
      parentId: null,
      type: "message",
      message: { role: "user", content: "root" },
    },
    b: {
      id: "b",
      parentId: "a",
      type: "message",
      message: { role: "assistant", content: "kept" },
    },
    x: {
      id: "x",
      parentId: "a",
      type: "message",
      message: { role: "assistant", content: "abandoned" },
    },
  }
  assert.deepEqual(
    projectTranscript(entries, "b").map(m => m.text),
    ["root", "kept"],
  )
})

test("projectTranscript: non-message entries and unknown roles are dropped", () => {
  const entries = {
    a: {
      id: "a",
      parentId: null,
      type: "message",
      message: { role: "user", content: "hi" },
    },
    m: { id: "m", parentId: "a", type: "custom", customType: "acp:plan" },
    s: {
      id: "s",
      parentId: "m",
      type: "message",
      message: { role: "toolResult", content: "noise" },
    },
  }
  assert.deepEqual(
    projectTranscript(entries, "s").map(m => m.role),
    ["user"],
  )
})

test("projectTranscript: a cycle is reported, not spun on", () => {
  const entries = {
    a: {
      id: "a",
      parentId: "b",
      type: "message",
      message: { role: "user", content: "a" },
    },
    b: {
      id: "b",
      parentId: "a",
      type: "message",
      message: { role: "user", content: "b" },
    },
  }
  assert.throws(() => projectTranscript(entries, "a"), /cycle/)
})

test("messageText: flattens pi's content parts", () => {
  assert.equal(messageText({ content: "plain" }), "plain")
  assert.equal(
    messageText({
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    }),
    "ab",
  )
  assert.equal(messageText({ content: [{ type: "image" }] }), "")
  assert.equal(messageText(undefined), "")
})

test("compareVersions / checkEnvironment: the deterministic build guards", () => {
  assert.equal(compareVersions("1.16.3", "1.13.4"), 1)
  assert.equal(compareVersions("1.13.4", "1.13.4"), 0)
  assert.equal(compareVersions("1.10.8", "1.13.4"), -1)
  assert.equal(compareVersions("1.9", "1.10"), -1, "numeric, not lexical")

  assert.equal(
    checkEnvironment({ hasStepInPlace: true, loroVersion: "1.16.3" }).ok,
    true,
  )
  // Published @kyneta/schema 3.0.0 lacks stepInPlace — that is the whole point.
  assert.match(
    firstProblem(
      checkEnvironment({ hasStepInPlace: false, loroVersion: "1.16.3" }),
    ),
    /stepInPlace/,
  )
  assert.match(
    firstProblem(
      checkEnvironment({ hasStepInPlace: true, loroVersion: "1.10.8" }),
    ),
    /below the 1.13.4 floor/,
  )
})
