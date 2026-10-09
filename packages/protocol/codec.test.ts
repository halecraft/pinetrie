// The protocol codec: the one place wire sentinels are understood.
//
// It owns every SHAPE rule. These cases moved here from planCommand's tests
// when the rules did, and keep their meaning: in particular, empty text is
// still reported ahead of a missing parent.

import assert from "node:assert/strict"
import {
  atEntry,
  commitId,
  ERR,
  entryId,
  type Intent,
  type Move,
  noteColumnIdFor,
  ROOT,
  rootIdFor,
  runId,
  type Sha256,
  THE_AGENT,
  taskIdFor,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { test } from "vitest"
import {
  decodeCommand,
  decodeKey,
  decodeMoves,
  decodeReply,
  encodeIntent,
  encodeKey,
  encodeMoves,
  encodeOutcome,
  MAX_TRACES_SEEN,
  type Outcome,
  revOfReply,
} from "./codec.ts"
import { Command } from "./line.ts"
import { command, EMPTY_COMMAND, OUTCOME_KINDS, reply } from "./messages.ts"

const NEW_TASK = taskIdFor("01a0ffd2-4e7a-71c8-a970-306fa07d7f0a")
const TEST_THREAD = threadIdFor("e")
const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const TEST_ROOT = rootIdFor("test-root")
const NEW_ROOT = rootIdFor("01a0f9eb-86e1-77ad-a822-2a3067862240")

const NEW_THREAD = threadIdFor("01a0f9eb-86e1-77ad-a822-2a306786223f")
/** What an acceptance was shown: a ledger, conflicting. */
const SEEN = {
  ledger: { source: commitId("a1"), start: [commitId("b2"), commitId("c3")] },
  conflicted: true,
}

const refusalCode = (x: ReturnType<typeof decodeCommand>) =>
  x.kind === "refused" ? x.code : `not refused: ${x.kind}`

test('decode: parentId "" is the root, where only a branch starts a thread', () => {
  const branch = decodeCommand({
    kind: "chat",
    text: "hi",
    parentId: "",
    root: NEW_ROOT,
    mode: "branch",
    task: NEW_TASK,
    lane: NEW_THREAD,
  })
  assert.deepEqual(branch.kind === "chat" ? branch.at : null, {
    kind: "branch",
    thread: NEW_THREAD,
    at: null,
    task: NEW_TASK,
  })
  assert.equal(
    refusalCode(
      decodeCommand({
        kind: "chat",
        text: "hi",
        parentId: "",
        mode: "reply",
        lane: NEW_THREAD,
      }),
    ),
    ERR.NO_ANCHOR,
  )
})

test("decode: a reply continues the thread it names, from the end its sender saw (ADR-0117)", () => {
  const reply = decodeCommand({
    kind: "chat",
    text: "hi",
    parentId: "e-1",
    root: TEST_ROOT,
    mode: "reply",
    lane: "t-abc",
  })
  assert.deepEqual(reply.kind === "chat" ? reply.at : null, {
    kind: "end",
    thread: threadIdFor("abc"),
    seen: entryId("e-1"),
  })
})

test("decode: a chat names its root (ADR-0063): a new one, minted, at the root; one it is in, at an entry", () => {
  const at = (parentId: string, root: string) =>
    decodeCommand({
      kind: "chat",
      text: "hi",
      parentId,
      root,
      mode: "branch",
      task: NEW_TASK,
      lane: NEW_THREAD,
    })
  assert.equal(at("", NEW_ROOT).kind, "chat")
  assert.equal(refusalCode(at("", TEST_ROOT)), ERR.UNKNOWN_TARGET)
  assert.equal(at("e-1", TEST_ROOT).kind, "chat")
  assert.equal(refusalCode(at("e-1", "")), ERR.UNKNOWN_TARGET)
})

test("decode: queue is the host's own mode, never a client's (ADR-0048)", () => {
  assert.equal(
    refusalCode(
      decodeCommand({
        kind: "chat",
        text: "hi",
        parentId: "e-1",
        mode: "queue",
      }),
    ),
    ERR.UNKNOWN_KIND,
  )
})

test("decode: the update command is gone (ADR-0108): an unknown kind", () => {
  assert.equal(
    refusalCode(decodeCommand({ kind: "update", lane: "lane:abc" })),
    ERR.UNKNOWN_KIND,
  )
})

test("decode: thread defaults are gone; a lane must be a thread's", () => {
  assert.equal(
    refusalCode(
      decodeCommand({ kind: "thread", text: "session", parentId: "e-1" }),
    ),
    ERR.UNKNOWN_KIND,
  )
  assert.equal(
    refusalCode(
      decodeCommand({
        kind: "chat",
        text: "hi",
        parentId: "e-1",
        mode: "reply",
        lane: "w-someone",
      }),
    ),
    ERR.UNKNOWN_TARGET,
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
      root: NEW_ROOT,
      at: { kind: "branch", thread: NEW_THREAD, at: null, task: NEW_TASK },
      asksAgent: true,
      mentions: [{ kind: "agent", agent: THE_AGENT }],
      card: null,
      pinned: [],
      base: "wip/search",
      state: workflowStateIdFor("doing"),
    },
    {
      kind: "chat",
      text: "hi @bob",
      root: TEST_ROOT,
      at: { kind: "end", thread: threadIdFor("abc"), seen: entryId("e-5") },
      asksAgent: false,
      mentions: [{ kind: "person", name: "bob" }],
      card: {
        id: cardIdFor("c7"),
        seen: "v-1",
      },
      pinned: [
        { id: cardIdFor("c8"), seen: "v-2" },
        { id: cardIdFor("c9"), seen: "" },
      ],
      base: null,
      state: null,
    },
    {
      kind: "chat",
      text: "aside",
      root: TEST_ROOT,
      at: {
        kind: "branch",
        thread: NEW_THREAD,
        at: entryId("e-3"),
        task: NEW_TASK,
      },
      asksAgent: false,
      mentions: [],
      card: null,
      pinned: [],
      base: null,
      state: null,
    },
    { kind: "name", name: "Alice" },
    { kind: "picture", sha256: "d".repeat(64) as Sha256 },
    { kind: "picture", sha256: null },
    { kind: "stop", lane: threadIdFor("abc") },
    { kind: "carry-on", lane: threadIdFor("abc") },
    {
      kind: "move-task",
      task: TEST_TASK,
      from: workflowStateIdFor("a"),
      to: workflowStateIdFor("b"),
      before: null,
    },
    {
      kind: "move-task",
      task: TEST_TASK,
      from: workflowStateIdFor("a"),
      to: workflowStateIdFor("a"),
      before: NEW_TASK,
    },
    {
      kind: "workflow",
      edit: { action: "add", state: null, name: "Review", before: null },
    },
    {
      kind: "workflow",
      edit: {
        action: "move",
        state: workflowStateIdFor("a"),
        name: "",
        before: workflowStateIdFor("b"),
      },
    },
    {
      kind: "mark",
      of: { kind: "task", task: TEST_TASK },
      title: "Tab names",
    },
    { kind: "mark", of: { kind: "task", task: TEST_TASK }, title: null },
    {
      kind: "mark",
      of: {
        kind: "note-column",
        column: noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1"),
      },
      title: "Ideas",
    },
    { kind: "retitle", task: TEST_TASK },
    {
      kind: "offer",
      lane: threadIdFor("abc"),
      action: "accept",
      to: null,
      seen: { ledger: null, conflicted: false },
    },
    {
      kind: "offer",
      lane: threadIdFor("abc"),
      action: "accept",
      to: "wip/search",
      seen: SEEN,
    },
    {
      kind: "offer",
      lane: threadIdFor("abc"),
      action: "squash",
      to: null,
      seen: null,
    },
    { kind: "setup" },
    { kind: "publish" },
    { kind: "reserve", lane: NEW_THREAD },
    {
      kind: "move",
      moves: [
        {
          card: cardIdFor("c7"),
          from: null,
          to: {
            kind: "fresh",
            column: "k-1",
            root: TEST_ROOT,
            task: TEST_TASK,
            at: ROOT,
          },
        },
      ],
      here: null,
    },
    {
      kind: "queue-card",
      move: {
        card: cardIdFor("c7"),
        from: {
          kind: "composing",
          at: atEntry(entryId("e-5")),
          thread: threadIdFor("abc"),
        },
        to: {
          kind: "queued",
          at: atEntry(entryId("e-5")),
          thread: threadIdFor("abc"),
          seen: "v-2",
        },
      },
      hold: "release",
      command: null,
    },
    {
      kind: "queue-card",
      move: {
        card: cardIdFor("c8"),
        from: null,
        to: {
          kind: "queued",
          at: atEntry(entryId("e-5")),
          thread: threadIdFor("abc"),
          seen: "",
        },
      },
      hold: "keep",
      command: "split",
    },
    {
      kind: "move",
      moves: [
        {
          card: cardIdFor("c7"),
          from: {
            kind: "composing",
            at: atEntry(entryId("e-5")),
            thread: TEST_THREAD,
          },
          to: { kind: "gone", why: { kind: "discarded" } },
        },
        {
          card: cardIdFor("c8"),
          from: { kind: "inventory", holder: writerId("ada@example.com") },
          to: { kind: "gone", why: { kind: "discarded" } },
        },
      ],
      here: TEST_TASK,
    },
    {
      kind: "spin-off",
      move: {
        card: cardIdFor("c9"),
        from: { kind: "inventory", holder: writerId("ada@example.com") },
        to: {
          kind: "gone",
          why: {
            kind: "spun",
            into: rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff"),
            thread: NEW_THREAD,
          },
        },
      },
      task: NEW_TASK,
      state: null,
      here: TEST_TASK,
    },
    {
      kind: "move",
      moves: [
        {
          card: cardIdFor("c7"),
          from: {
            kind: "fresh",
            column: "k-1",
            root: TEST_ROOT,
            task: TEST_TASK,
            at: ROOT,
          },
          to: { kind: "inventory", holder: writerId("ada@example.com") },
        },
      ],
      here: null,
    },
    {
      kind: "move",
      moves: [cardIdFor("c7"), cardIdFor("c8")].map(
        (id): Move => ({
          card: textCardId(id),
          from: {
            kind: "fresh",
            column: "k-1",
            root: TEST_ROOT,
            task: TEST_TASK,
            at: ROOT,
          },
          to: { kind: "inventory", holder: writerId("ada@example.com") },
        }),
      ),
      here: null,
    },
    { kind: "undo-move", task: TEST_TASK, direction: "undo" },
    { kind: "undo-move", task: TEST_TASK, direction: "redo" },
    {
      kind: "set-command",
      card: cardIdFor("c7"),
      command: "bring-up-to-date",
    },
    {
      kind: "set-command",
      card: cardIdFor("c7"),
      command: null,
    },
    { kind: "traces-seen", traces: ["t-1", "t-2"] },
    { kind: "queue-hold", lane: threadIdFor("abc"), held: true },
    { kind: "queue-hold", lane: threadIdFor("abc"), held: false },
    { kind: "unqueue-all", lane: threadIdFor("abc") },
    {
      kind: "reorder",
      reorder: {
        card: cardIdFor("c7"),
        at: {
          kind: "queued",
          at: atEntry(entryId("e-1")),
          thread: threadIdFor("abc"),
          seen: "v1",
        },
        after: cardIdFor("c6"),
        before: null,
      },
    },
    {
      kind: "reorder",
      reorder: {
        card: cardIdFor("c7"),
        at: {
          kind: "pinned",
          at: atEntry(entryId("e-1")),
          thread: TEST_THREAD,
        },
        after: null,
        before: cardIdFor("c8"),
      },
    },
  ] as const satisfies readonly Intent[]
  for (const intent of intents) {
    assert.deepEqual(
      decodeCommand(encodeIntent(cardIdFor("c1"), intent)),
      intent,
    )
  }
})

