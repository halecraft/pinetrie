// The codec's shape rules. Empty text is reported ahead of a missing parent.

import assert from "node:assert/strict"
import {
  type CardId,
  canvasIdFor,
  cardIdOfKind,
  commitId,
  ERR,
  entryId,
  type Intent,
  type MoveOf,
  type MoveTarget,
  type PlaceKey,
  pointId,
  printAddress,
  rootIdFor,
  runId,
  type Sha256,
  THE_AGENT,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { expect, test } from "vitest"
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

const NEW_CANVAS = canvasIdFor("01a0ffd2-4e7a-71c8-a970-306fa07d7f0a")
const TEST_THREAD = threadIdFor("e")
const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const TEST_ROOT = rootIdFor("test-root")
const NEW_ROOT = rootIdFor("01a0f9eb-86e1-77ad-a822-2a3067862240")

const NEW_THREAD = threadIdFor("01a0f9eb-86e1-77ad-a822-2a306786223f")
/** What an acceptance was shown: a ledger, conflicting. */
const SEEN = {
  kind: "jj",
  ledger: { source: commitId("a1"), start: [commitId("b2"), commitId("c3")] },
  conflicted: true,
} as const

const refusalCode = (x: ReturnType<typeof decodeCommand>) =>
  x.kind === "refused" ? x.code : `not refused: ${x.kind}`

test('decode: parentId "" is the root, where only a branch starts a thread', () => {
  const branch = decodeCommand({
    kind: "send",
    text: "hi",
    parentId: "",
    root: NEW_ROOT,
    mode: "branch",
    canvas: NEW_CANVAS,
    lane: NEW_THREAD,
  })
  assert.deepEqual(branch.kind === "send" ? branch.at : null, {
    kind: "branch",
    thread: NEW_THREAD,
    at: null,
    canvas: NEW_CANVAS,
  })
  assert.equal(
    refusalCode(
      decodeCommand({
        kind: "send",
        text: "hi",
        parentId: "",
        mode: "reply",
        lane: NEW_THREAD,
      }),
    ),
    ERR.NO_ANCHOR,
  )
})

test("decode: a reply continues the thread it names, from the end its sender saw", () => {
  const reply = decodeCommand({
    kind: "send",
    text: "hi",
    parentId: "e-1",
    root: TEST_ROOT,
    mode: "reply",
    lane: "t-abc",
  })
  assert.deepEqual(reply.kind === "send" ? reply.at : null, {
    kind: "end",
    thread: threadIdFor("abc"),
    seen: entryId("e-1"),
  })
})

test("decode: a chat names its root: a new one, minted, at the root; one it is in, at an entry", () => {
  const at = (parentId: string, root: string) =>
    decodeCommand({
      kind: "send",
      text: "hi",
      parentId,
      root,
      mode: "branch",
      canvas: NEW_CANVAS,
      lane: NEW_THREAD,
    })
  assert.equal(at("", NEW_ROOT).kind, "send")
  assert.equal(refusalCode(at("", TEST_ROOT)), ERR.UNKNOWN_TARGET)
  assert.equal(at("e-1", TEST_ROOT).kind, "send")
  assert.equal(refusalCode(at("e-1", "")), ERR.UNKNOWN_TARGET)
})

test("decode: queue is the host's own mode, never a client's", () => {
  assert.equal(
    refusalCode(
      decodeCommand({
        kind: "send",
        text: "hi",
        parentId: "e-1",
        mode: "queue",
      }),
    ),
    ERR.UNKNOWN_KIND,
  )
})

test("decode: an update command is an unknown kind", () => {
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
        kind: "send",
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
    refusalCode(decodeCommand({ kind: "send", text: "  ", mode: "reply" })),
    ERR.EMPTY_MESSAGE,
  )
  assert.equal(
    refusalCode(decodeCommand({ kind: "send", text: "hi", mode: "shout" })),
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

const REFERENCE = cardIdOfKind(
  "reference",
  "01a0ffd2-0000-7000-8000-0000000000e1",
)

test("encodeIntent -> decodeCommand round-trips every intent", () => {
  const intents = [
    {
      kind: "send",
      text: "hi @agent",
      root: NEW_ROOT,
      at: { kind: "branch", thread: NEW_THREAD, at: null, canvas: NEW_CANVAS },
      mentions: [{ kind: "agent", agent: THE_AGENT }],
      card: null,
      pinned: [],
      base: "wip/search",
      state: workflowStateIdFor("doing"),
    },
    {
      kind: "send",
      text: "hi @bob",
      root: TEST_ROOT,
      at: { kind: "end", thread: threadIdFor("abc"), seen: entryId("e-5") },
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
      kind: "send",
      text: "aside",
      root: TEST_ROOT,
      at: {
        kind: "branch",
        thread: NEW_THREAD,
        at: entryId("e-3"),
        canvas: NEW_CANVAS,
      },
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
      kind: "move-canvas",
      canvas: TEST_CANVAS,
      from: workflowStateIdFor("a"),
      to: workflowStateIdFor("b"),
      before: null,
    },
    {
      kind: "move-canvas",
      canvas: TEST_CANVAS,
      from: workflowStateIdFor("a"),
      to: workflowStateIdFor("a"),
      before: NEW_CANVAS,
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
      of: { kind: "canvas", canvas: TEST_CANVAS },
      title: "Tab names",
    },
    { kind: "mark", of: { kind: "canvas", canvas: TEST_CANVAS }, title: null },
    {
      kind: "mark",
      of: {
        kind: "note-column",
        column: cardIdOfKind(
          "note-column",
          "01a0ffd2-0000-7000-8000-0000000000a1",
        ),
      },
      title: "Ideas",
    },
    { kind: "retitle", canvas: TEST_CANVAS },
    {
      kind: "proposed",
      lane: threadIdFor("abc"),
      action: "accept",
      to: null,
      seen: { kind: "jj", ledger: null, conflicted: false },
    },
    {
      kind: "proposed",
      lane: threadIdFor("abc"),
      action: "accept",
      to: null,
      seen: {
        kind: "folder",
        start: pointId("line-1"),
        tip: pointId("turn-2"),
        conflicted: false,
      },
    },
    {
      kind: "proposed",
      lane: threadIdFor("abc"),
      action: "accept",
      to: "wip/search",
      seen: SEEN,
    },
    {
      kind: "proposed",
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
          to: { kind: "composing", thread: NEW_THREAD },
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
          thread: threadIdFor("abc"),
        },
        to: {
          kind: "queued",
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
            thread: TEST_THREAD,
          },
          to: { kind: "trash" },
        },
        {
          card: cardIdFor("c8"),
          from: { kind: "inventory", holder: writerId("ada@example.com") },
          to: { kind: "trash" },
        },
      ],
      here: TEST_CANVAS,
    },
    {
      kind: "spin-off",
      move: {
        card: cardIdFor("c9"),
        from: { kind: "inventory", holder: writerId("ada@example.com") },
        to: { kind: "trash" },
      },
      root: rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff"),
      thread: NEW_THREAD,
      canvas: NEW_CANVAS,
      state: null,
      here: TEST_CANVAS,
    },
    {
      kind: "move",
      moves: [
        {
          card: cardIdFor("c7"),
          from: { kind: "composing", thread: NEW_THREAD },
          to: { kind: "inventory", holder: writerId("ada@example.com") },
        },
      ],
      here: null,
    },
    {
      kind: "move",
      moves: [cardIdFor("c7"), cardIdFor("c8")].map(
        (id): MoveOf<"text"> => ({
          card: textCardId(id),
          from: { kind: "composing", thread: NEW_THREAD },
          to: { kind: "inventory", holder: writerId("ada@example.com") },
        }),
      ),
      here: null,
    },
    {
      kind: "copy-thread",
      source: TEST_THREAD,
      end: entryId("e-9"),
      move: {
        card: threadIdFor("copy"),
        from: null,
        to: { kind: "canvas-at", canvas: TEST_CANVAS, after: TEST_THREAD },
      },
    },
    {
      kind: "paste",
      paste: {
        kind: "reference",
        card: REFERENCE,
        address: { kind: "entry", thread: TEST_THREAD, entry: entryId("e-9") },
        quote: "a".repeat(64) as Sha256,
      },
      to: { kind: "notes", near: "thread", thread: TEST_THREAD },
      replacing: null,
      here: null,
    },
    {
      kind: "paste",
      paste: { kind: "text", card: textCardId(cardIdFor("c7")), origin: null },
      to: { kind: "inventory", holder: writerId("ada@example.com") },
      replacing: {
        card: REFERENCE,
        from: { kind: "inventory", holder: writerId("ada@example.com") },
      },
      here: TEST_CANVAS,
    },
    {
      kind: "paste",
      paste: {
        kind: "text",
        card: textCardId(cardIdFor("c7")),
        origin: { kind: "entry", thread: TEST_THREAD, entry: entryId("e-9") },
      },
      to: { kind: "canvas-at", canvas: TEST_CANVAS, after: null },
      replacing: null,
      here: null,
    },
    {
      kind: "paste",
      paste: { kind: "uncut", card: cardIdFor("c7") },
      to: { kind: "notes", near: "canvas", canvas: TEST_CANVAS },
      replacing: null,
      here: null,
    },
    { kind: "undo-move", canvas: TEST_CANVAS, direction: "undo" },
    { kind: "undo-move", canvas: TEST_CANVAS, direction: "redo" },
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
    {
      kind: "card-width",
      card: threadIdFor("abc"),
      at: { kind: "canvas", canvas: TEST_CANVAS },
      width: 2,
    },
    {
      kind: "card-width",
      card: threadIdFor("abc"),
      at: { kind: "canvas", canvas: TEST_CANVAS },
      width: 1,
    },
    { kind: "queue-hold", lane: threadIdFor("abc"), held: true },
    { kind: "queue-hold", lane: threadIdFor("abc"), held: false },
    { kind: "ssh-access", lane: threadIdFor("abc"), answer: "approve" },
    { kind: "ssh-access", lane: threadIdFor("abc"), answer: "revoke" },
    { kind: "unqueue-all", lane: threadIdFor("abc") },
    {
      kind: "reorder",
      reorder: {
        card: cardIdFor("c7"),
        at: {
          kind: "queued",
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

test("a picture names a stored image's hash, or none; anything else is refused", () => {
  const picture = (text: string) =>
    decodeCommand(command({ id: "c", kind: "picture", text }))
  assert.deepEqual(picture(""), { kind: "picture", sha256: null })
  for (const bad of ["d".repeat(63), "D".repeat(64), "not a hash"])
    assert.equal(picture(bad).kind, "refused")
})

test("a chat's malformed pinned cards are refused", () => {
  const said = (pinned: string) =>
    decodeCommand(
      command({
        id: "c",
        kind: "send",
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
    assert.equal(said(bad).kind, "refused")
  assert.equal(said("").kind, "send")
})

test("an acceptance that does not say which proposed changes it was shown, well formed, is refused", () => {
  const accept = (seen: string) =>
    decodeCommand({
      ...EMPTY_COMMAND,
      kind: "proposed",
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
    kind: "proposed",
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
    { kind: "workflow-changed" },
    { kind: "marked" },
    { kind: "retitling" },
    { kind: "accepted" },
    { kind: "proposed" },
    { kind: "reserved" },
    { kind: "seen" },
    { kind: "accepted-moved" },
    { kind: "queued" },
    { kind: "moved" },
    { kind: "held" },
    { kind: "released" },
    { kind: "answered" },
    {
      kind: "undone",
      cards: [
        {
          card: cardIdFor("c1"),
          place: { kind: "composing", thread: NEW_THREAD },
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
      place: { kind: "composing", thread: NEW_THREAD },
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
    { kind: "refused", code: ERR.CANVAS_ARCHIVED, message: "archived by Bea" },
    { kind: "refused", code: ERR.CANVAS_BUSY, message: "busy" },
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

test("a note's key carries its column, and a thread's nearest notes its thread", () => {
  const note = {
    kind: "note",
    column: cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1"),
  } as const
  assert.deepEqual(decodeKey(encodeKey(note)), note)
  assert.equal(decodeKey('{"kind":"note","column":"t-x"}'), undefined)
  // A thread's nearest notes: a move's target, and no place.
  const notes = { kind: "notes", near: "thread", thread: TEST_THREAD } as const
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

test("a move's target may be a spot on a canvas, after a card or first, and no place", () => {
  const made = cardIdOfKind(
    "note-column",
    "01a0ffd2-0000-7000-8000-0000000000a1",
  )
  for (const after of [TEST_THREAD, null]) {
    const to = { kind: "canvas-at", canvas: TEST_CANVAS, after } as const
    const moves = decodeMoves(encodeMoves([{ card: made, from: null, to }]))
    assert.deepEqual(typeof moves === "string" ? moves : moves[0]?.to, to)
  }
  // A canvas's key is the canvas alone.
  assert.deepEqual(
    decodeKey(encodeKey({ kind: "canvas", canvas: TEST_CANVAS })),
    {
      kind: "canvas",
      canvas: TEST_CANVAS,
    },
  )
  assert.equal(
    decodeKey(`{"kind":"canvas-at","canvas":"${TEST_CANVAS}","column":""}`),
    undefined,
  )
  assert.equal(
    typeof decodeMoves(
      JSON.stringify([
        {
          card: made,
          from: null,
          to: { kind: "canvas-at", canvas: TEST_CANVAS, column: "not a card" },
        },
      ]),
    ),
    "string",
  )
})

test("a move's target may be back where a trashed card was, or a new canvas; neither is a place", () => {
  const made = cardIdOfKind(
    "note-column",
    "01a0ffd2-0000-7000-8000-0000000000a1",
  )
  for (const to of [
    { kind: "back" },
    { kind: "new-canvas", canvas: TEST_CANVAS },
  ] as const) {
    const moves = decodeMoves(
      encodeMoves([{ card: made, from: { kind: "trash" }, to }]),
    )
    assert.deepEqual(typeof moves === "string" ? moves : moves[0]?.to, to)
  }
  assert.equal(decodeKey('{"kind":"back"}'), undefined)
})

test("decode: a move is refused to or from a place its card's kind is never in", () => {
  const onCanvas = { kind: "canvas", canvas: TEST_CANVAS } as const
  const inventory = {
    kind: "inventory",
    holder: writerId("w-ada@x.io"),
  } as const
  const queued = {
    kind: "queued",
    thread: TEST_THREAD,
    seen: "",
  } as const
  const decoded = (card: CardId, from: PlaceKey | null, to: MoveTarget) =>
    typeof decodeMoves(encodeMoves([{ card, from, to }]))
  // A thread's card: between a canvas and an inventory, and nowhere else.
  assert.equal(decoded(TEST_THREAD, onCanvas, inventory), "object")
  assert.equal(
    decoded(TEST_THREAD, inventory, {
      ...onCanvas,
      kind: "canvas-at",
      after: null,
    }),
    "object",
  )
  assert.equal(decoded(TEST_THREAD, onCanvas, queued), "string")
  assert.equal(decoded(TEST_THREAD, queued, inventory), "string")
  assert.equal(
    decoded(TEST_THREAD, onCanvas, {
      kind: "notes",
      near: "thread",
      thread: TEST_THREAD,
    }),
    "string",
  )
  // A text card never onto a canvas by its key; at a spot there, the host
  // makes it a note column (`WRAPS`). A fact, at neither.
  assert.equal(decoded(cardIdFor("c1"), inventory, queued), "object")
  assert.equal(decoded(cardIdFor("c1"), inventory, onCanvas), "string")
  const spot = { ...onCanvas, kind: "canvas-at", after: null } as const
  assert.equal(decoded(cardIdFor("c1"), inventory, spot), "object")
  assert.equal(
    decoded(
      cardIdOfKind("fact", "01a0ffd2-0000-7000-8000-0000000000f9"),
      queued,
      spot,
    ),
    "string",
  )
  const thread: MoveOf<"thread"> = {
    card: TEST_THREAD,
    from: onCanvas,
    to: inventory,
  }
  assert.ok(thread)
  const never: MoveOf<"thread"> = {
    card: TEST_THREAD,
    from: onCanvas,
    // @ts-expect-error: a thread's card is never queued
    to: queued,
  }
  assert.ok(never)
  const nor: MoveOf<"text"> = {
    card: cardIdFor("c1"),
    from: null,
    // @ts-expect-error: a text card is never on a canvas
    to: onCanvas,
  }
  assert.ok(nor)
})

test("decode: a paste names its card's move, after at most a discard of the card it replaces", () => {
  const ada = { kind: "inventory", holder: writerId("ada@x.io") } as const
  const wire = (over: Record<string, string>) =>
    decodeCommand({
      kind: "paste",
      mode: "reference",
      cardId: REFERENCE,
      text: printAddress({
        kind: "entry",
        thread: TEST_THREAD,
        entry: entryId("e-9"),
      }),
      seen: "a".repeat(64),
      moves: encodeMoves([{ card: REFERENCE, from: null, to: ada }]),
      ...over,
    })
  expect(wire({})).toMatchObject({
    kind: "paste",
    paste: { kind: "reference" },
    replacing: null,
  })
  expect(refusalCode(wire({ text: "nope" }))).toBe(ERR.UNKNOWN_TARGET)
  expect(refusalCode(wire({ seen: "nope" }))).toBe(ERR.UNKNOWN_TARGET)
  // A reference's paste on a text card's id.
  const text = encodeMoves([
    { card: textCardId(cardIdFor("c1")), from: null, to: ada },
  ])
  expect(refusalCode(wire({ moves: text }))).toBe(ERR.UNKNOWN_TARGET)
  // A text card pasted from a place, not from nowhere.
  const moved = encodeMoves([
    { card: textCardId(cardIdFor("c1")), from: ada, to: ada },
  ])
  expect(refusalCode(wire({ mode: "text", text: "", moves: moved }))).toBe(
    ERR.UNKNOWN_TARGET,
  )
  // What it replaces is discarded, and comes first.
  const replaced = encodeMoves([
    { card: textCardId(cardIdFor("c1")), from: ada, to: ada },
    { card: REFERENCE, from: null, to: ada },
  ])
  expect(refusalCode(wire({ moves: replaced }))).toBe(ERR.UNKNOWN_TARGET)
  expect(refusalCode(wire({ mode: "copy" }))).toBe(ERR.UNKNOWN_TARGET)
})

test("decode: a copy names its source, the end it forks at, and its new thread's card's one move", () => {
  const wire = (over: Record<string, string>) =>
    decodeCommand({
      kind: "copy-thread",
      lane: TEST_THREAD,
      parentId: "e-9",
      moves: encodeMoves([
        {
          card: threadIdFor("copy"),
          from: null,
          to: { kind: "inventory", holder: writerId("w-ada@x.io") },
        },
      ]),
      ...over,
    })
  expect(wire({})).toMatchObject({ kind: "copy-thread", end: "e-9" })
  expect(refusalCode(wire({ parentId: "" }))).toBe(ERR.UNKNOWN_TARGET)
  expect(refusalCode(wire({ lane: "nope" }))).toBe(ERR.UNKNOWN_TARGET)
  const text = encodeMoves([
    {
      card: cardIdFor("c1"),
      from: null,
      to: { kind: "inventory", holder: writerId("w-ada@x.io") },
    },
  ])
  expect(refusalCode(wire({ moves: text }))).toBe(ERR.UNKNOWN_TARGET)
  const moved = encodeMoves([
    {
      card: threadIdFor("copy"),
      from: { kind: "canvas", canvas: TEST_CANVAS },
      to: { kind: "inventory", holder: writerId("w-ada@x.io") },
    },
  ])
  expect(refusalCode(wire({ moves: moved }))).toBe(ERR.UNKNOWN_TARGET)
})

test("decode: a mark names a canvas or a note column, never both or neither", () => {
  const N = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1")
  assert.equal(
    refusalCode(
      decodeCommand({ kind: "mark", canvas: TEST_CANVAS, cardId: N }),
    ),
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
  const unstarted = { kind: "composing", thread: NEW_THREAD } as const
  assert.deepEqual(decodeKey(encodeKey(unstarted)), unstarted)
  const pinned = {
    kind: "pinned",
    thread: threadIdFor("x"),
  } as const
  assert.deepEqual(decodeKey(encodeKey(pinned)), pinned)
  // A place no build records any more.
  assert.equal(decodeKey('{"kind":"fresh","column":"k"}'), undefined)
})

test("decode: a malformed move, command, width or undo of moves is refused", () => {
  const unstarted = { kind: "composing", thread: NEW_THREAD } as const
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
          to: unstarted,
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
          to: unstarted,
        },
      ]),
      here: "r-not-a-canvas",
    },
    {
      kind: "set-command",
      cardId: cardIdFor("c1"),
      mode: "pull",
    },
    { kind: "set-command", cardId: "" },
    // A width names its card, the canvas it was seen on, and 1 or 2.
    { kind: "card-width", cardId: "", canvas: TEST_CANVAS, mode: "2" },
    { kind: "card-width", cardId: cardIdFor("c1"), canvas: "r-x", mode: "2" },
    {
      kind: "card-width",
      cardId: cardIdFor("c1"),
      canvas: TEST_CANVAS,
      mode: "3",
    },
    { kind: "undo-move", canvas: "r-x", mode: "undo" },
    { kind: "undo-move", root: TEST_ROOT, mode: "sideways" },
    // `line` is no kind: setup and publish are commands of their own.
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

test("decode: a spin-off names its move to the trash, a new root, thread and canvas, and a state or none", () => {
  const trash = { kind: "discarded" }
  const from = { kind: "inventory", holder: "ada@example.com" }
  const moves = (to: unknown) =>
    JSON.stringify([{ card: cardIdFor("c1"), from, to }])
  const good = {
    kind: "spin-off",
    moves: moves(trash),
    root: rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff"),
    lane: NEW_THREAD,
    canvas: NEW_CANVAS,
  }
  assert.equal(decodeCommand(good).kind, "spin-off")
  for (const wire of [
    { ...good, moves: moves({ kind: "inventory", holder: "w" }) },
    { ...good, root: "" },
    { ...good, lane: "" },
    { ...good, state: "not a state" },
    // A spin-off starts a new canvas, under the id its tab minted.
    { ...good, canvas: "" },
  ])
    assert.equal(decodeCommand(wire).kind, "refused")
})

test("decode: a thread opened names a new thread, its root, its canvas and how it starts", () => {
  const branch = encodeIntent("c", {
    kind: "open-thread",
    thread: NEW_THREAD,
    root: TEST_ROOT,
    canvas: TEST_CANVAS,
    start: { kind: "branch", at: entryId("e-1") },
  })
  assert.deepEqual(decodeCommand(branch), {
    kind: "open-thread",
    thread: NEW_THREAD,
    root: TEST_ROOT,
    canvas: TEST_CANVAS,
    start: { kind: "branch", at: "e-1" },
  })
  const newRoot = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const tab = encodeIntent("c", {
    kind: "open-thread",
    thread: NEW_THREAD,
    root: newRoot,
    canvas: NEW_CANVAS,
    start: { kind: "new-canvas", state: null },
  })
  assert.deepEqual(decodeCommand(tab), {
    kind: "open-thread",
    thread: NEW_THREAD,
    root: newRoot,
    canvas: NEW_CANVAS,
    start: { kind: "new-canvas", state: null },
  })
  const after = threadIdFor("01a0ffd2-0000-7000-8000-0000000000aa")
  const column = encodeIntent("c", {
    kind: "open-thread",
    thread: NEW_THREAD,
    root: newRoot,
    canvas: TEST_CANVAS,
    start: { kind: "new-root", after },
  })
  assert.deepEqual(decodeCommand(column), {
    kind: "open-thread",
    thread: NEW_THREAD,
    root: newRoot,
    canvas: TEST_CANVAS,
    start: { kind: "new-root", after },
  })
  assert.deepEqual(decodeCommand({ ...column, cardId: "" }), {
    kind: "open-thread",
    thread: NEW_THREAD,
    root: newRoot,
    canvas: TEST_CANVAS,
    start: { kind: "new-root", after: null },
  })
  for (const wire of [
    { ...branch, lane: "t-not-new" },
    { ...branch, canvas: "r-x" },
    { ...branch, parentId: "" },
    { ...branch, mode: "" },
    { ...tab, root: "r-x" },
    { ...tab, canvas: "k-x" },
    { ...tab, state: "not a state" },
    // A new root's id is minted by its tab, in a canvas the session holds.
    { ...column, root: TEST_ROOT },
    { ...column, canvas: "r-x" },
    { ...column, cardId: "not a card" },
  ])
    assert.equal(decodeCommand(wire).kind, "refused")
})

test("decode: a press on a proposal keeps its rows in order, briefs on Start alone", () => {
  const second = threadIdFor("01a0ffd2-0000-7000-8000-0000000000ab")
  const open = encodeIntent("c", {
    kind: "branch-out",
    how: "open",
    root: TEST_ROOT,
    canvas: TEST_CANVAS,
    proposal: entryId("e-1"),
    branches: [
      { thread: NEW_THREAD, row: 0 },
      { thread: second, row: 2 },
    ],
  })
  assert.deepEqual(decodeCommand(open), {
    kind: "branch-out",
    how: "open",
    root: TEST_ROOT,
    canvas: TEST_CANVAS,
    proposal: "e-1",
    branches: [
      { thread: NEW_THREAD, row: 0 },
      { thread: second, row: 2 },
    ],
  })
  const start = encodeIntent("c", {
    kind: "branch-out",
    how: "start",
    root: TEST_ROOT,
    canvas: TEST_CANVAS,
    proposal: entryId("e-1"),
    branches: [{ thread: NEW_THREAD, row: 1, brief: "do it" }],
  })
  assert.deepEqual(decodeCommand(start), {
    kind: "branch-out",
    how: "start",
    root: TEST_ROOT,
    canvas: TEST_CANVAS,
    proposal: "e-1",
    branches: [{ thread: NEW_THREAD, row: 1, brief: "do it" }],
  })
  const rows = (list: unknown[]) => JSON.stringify(list)
  for (const wire of [
    { ...open, text: rows([]) },
    {
      ...open,
      text: rows([
        { thread: second, row: 2 },
        { thread: NEW_THREAD, row: 0 },
      ]),
    },
    {
      ...open,
      text: rows([
        { thread: NEW_THREAD, row: 0 },
        { thread: second, row: 0 },
      ]),
    },
    {
      ...open,
      text: rows([
        { thread: NEW_THREAD, row: 0 },
        { thread: NEW_THREAD, row: 1 },
      ]),
    },
    { ...open, text: rows([{ thread: "t-not-new", row: 0 }]) },
    { ...open, text: rows([{ thread: NEW_THREAD, row: 0, brief: "x" }]) },
    { ...start, text: rows([{ thread: NEW_THREAD, row: 0, brief: " " }]) },
    { ...open, mode: "send" },
    { ...open, parentId: "" },
    { ...open, canvas: "r-x" },
  ])
    assert.equal(decodeCommand(wire).kind, "refused")
})

test("decode: a malformed reorder or queue hold is refused", () => {
  const queued = {
    kind: "queued",
    lane: threadIdFor("abc"),
    seen: "",
  }
  const moves = JSON.stringify([
    { card: cardIdFor("c1"), from: null, to: queued },
  ])
  // One way into a queue: `move` refuses it, `queue-card` takes
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
  const moved = encodeIntent("c", {
    kind: "queue-card",
    move: {
      card: cardIdFor("c1"),
      from: { kind: "composing", thread: lane },
      to: { kind: "queued", thread: lane, seen: "" },
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
    column: cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000a1"),
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
      at: { kind: "composing", thread: "" },
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

test("decode: an ssh answer is approve, refuse or revoke", () => {
  assert.equal(
    refusalCode(
      decodeCommand({
        kind: "ssh-access",
        lane: threadIdFor("abc"),
        mode: "allow",
      }),
    ),
    ERR.UNKNOWN_KIND,
  )
})

test("decode: stop and carry-on must name a thread's lane", () => {
  for (const kind of [
    "stop",
    "carry-on",
    "unqueue-all",
    "queue-hold",
    "ssh-access",
  ])
    assert.equal(
      refusalCode(decodeCommand({ kind, lane: "w-someone" })),
      ERR.UNKNOWN_TARGET,
    )
})

test("decode: a note command is an unknown kind", () => {
  for (const mode of ["open", "done", "reopen"])
    assert.equal(
      refusalCode(decodeCommand({ kind: "note", mode, parentId: "e-1" })),
      ERR.UNKNOWN_KIND,
    )
})

test("decode: a chat's card is its id and its text's version, or none", () => {
  const said = (cardId: string) =>
    decodeCommand({
      kind: "send",
      text: "hi",
      mode: "branch",
      canvas: NEW_CANVAS,
      root: NEW_ROOT,
      lane: NEW_THREAD,
      cardId,
      seen: "v",
    })
  const card = (i: ReturnType<typeof said>) =>
    "kind" in i && i.kind === "send" ? i.card : "refused"
  assert.deepEqual(card(said(cardIdFor("c1"))), {
    id: cardIdFor("c1"),
    seen: "v",
  })
  assert.equal(card(said("")), null)
  assert.equal(card(said("  ")), null)
  // An id that is no text card's: a thread's, or no card's at all.
  assert.equal(card(said(NEW_THREAD)), "refused")
  assert.equal(card(said("c-1")), "refused")
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

test("a move on the board names its canvas and its states; a workflow change, a known action and its state", () => {
  const move = (text: string, canvas: string = TEST_CANVAS) =>
    refusalCode(decodeCommand({ kind: "move-canvas", canvas, text }))
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
  const said = (state: string) =>
    decodeCommand({
      ...EMPTY_COMMAND,
      kind: "send",
      text: "hi",
      parentId: "",
      root: NEW_ROOT,
      mode: "branch",
      canvas: NEW_CANVAS,
      lane: NEW_THREAD,
      state,
    })
  assert.equal(refusalCode(said("doing")), ERR.UNKNOWN_STATE)
  assert.equal(refusalCode(said("")), "not refused: send")
})

test("a mark names its canvas; its title is trimmed, one line, at most 80 characters, blank clears", () => {
  assert.deepEqual(
    decodeCommand({ kind: "mark", canvas: TEST_CANVAS, text: "  Tab names " }),
    {
      kind: "mark",
      of: { kind: "canvas", canvas: TEST_CANVAS },
      title: "Tab names",
    },
  )
  assert.deepEqual(
    decodeCommand({ kind: "mark", canvas: TEST_CANVAS, text: "" }),
    {
      kind: "mark",
      of: { kind: "canvas", canvas: TEST_CANVAS },
      title: null,
    },
  )
  for (const text of ["two\nlines", "x".repeat(81)])
    assert.equal(
      refusalCode(decodeCommand({ kind: "mark", canvas: TEST_CANVAS, text })),
      ERR.INVALID_TITLE,
    )
  assert.equal(
    refusalCode(decodeCommand({ kind: "mark", canvas: TEST_ROOT, text: "x" })),
    ERR.UNKNOWN_TARGET,
  )
})

test("a retitle names its canvas; anything else is refused", () => {
  assert.equal(
    refusalCode(decodeCommand({ kind: "retitle", canvas: TEST_ROOT })),
    ERR.UNKNOWN_TARGET,
  )
  assert.deepEqual(decodeCommand({ kind: "retitle", canvas: TEST_CANVAS }), {
    kind: "retitle",
    canvas: TEST_CANVAS,
  })
})

test("decode: a branch's thread, and a reserved one, is a new thread's id, t- and a uuidv7", () => {
  const said = (lane: string) =>
    decodeCommand({
      kind: "send",
      text: "hi",
      mode: "branch",
      canvas: NEW_CANVAS,
      root: NEW_ROOT,
      lane,
    })
  const reserve = (lane: string) => decodeCommand({ kind: "reserve", lane })
  assert.equal(said(NEW_THREAD).kind, "send")
  for (const bad of [
    "",
    "t-abc",
    "w-someone",
    NEW_THREAD.toUpperCase(),
    "t-01a0f9eb-86e1-47ad-a822-2a306786223f",
    `${NEW_THREAD};rm`,
    "t-01a0f9eb 86e1-77ad-a822-2a306786223f",
  ]) {
    assert.equal(refusalCode(said(bad)), ERR.UNKNOWN_TARGET, bad)
    assert.equal(refusalCode(reserve(bad)), ERR.UNKNOWN_TARGET, bad)
  }
})

test("the Line carries every field of a command, and no other", () => {
  // A field the Line's schema lacks would be dropped on the way.
  assert.deepEqual(
    Object.keys(Command.fields).sort(),
    Object.keys(EMPTY_COMMAND).sort(),
  )
})
