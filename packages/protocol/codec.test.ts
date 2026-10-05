// The protocol codec: the one place wire sentinels are understood.
//
// It owns every SHAPE rule. These cases moved here from planCommand's tests
// when the rules did, and keep their meaning: in particular, empty text is
// still reported ahead of a missing parent.

import assert from "node:assert/strict"
import {
  atEntry,
  cardId,
  commitId,
  ERR,
  entryId,
  laneNameForThread,
  type Move,
  ROOT,
  rootIdFor,
  runId,
  THE_AGENT,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { test } from "vitest"
import {
  decodeCommand,
  decodeKey,
  decodeReply,
  encodeIntent,
  encodeKey,
  encodeMoves,
  encodeOutcome,
  MAX_TRACES_SEEN,
  type Outcome,
  revOfReply,
} from "./codec.ts"
import { command, EMPTY_COMMAND, OUTCOME_KINDS, reply } from "./messages.ts"

const TEST_ROOT = rootIdFor("test-root")
const NEW_ROOT = rootIdFor("01a0f9eb-86e1-77ad-a822-2a3067862240")

const NEW_LANE = laneNameForThread("01a0f9eb-86e1-77ad-a822-2a306786223f")
/** What an offer integration was shown: a ledger, conflicting. */
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
  })
  assert.equal(branch.kind === "chat" ? branch.at.kind : "", "root")
  assert.equal(
    refusalCode(
      decodeCommand({ kind: "chat", text: "hi", parentId: "", mode: "reply" }),
    ),
    ERR.NO_ANCHOR,
  )
})