test("a picture names a stored image's hash, or none (ADR-0098); anything else is refused", () => {
  const picture = (text: string) =>
    decodeCommand(command({ id: "c", kind: "picture", text }))
  assert.deepEqual(picture(""), { kind: "picture", sha256: null })
  for (const bad of ["d".repeat(63), "D".repeat(64), "not a hash"])
    assert.equal(picture(bad).kind, "refused")
})

test("a chat's malformed pinned cards are refused", () => {
  const chat = (pinned: string) =>
    decodeCommand(
      command({
        id: "c",
        kind: "chat",
        text: "hi",
        parentId: "e-1",
        root: TEST_ROOT,
        mode: "reply",
        lane: "t-abc",
        pinned,
      }),
    )
  for (const bad of [
    "{",
    '{"card":cardIdFor("c1")}',
    '[{"card":cardIdFor("c1")}]',
    '[{"card":"","seen":""}]',
  ])
    assert.equal(chat(bad).kind, "refused")
  assert.equal(chat("").kind, "chat")
})

test("an acceptance that does not say which offer it was shown, well formed, is refused", () => {
  const accept = (seen: string) =>
    decodeCommand({
      ...EMPTY_COMMAND,
      kind: "offer",
      lane: threadIdFor("abc"),
      mode: "accept",
      seen,
    })
  for (const bad of [
    "",
    "nonsense",
    "{}",
    '{"ledger":null}',
    '{"ledger":{"source":"a1","start":[]},"conflicted":false}',
    '{"ledger":{"source":"not a commit","start":["a1"]},"conflicted":false}',
  ])
    assert.equal((accept(bad) as { kind: string }).kind, "refused", bad)
  assert.deepEqual(accept(JSON.stringify(SEEN)), {
    kind: "offer",
    lane: threadIdFor("abc"),
    action: "accept",
    to: null,
    seen: SEEN,
  })
})