test("decode: a chat names its root (ADR-0063): a new one, minted, at the root; one it is in, at an entry", () => {
  const at = (parentId: string, root: string) =>
    decodeCommand({ kind: "chat", text: "hi", parentId, root, mode: "branch" })
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

test("decode: the update command is gone (ADR-0055): an unknown kind", () => {
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
      at: ROOT,
      mode: "branch",
      lane: null,
      asksAgent: true,
      mentions: [{ kind: "agent", agent: THE_AGENT }],
      work: null,
      card: null,
      pinned: [],
      reserved: NEW_LANE,
      base: "wip/search",
      state: workflowStateIdFor("doing"),
    },
    {
      kind: "chat",
      text: "hi @bob",
      root: TEST_ROOT,
      at: atEntry(entryId("e-5")),
      mode: "reply",
      lane: laneNameForThread("abc"),
      asksAgent: false,
      mentions: [{ kind: "person", name: "bob" }],
      work: { kind: "own" },
      card: { id: cardId("c-7"), seen: "v-1" },
      pinned: [
        { id: cardId("c-8"), seen: "v-2" },
        { id: cardId("c-9"), seen: "" },
      ],
      reserved: null,
      base: null,
      state: null,
    },
    {
      kind: "chat",
      text: "aside",
      root: TEST_ROOT,
      at: atEntry(entryId("e-3")),
      mode: "branch",
      lane: null,
      asksAgent: false,
      mentions: [],
      work: { kind: "direct", dir: "/tmp/elsewhere" },
      card: null,
      pinned: [],
      reserved: null,
      base: null,
      state: null,
    },
    { kind: "name", name: "Alice" },
    { kind: "stop", lane: laneNameForThread("abc") },
    { kind: "carry-on", lane: laneNameForThread("abc") },
    {
      kind: "move-root",
      root: TEST_ROOT,
      from: workflowStateIdFor("a"),
      to: workflowStateIdFor("b"),
      before: null,
    },
    {
      kind: "move-root",
      root: TEST_ROOT,
      from: workflowStateIdFor("a"),
      to: workflowStateIdFor("a"),
      before: NEW_ROOT,
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
      root: TEST_ROOT,
      entry: entryId("e-1"),
      title: "Tab names",
    },
    { kind: "mark", root: TEST_ROOT, entry: entryId("e-1"), title: null },
    { kind: "retitle", root: TEST_ROOT },
    {
      kind: "offer",
      lane: laneNameForThread("abc"),
      action: "integrate",
      to: null,
      seen: { ledger: null, conflicted: false },
    },
    {
      kind: "offer",
      lane: laneNameForThread("abc"),
      action: "integrate",
      to: "wip/search",
      seen: SEEN,
    },
    {
      kind: "offer",
      lane: laneNameForThread("abc"),
      action: "squash",
      to: null,
      seen: null,
    },
    { kind: "line", action: "setup" },
    { kind: "line", action: "publish" },
    { kind: "reserve", lane: NEW_LANE },
    {
      kind: "move",
      moves: [
        {
          card: cardId("c-7"),
          from: null,
          to: { kind: "fresh", column: "k-1", root: TEST_ROOT, at: ROOT },
        },
      ],
    },
    {
      kind: "move",
      moves: [
        {
          card: cardId("c-7"),
          from: {
            kind: "drafting",
            root: TEST_ROOT,
            at: atEntry(entryId("e-5")),
            lane: laneNameForThread("abc"),
          },
          to: {
            kind: "queued",
            root: TEST_ROOT,
            at: atEntry(entryId("e-5")),
            lane: laneNameForThread("abc"),
            seen: "v-2",
          },
        },
      ],
    },
    {
      kind: "move",
      moves: [
        {
          card: cardId("c-7"),
          from: {
            kind: "drafting",
            root: TEST_ROOT,
            at: atEntry(entryId("e-5")),
            lane: null,
          },
          to: null,
        },
      ],
    },
    {
      kind: "move",
      moves: [
        {
          card: cardId("c-7"),
          from: { kind: "fresh", column: "k-1", root: TEST_ROOT, at: ROOT },
          to: { kind: "inventory", holder: writerId("ada@example.com") },
        },
      ],
    },
    {
      kind: "move",
      moves: ["c-7", "c-8"].map(
        (id): Move => ({
          card: cardId(id),
          from: { kind: "fresh", column: "k-1", root: TEST_ROOT, at: ROOT },
          to: { kind: "inventory", holder: writerId("ada@example.com") },
        }),
      ),
    },
    { kind: "undo-move", root: TEST_ROOT, direction: "undo" },
    { kind: "undo-move", root: TEST_ROOT, direction: "redo" },
    { kind: "set-command", card: cardId("c-7"), command: "bring-up-to-date" },
    { kind: "set-command", card: cardId("c-7"), command: null },
    { kind: "traces-seen", traces: ["t-1", "t-2"] },
    { kind: "queue-hold", lane: laneNameForThread("abc"), held: true },
    { kind: "queue-hold", lane: laneNameForThread("abc"), held: false },
    { kind: "unqueue-all", lane: laneNameForThread("abc") },
    {
      kind: "reorder",
      reorder: {
        card: cardId("c-7"),
        at: {
          kind: "queued",
          root: TEST_ROOT,
          at: atEntry(entryId("e-1")),
          lane: laneNameForThread("abc"),
          seen: "v1",
        },
        after: cardId("c-6"),
        before: null,
      },
    },
    {
      kind: "reorder",
      reorder: {
        card: cardId("c-7"),
        at: {
          kind: "pinned",
          root: TEST_ROOT,
          at: atEntry(entryId("e-1")),
          lane: null,
        },
        after: null,
        before: cardId("c-8"),
      },
    },
  ] as const
  for (const intent of intents) {
    assert.deepEqual(decodeCommand(encodeIntent("c-1", intent)), intent)
  }
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
        pinned,
      }),
    )
  for (const bad of [
    "{",
    '{"card":"c-1"}',
    '[{"card":"c-1"}]',
    '[{"card":"","seen":""}]',
  ])
    assert.equal(chat(bad).kind, "refused")
  assert.equal(chat("").kind, "chat")
})