test("encodeOutcome -> decodeReply round-trips every outcome", () => {
  const outcomes: Outcome[] = [
    { kind: "started", runId: runId("r-1") },
    { kind: "busy" },
    { kind: "conflict", by: writerId("bea@example.com") },
    { kind: "conflict", by: null },
    { kind: "appended", id: entryId("e-1") },
    { kind: "named" },
    { kind: "pictured" },
    { kind: "stopped" },
    { kind: "moved-task" },
    { kind: "workflow-changed" },
    { kind: "marked" },
    { kind: "retitling" },
    { kind: "accepted" },
    { kind: "offered" },
    { kind: "reserved" },
    { kind: "seen" },
    { kind: "accepted-moved" },
    { kind: "queued" },
    { kind: "moved" },
    { kind: "held" },
    { kind: "released" },
    {
      kind: "undone",
      cards: [
        {
          card: cardIdFor("c1"),
          place: {
            kind: "fresh",
            column: "k-1",
            root: TEST_ROOT,
            task: TEST_TASK,
            at: ROOT,
          },
        },
        {
          card: cardIdFor("c2"),
          place: null,
        },
      ],
    },
    { kind: "nothing" },
    {
      kind: "unmoved",
      code: "moved",
      place: {
        kind: "fresh",
        column: "k-1",
        root: TEST_ROOT,
        task: TEST_TASK,
        at: ROOT,
      },
      by: writerId("bea@example.com"),
    },
    { kind: "unmoved", code: "gone", place: null, by: null },
    { kind: "unmoved", code: "order-changed", place: null, by: null },
    {
      kind: "unmoved",
      code: "not-yours",
      place: { kind: "inventory", holder: writerId("bea@example.com") },
      by: writerId("bea@example.com"),
    },
    { kind: "unmoved", code: "full", place: null, by: null },
    { kind: "refused", code: ERR.TASK_ARCHIVED, message: "archived by Bea" },
    { kind: "refused", code: ERR.TASK_BUSY, message: "busy" },
    { kind: "failed", message: "writeValues is not in this port" },
  ]
  for (const outcome of outcomes) {
    assert.deepEqual(
      decodeReply(encodeOutcome(cardIdFor("c1"), outcome)),
      outcome,
    )
  }
  // A kind added to the wire without a case here fails this, not silence.
  assert.deepEqual(new Set(outcomes.map(o => o.kind)), new Set(OUTCOME_KINDS))
})

test("a reply carries the places document's rev when its step wrote it; none is null", () => {
  assert.equal(revOfReply(encodeOutcome("c", { kind: "moved" }, 7)), 7)
  assert.equal(revOfReply(encodeOutcome("c", { kind: "named" })), null)
})

test("a note's key carries its column, and a thread's nearest notes its thread (ADR-0116)", () => {
  const note = {
    kind: "note",
    column: noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1"),
  } as const
  assert.deepEqual(decodeKey(encodeKey(note)), note)
  assert.equal(decodeKey('{"kind":"note","column":"t-x"}'), undefined)
  // A thread's nearest notes: a move's target, and no place.
  const notes = { kind: "notes", thread: TEST_THREAD } as const
  const moves = decodeMoves(
    encodeMoves([
      {
        card: cardIdFor("c1"),
        from: note,
        to: notes,
      },
    ]),
  )
  assert.ok(typeof moves !== "string" && moves[0]?.to.kind === "notes")
  assert.equal(decodeKey('{"kind":"notes","lane":"t-x"}'), undefined)
})

test("decode: a mark names a task or a note column, never both or neither (ADR-0116)", () => {
  const N = noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
  assert.equal(
    refusalCode(decodeCommand({ kind: "mark", task: TEST_TASK, cardId: N })),
    ERR.UNKNOWN_TARGET,
  )
  assert.equal(
    refusalCode(decodeCommand({ kind: "mark", text: "x" })),
    ERR.UNKNOWN_TARGET,
  )
})