test("an offer integration that does not say which offer it was shown, well formed, is refused", () => {
  const integrate = (seen: string) =>
    decodeCommand({
      ...EMPTY_COMMAND,
      kind: "offer",
      lane: laneNameForThread("abc"),
      mode: "integrate",
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
    assert.equal((integrate(bad) as { kind: string }).kind, "refused", bad)
  assert.deepEqual(integrate(JSON.stringify(SEEN)), {
    kind: "offer",
    lane: laneNameForThread("abc"),
    action: "integrate",
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
    { kind: "stopped" },
    { kind: "moved-root" },
    { kind: "workflow-changed" },
    { kind: "marked" },
    { kind: "retitling" },
    { kind: "integrated" },
    { kind: "offered" },
    { kind: "reserved" },
    { kind: "seen" },
    { kind: "line-moved" },
    { kind: "queued" },
    { kind: "moved" },
    { kind: "held" },
    { kind: "released" },
    {
      kind: "undone",
      cards: [
        {
          card: cardId("c-1"),
          place: { kind: "fresh", column: "k-1", root: TEST_ROOT, at: ROOT },
        },
        { card: cardId("c-2"), place: null },
      ],
    },
    { kind: "nothing" },
    {
      kind: "unmoved",
      code: "moved",
      place: { kind: "fresh", column: "k-1", root: TEST_ROOT, at: ROOT },
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
    { kind: "refused", code: ERR.ARCHIVED, message: "archived by Bea" },
    { kind: "refused", code: ERR.ROOT_BUSY, message: "busy" },
    { kind: "failed", message: "writeValues is not in this port" },
  ]
  for (const outcome of outcomes) {
    assert.deepEqual(decodeReply(encodeOutcome("c-1", outcome)), outcome)
  }
  // A kind added to the wire without a case here fails this, not silence.
  assert.deepEqual(new Set(outcomes.map(o => o.kind)), new Set(OUTCOME_KINDS))
})

test("a reply carries the places document's rev when its step wrote it; none is null", () => {
  assert.equal(revOfReply(encodeOutcome("c", { kind: "moved" }, 7)), 7)
  assert.equal(revOfReply(encodeOutcome("c", { kind: "named" })), null)
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
    at: ROOT,
  } as const
  assert.deepEqual(decodeKey(encodeKey(fresh)), fresh)
  const pinned = {
    kind: "pinned",
    root: TEST_ROOT,
    at: atEntry(entryId("e-1")),
    lane: laneNameForThread("x"),
  } as const
  assert.deepEqual(decodeKey(encodeKey(pinned)), pinned)
  // A fresh key with no root names no place the host can record.
  assert.equal(decodeKey('{"kind":"fresh","column":"k"}'), undefined)
})

test("decode: a move needs its cards, each with a place; set-command a known command; an undo a root and a direction", () => {
  const fresh = {
    kind: "fresh",
    column: "k",
    root: TEST_ROOT,
    at: ROOT,
  } as const
  for (const wire of [
    { kind: "move", moves: encodeMoves([]) },
    { kind: "move", moves: "{" },
    { kind: "move", moves: JSON.stringify([{ card: "", to: null }]) },
    { kind: "move", moves: JSON.stringify([{ card: "c-1" }]) },
    {
      kind: "move",
      moves: JSON.stringify([{ card: "c-1", to: { kind: "x" } }]),
    },
    {
      kind: "move",
      moves: encodeMoves([
        { card: cardId("c-1"), from: null, to: fresh },
        { card: cardId("c-2"), from: null, to: null },
      ]),
    },
    { kind: "set-command", cardId: "c-1", mode: "pull" },
    { kind: "set-command", cardId: "" },
    { kind: "undo-move", root: "", mode: "undo" },
    { kind: "undo-move", root: TEST_ROOT, mode: "sideways" },
    // Land and follow are gone: a publish does both (ADR-0090).
    { kind: "line", mode: "land" },
    { kind: "line", mode: "follow" },
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

test("decode: a malformed reorder or queue hold is refused (ADR-0048 step 7)", () => {
  const queued = {
    kind: "queued",
    root: TEST_ROOT,
    at: "e-1",
    lane: laneNameForThread("abc"),
    seen: "",
  }
  const reorder = (cardId: string, moves: unknown) =>
    decodeCommand({ kind: "reorder", cardId, moves: JSON.stringify(moves) })
      .kind
  assert.equal(
    reorder("c-1", { at: queued, after: "c-2", before: "" }),
    "reorder",
  )
  assert.equal(reorder("", { at: queued, after: "c-2" }), "refused")
  assert.equal(reorder("c-1", { at: queued }), "refused")
  assert.equal(reorder("c-1", { at: queued, after: "c-1" }), "refused")
  assert.equal(
    reorder("c-1", { at: queued, after: "c-2", before: "c-2" }),
    "refused",
  )
  assert.equal(
    reorder("c-1", {
      at: { kind: "drafting", root: TEST_ROOT, at: "e-1", lane: "" },
      after: "c-2",
    }),
    "refused",
  )
  assert.equal(
    decodeCommand({
      kind: "queue-hold",
      lane: laneNameForThread("abc"),
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
      root: NEW_ROOT,
      cardId,
      seen: "v",
    })
  const card = (i: ReturnType<typeof chat>) =>
    "kind" in i && i.kind === "chat" ? i.card : "refused"
  assert.deepEqual(card(chat("c-1")), { id: "c-1", seen: "v" })
  assert.equal(card(chat("")), null)
  assert.equal(card(chat("  ")), null)
})

test("a move on the board names its root and its states; a workflow change, a known action and its state", () => {
  const move = (text: string, root: string = TEST_ROOT) =>
    refusalCode(decodeCommand({ kind: "move-root", root, text }))
  const states = { from: workflowStateIdFor("a"), to: workflowStateIdFor("b") }
  assert.equal(
    move(JSON.stringify({ ...states, before: null }), "e-1"),
    ERR.UNKNOWN_TARGET,
  )
  for (const bad of [
    "",
    "{",
    JSON.stringify({ from: "a", to: states.to, before: null }),
    JSON.stringify({ ...states, before: "e-1" }),
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
      state,
    })
  assert.equal(refusalCode(chat("doing")), ERR.UNKNOWN_STATE)
  assert.equal(refusalCode(chat("")), "not refused: chat")
})

test("a mark names its entry; its title is trimmed, blank clears, and a line break or 81 characters is refused", () => {
  assert.deepEqual(
    decodeCommand({
      kind: "mark",
      root: TEST_ROOT,
      targetId: "e-1",
      text: "  Tab names ",
    }),
    {
      kind: "mark",
      root: TEST_ROOT,
      entry: entryId("e-1"),
      title: "Tab names",
    },
  )
  assert.deepEqual(
    decodeCommand({ kind: "mark", root: TEST_ROOT, targetId: "e-1", text: "" }),
    {
      kind: "mark",
      root: TEST_ROOT,
      entry: entryId("e-1"),
      title: null,
    },
  )
  for (const text of ["two\nlines", "x".repeat(81)])
    assert.equal(
      refusalCode(
        decodeCommand({ kind: "mark", root: TEST_ROOT, targetId: "e-1", text }),
      ),
      ERR.INVALID_TITLE,
    )
  assert.equal(
    refusalCode(decodeCommand({ kind: "mark", targetId: "", text: "x" })),
    ERR.UNKNOWN_TARGET,
  )
})

test("a retitle names its root; anything else is refused", () => {
  assert.equal(
    refusalCode(decodeCommand({ kind: "retitle", root: "e-1" })),
    ERR.UNKNOWN_TARGET,
  )
})

test("working directly needs a directory; an unknown work kind is refused", () => {
  const base = {
    id: "c-2",
    kind: "chat",
    text: "go",
    parentId: "",
    root: NEW_ROOT,
    mode: "branch",
  }
  assert.equal(
    decodeCommand({ ...base, workKind: "direct", workDir: "" }).kind,
    "refused",
  )
  assert.equal(
    decodeCommand({ ...base, workKind: "elsewhere" }).kind,
    "refused",
  )
  assert.equal(decodeCommand({ ...base, workKind: "" }).kind, "chat")
})

test("decode: a reserved lane is a new thread's id, t- and a uuidv7, or none (ADR-0057)", () => {
  const chat = (reserved: string) =>
    decodeCommand({
      kind: "chat",
      text: "hi",
      mode: "branch",
      root: NEW_ROOT,
      reserved,
    })
  const reserve = (lane: string) => decodeCommand({ kind: "reserve", lane })
  const none = chat("")
  assert.equal(none.kind === "chat" ? none.reserved : "refused", null)
  for (const bad of [
    "t-abc",
    "w-someone",
    NEW_LANE.toUpperCase(),
    "t-01a0f9eb-86e1-47ad-a822-2a306786223f",
    `${NEW_LANE};rm`,
    "t-01a0f9eb 86e1-77ad-a822-2a306786223f",
  ]) {
    assert.equal(refusalCode(chat(bad)), ERR.UNKNOWN_TARGET, bad)
    assert.equal(refusalCode(reserve(bad)), ERR.UNKNOWN_TARGET, bad)
  }
})