test('decodeKey: "" is none; anything malformed is undefined', () => {
  assert.equal(decodeKey(""), null)
  for (const bad of [
    "{",
    "7",
    '{"kind":"pinned"}',
    '{"kind":"queued","at":"e-1","lane":"main"}',
    '{"kind":"inventory","holder":""}',
  ])
    assert.equal(decodeKey(bad), undefined)
  const fresh = {
    kind: "fresh",
    column: "k",
    root: TEST_ROOT,
    task: TEST_TASK,
    at: ROOT,
  } as const
  assert.deepEqual(decodeKey(encodeKey(fresh)), fresh)
  const pinned = {
    kind: "pinned",
    at: atEntry(entryId("e-1")),
    thread: threadIdFor("x"),
  } as const
  assert.deepEqual(decodeKey(encodeKey(pinned)), pinned)
  // A fresh key with no root names no place the host can record.
  assert.equal(decodeKey('{"kind":"fresh","column":"k"}'), undefined)
})

test("decode: a move needs its cards, each with a place, and its sender's task a task or none; set-command a known command; an undo a root and a direction", () => {
  const fresh = {
    kind: "fresh",
    column: "k",
    root: TEST_ROOT,
    task: TEST_TASK,
    at: ROOT,
  } as const
  for (const wire of [
    { kind: "move", moves: encodeMoves([]) },
    { kind: "move", moves: "{" },
    { kind: "move", moves: JSON.stringify([{ card: "", to: null }]) },
    {
      kind: "move",
      moves: JSON.stringify([{ card: cardIdFor("c1") }]),
    },
    {
      kind: "move",
      moves: JSON.stringify([{ card: cardIdFor("c1"), to: { kind: "x" } }]),
    },
    {
      kind: "move",
      moves: encodeMoves([
        {
          card: cardIdFor("c1"),
          from: null,
          to: fresh,
        },
        {
          card: cardIdFor("c2"),
          from: null,
          to: null as never,
        },
      ]),
    },
    {
      kind: "move",
      moves: encodeMoves([
        {
          card: cardIdFor("c1"),
          from: null,
          to: fresh,
        },
      ]),
      here: "r-not-a-task",
    },
    {
      kind: "set-command",
      cardId: cardIdFor("c1"),
      mode: "pull",
    },
    { kind: "set-command", cardId: "" },
    { kind: "undo-move", root: "", mode: "undo" },
    { kind: "undo-move", root: TEST_ROOT, mode: "sideways" },
    // Accepted work command is gone: setup and publish are commands of their own (ADR-0100).
    { kind: "line", mode: "publish" },
  ])
    assert.equal(decodeCommand(wire).kind, "refused")
})

test("decode: traces seen name 1 to MAX_TRACES_SEEN ids, none empty", () => {
  const seen = (ids: unknown) =>
    decodeCommand({ kind: "traces-seen", text: JSON.stringify(ids) }).kind
  assert.equal(seen(["t-1"]), "traces-seen")
  for (const ids of [
    [],
    [""],
    [1],
    "t-1",
    Array.from({ length: MAX_TRACES_SEEN + 1 }, (_, i) => `t-${i}`),
  ])
    assert.equal(seen(ids), "refused")
})

test("decodeReply: an unrecognised code stays inside the ErrCode set", () => {
  const wire = reply({ id: "c", outcome: "refused", errorCode: "made-up" })
  const out = decodeReply(wire)
  assert.equal(out.kind === "refused" ? out.code : "", ERR.UNKNOWN_KIND)
})

test("decode: a spin-off names one move, into a new thread, and a known state or none (ADR-0111)", () => {
  const spunTo = {
    kind: "spun",
    task: TEST_TASK,
    column: rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff"),
    lane: NEW_THREAD,
  }
  const from = { kind: "inventory", holder: "ada@example.com" }
  const moves = (to: unknown) =>
    JSON.stringify([{ card: cardIdFor("c1"), from, to }])
  assert.equal(
    decodeCommand({ kind: "spin-off", moves: moves(spunTo), task: NEW_TASK })
      .kind,
    "spin-off",
  )
  for (const wire of [
    {
      kind: "spin-off",
      moves: moves({ ...spunTo, kind: "discarded" }),
      task: NEW_TASK,
    },
    {
      kind: "spin-off",
      moves: moves({ ...spunTo, column: "" }),
      task: NEW_TASK,
    },
    { kind: "spin-off", moves: moves({ ...spunTo, lane: "" }), task: NEW_TASK },
    {
      kind: "spin-off",
      moves: moves(spunTo),
      state: "not a state",
      task: NEW_TASK,
    },
    // A spin-off starts a new task, under the id its tab minted.
    { kind: "spin-off", moves: moves(spunTo), task: "" },
  ])
    assert.equal(decodeCommand(wire).kind, "refused")
})

test("decode: a malformed reorder or queue hold is refused (ADR-0048 step 7)", () => {
  const queued = {
    kind: "queued",
    at: "e-1",
    lane: threadIdFor("abc"),
    seen: "",
  }
  const moves = JSON.stringify([
    { card: cardIdFor("c1"), from: null, to: queued },
  ])
  // One way into a queue (ADR-0113): `move` refuses it, `queue-card` takes
  // one move into a queue and a known hold change.
  assert.equal(decodeCommand({ kind: "move", moves }).kind, "refused")
  assert.equal(
    decodeCommand({ kind: "queue-card", moves, mode: "release" }).kind,
    "queue-card",
  )
  assert.equal(
    decodeCommand({ kind: "queue-card", moves, mode: "later" }).kind,
    "refused",
  )
  // A command rides only on a card made in the queue, and must be one.
  assert.equal(
    decodeCommand({ kind: "queue-card", moves, mode: "keep", targetId: "x" })
      .kind,
    "refused",
  )
  const lane = threadIdFor("abc")
  const at = atEntry(entryId("e-1"))
  const moved = encodeIntent("c", {
    kind: "queue-card",
    move: {
      card: cardIdFor("c1"),
      from: { kind: "composing", at, thread: lane },
      to: { kind: "queued", at, thread: lane, seen: "" },
    },
    hold: "keep",
    command: "split",
  })
  assert.equal(decodeCommand(moved).kind, "refused")
  assert.equal(decodeCommand({ ...moved, targetId: "" }).kind, "queue-card")
  assert.equal(
    decodeCommand({
      kind: "queue-card",
      moves: JSON.stringify([
        {
          card: cardIdFor("c1"),
          from: null,
          to: { kind: "inventory", holder: "w" },
        },
      ]),
      mode: "keep",
    }).kind,
    "refused",
  )
  const reorder = (cardId: string, moves: unknown) =>
    decodeCommand({ kind: "reorder", cardId, moves: JSON.stringify(moves) })
      .kind
  assert.equal(
    reorder(cardIdFor("c1"), {
      at: queued,
      after: cardIdFor("c2"),
      before: "",
    }),
    "reorder",
  )
  assert.equal(reorder("", { at: queued, after: cardIdFor("c2") }), "refused")
  // A reorder is in a queue, among pinned cards or in a note column alone.
  const note = {
    kind: "note",
    column: noteColumnIdFor("01a0ffd2-0000-7000-8000-0000000000a1"),
  }
  const after = cardIdFor("c2")
  assert.equal(reorder(cardIdFor("c1"), { at: note, after }), "reorder")
  assert.equal(
    reorder(cardIdFor("c1"), {
      at: { kind: "inventory", holder: "ada@example.com" },
      after,
    }),
    "refused",
  )
  assert.equal(reorder(cardIdFor("c1"), { at: queued }), "refused")
  assert.equal(
    reorder(cardIdFor("c1"), {
      at: queued,
      after: cardIdFor("c1"),
    }),
    "refused",
  )
  assert.equal(
    reorder(cardIdFor("c1"), {
      at: queued,
      after: cardIdFor("c2"),
      before: cardIdFor("c2"),
    }),
    "refused",
  )
  assert.equal(
    reorder(cardIdFor("c1"), {
      at: { kind: "composing", at: "e-1", thread: "" },
      after: cardIdFor("c2"),
    }),
    "refused",
  )
  assert.equal(
    decodeCommand({
      kind: "queue-hold",
      lane: threadIdFor("abc"),
      mode: "pause",
    }).kind,
    "refused",
  )
})

test("decode: stop and carry-on must name a thread's lane", () => {
  for (const kind of ["stop", "carry-on", "unqueue-all", "queue-hold"])
    assert.equal(
      refusalCode(decodeCommand({ kind, lane: "w-someone" })),
      ERR.UNKNOWN_TARGET,
    )
})

test("decode: notes on messages are gone (ADR-0048): a note command is an unknown kind", () => {
  for (const mode of ["open", "done", "reopen"])
    assert.equal(
      refusalCode(decodeCommand({ kind: "note", mode, parentId: "e-1" })),
      ERR.UNKNOWN_KIND,
    )
})

test("decode: a chat's card is its id and its text's version, or none", () => {
  const chat = (cardId: string) =>
    decodeCommand({
      kind: "chat",
      text: "hi",
      mode: "branch",
      task: NEW_TASK,
      root: NEW_ROOT,
      lane: NEW_THREAD,
      cardId,
      seen: "v",
    })
  const card = (i: ReturnType<typeof chat>) =>
    "kind" in i && i.kind === "chat" ? i.card : "refused"
  assert.deepEqual(card(chat(cardIdFor("c1"))), {
    id: cardIdFor("c1"),
    seen: "v",
  })
  assert.equal(card(chat("")), null)
  assert.equal(card(chat("  ")), null)
  // An id that is no text card's: a thread's, or no card's at all.
  assert.equal(card(chat(NEW_THREAD)), "refused")
  assert.equal(card(chat("c-1")), "refused")
})

test("decode: a move, a reorder or a command names a card by an id parseCardId takes", () => {
  const to = { kind: "inventory", holder: "w-ada@x.io" }
  assert.equal(
    typeof decodeMoves(JSON.stringify([{ card: "c-1", from: null, to }])),
    "string",
  )
  assert.equal(
    typeof decodeMoves(JSON.stringify([{ card: NEW_THREAD, from: null, to }])),
    "object",
  )
  assert.equal(
    refusalCode(decodeCommand({ kind: "set-command", cardId: "t", mode: "" })),
    ERR.UNKNOWN_TARGET,
  )
})

test("a move on the board names its task and its states; a workflow change, a known action and its state", () => {
  const move = (text: string, task: string = TEST_TASK) =>
    refusalCode(decodeCommand({ kind: "move-task", task, text }))
  const states = { from: workflowStateIdFor("a"), to: workflowStateIdFor("b") }
  assert.equal(
    move(JSON.stringify({ ...states, before: null }), TEST_ROOT),
    ERR.UNKNOWN_TARGET,
  )
  for (const bad of [
    "",
    "{",
    JSON.stringify({ from: "a", to: states.to, before: null }),
    JSON.stringify({ ...states, before: TEST_ROOT }),
    JSON.stringify({ ...states }),
  ])
    assert.equal(move(bad), ERR.UNKNOWN_STATE, bad)
  const workflow = (mode: string, targetId = "") =>
    refusalCode(decodeCommand({ kind: "workflow", mode, targetId, text: "x" }))
  assert.equal(workflow("delete"), ERR.UNKNOWN_KIND)
  assert.equal(workflow("rename"), ERR.UNKNOWN_STATE)
  assert.equal(workflow("rename", "doing"), ERR.UNKNOWN_STATE)
})

test("a chat's workflow state must be one", () => {
  const chat = (state: string) =>
    decodeCommand({
      ...EMPTY_COMMAND,
      kind: "chat",
      text: "hi",
      parentId: "",
      root: NEW_ROOT,
      mode: "branch",
      task: NEW_TASK,
      lane: NEW_THREAD,
      state,
    })
  assert.equal(refusalCode(chat("doing")), ERR.UNKNOWN_STATE)
  assert.equal(refusalCode(chat("")), "not refused: chat")
})

test("a mark names its task; its title is trimmed, blank clears, and a line break or 81 characters is refused", () => {
  assert.deepEqual(
    decodeCommand({ kind: "mark", task: TEST_TASK, text: "  Tab names " }),
    { kind: "mark", of: { kind: "task", task: TEST_TASK }, title: "Tab names" },
  )
  assert.deepEqual(decodeCommand({ kind: "mark", task: TEST_TASK, text: "" }), {
    kind: "mark",
    of: { kind: "task", task: TEST_TASK },
    title: null,
  })
  for (const text of ["two\nlines", "x".repeat(81)])
    assert.equal(
      refusalCode(decodeCommand({ kind: "mark", task: TEST_TASK, text })),
      ERR.INVALID_TITLE,
    )
  assert.equal(
    refusalCode(decodeCommand({ kind: "mark", task: TEST_ROOT, text: "x" })),
    ERR.UNKNOWN_TARGET,
  )
})

test("a retitle names its task; anything else is refused", () => {
  assert.equal(
    refusalCode(decodeCommand({ kind: "retitle", task: TEST_ROOT })),
    ERR.UNKNOWN_TARGET,
  )
  assert.deepEqual(decodeCommand({ kind: "retitle", task: TEST_TASK }), {
    kind: "retitle",
    task: TEST_TASK,
  })
})

test("decode: a branch's thread, and a reserved one, is a new thread's id, t- and a uuidv7 (ADR-0057, ADR-0117)", () => {
  const chat = (lane: string) =>
    decodeCommand({
      kind: "chat",
      text: "hi",
      mode: "branch",
      task: NEW_TASK,
      root: NEW_ROOT,
      lane,
    })
  const reserve = (lane: string) => decodeCommand({ kind: "reserve", lane })
  assert.equal(chat(NEW_THREAD).kind, "chat")
  for (const bad of [
    "",
    "t-abc",
    "w-someone",
    NEW_THREAD.toUpperCase(),
    "t-01a0f9eb-86e1-47ad-a822-2a306786223f",
    `${NEW_THREAD};rm`,
    "t-01a0f9eb 86e1-77ad-a822-2a306786223f",
  ]) {
    assert.equal(refusalCode(chat(bad)), ERR.UNKNOWN_TARGET, bad)
    assert.equal(refusalCode(reserve(bad)), ERR.UNKNOWN_TARGET, bad)
  }
})

test("the Line carries every field of a command, and no other: a field the wire's schema lacked would be dropped on the way", () => {
  assert.deepEqual(
    Object.keys(Command.fields).sort(),
    Object.keys(EMPTY_COMMAND).sort(),
  )
})
