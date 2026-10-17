import {
  addressUrl,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  rootIdFor,
  type Sha256,
  textCardId,
  threadIdFor,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { Outcome } from "@pinetrie/protocol/codec"
import type { MoveAnswer, MoveHow } from "@pinetrie/session"
import { expect, test, vi } from "vitest"
import type { Effect } from "./effects.ts"
import { NEW_CANVAS } from "./fixtures.ts"
import { type AppPorts, perform } from "./perform.ts"

const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const SHA = "a".repeat(64) as Sha256
const accepted: MoveAnswer = { kind: "accepted", rev: 1 }
const how: MoveHow = { actedAt: { kind: "inventory" }, slot: null }
const ports = () => {
  const answer = { kind: "marked" } as const
  return {
    dispatch: vi.fn(),
    session: {
      request: vi.fn(async (): Promise<Outcome> => answer),
      send: vi.fn(async (): Promise<Outcome> => answer),
      proposed: vi.fn(async (): Promise<Outcome> => answer),
      resolve: vi.fn(async (): Promise<Outcome> => answer),
      createCard: vi.fn(async () => accepted),
      // Every card's text, as the comment queued below has it.
      cardText: vi.fn(
        () => ({ text: () => "  look at this  " }) as never,
      ) as AppPorts["session"]["cardText"],
      paste: vi.fn(async (): Promise<MoveAnswer> => accepted),
      moveCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      queueCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      moveCards: vi.fn(async (): Promise<MoveAnswer> => accepted),
      reorderCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      undoMoves: vi.fn(async (): Promise<Outcome> => ({ kind: "nothing" })),
      swapSlots: vi.fn(),
      undoSwap: vi.fn(async () => {}),
      refuse: vi.fn(),
      acted: vi.fn(),
      openThreads: {
        canvases: { current: () => [], subscribe: () => () => {} },
        open: vi.fn(),
        ensure: vi.fn(),
        close: vi.fn(),
        here: vi.fn(),
        repair: vi.fn(),
        dispose: vi.fn(),
      },
    },
    inventory: { show: vi.fn(), select: vi.fn(), openSelected: vi.fn() },
    attention: { dismiss: vi.fn(), dismissReady: vi.fn() },
    fly: vi.fn(),
    foldColumn: vi.fn(),
    intent: vi.fn(),
    reveal: vi.fn(),
    revealCard: vi.fn(),
    openWhenHeld: vi.fn(),
    openFold: vi.fn(),
    arm: vi.fn(),
    identity: { save: vi.fn(), clear: vi.fn() },
    reload: vi.fn(),
    listWidth: vi.fn(),
    uploadBlob: vi.fn(async () => ({
      ok: true as const,
      ref: {
        sha256: SHA,
        mimeType: "text/markdown" as const,
        width: null,
        height: null,
      },
    })),
    clipboardCell: vi.fn(),
    insertText: vi.fn(),
    page: vi.fn(),
    search: vi.fn(),
    landed: vi.fn(),
  } satisfies AppPorts
}
type Ports = ReturnType<typeof ports>

const identity = { email: "a@x.test", name: "Ada" }
const show = { kind: "show", here: { kind: "nothing" } } as const
const lane = threadIdFor("x")
const ada = writerId("ada@x.test")
const move = {
  card: textCardId("c"),
  from: null,
  to: { kind: "inventory", holder: ada },
} as const
const card: CardRecord = {
  kind: "text" as const,
  id: textCardId("c"),
  owner: ada,
  placer: ada,
  place: { kind: "composing", thread: lane },
  content: { command: "bring-up-to-date", unsent: null, origin: null },
}

interface Row {
  readonly effect: Effect
  readonly port: (p: Ports) => unknown
  readonly args: readonly unknown[]
}

test.each<Row>([
  {
    effect: { kind: "layout", moves: false, action: show },
    port: p => p.dispatch,
    args: [show],
  },
  {
    effect: { kind: "request", intent: { kind: "name", name: "Ada" } },
    port: p => p.session.request,
    args: [{ kind: "name", name: "Ada" }],
  },
  {
    effect: { kind: "proposed", lane, action: "accept", to: "wip/x" },
    port: p => p.session.proposed,
    args: [lane, "accept", "wip/x"],
  },
  {
    effect: { kind: "reveal", entry: entryId("e") },
    port: p => p.reveal,
    args: ["e"],
  },
  {
    effect: { kind: "landed", entry: entryId("e") },
    port: p => p.landed,
    args: ["e"],
  },
  {
    effect: { kind: "search", act: { kind: "close" } },
    port: p => p.search,
    args: [{ kind: "close" }],
  },
  {
    effect: { kind: "revealCard", card: textCardId("c") },
    port: p => p.revealCard,
    args: [textCardId("c")],
  },
  {
    effect: { kind: "openWhenHeld", entry: entryId("e") },
    port: p => p.openWhenHeld,
    args: ["e"],
  },
  {
    effect: { kind: "openFold", ask: entryId("a") },
    port: p => p.openFold,
    args: ["a"],
  },
  {
    effect: { kind: "list", act: { kind: "ensure", canvas: TEST_CANVAS } },
    port: p => p.session.openThreads.ensure,
    args: [TEST_CANVAS],
  },
  {
    effect: {
      kind: "list",
      act: { kind: "place", canvas: TEST_CANVAS, before: null },
    },
    port: p => p.session.openThreads.open,
    args: [TEST_CANVAS, null],
  },
  {
    effect: { kind: "list", act: { kind: "close", canvas: TEST_CANVAS } },
    port: p => p.session.openThreads.close,
    args: [TEST_CANVAS],
  },
  {
    effect: { kind: "armFocus", key: { kind: "board" } },
    port: p => p.arm,
    args: [{ kind: "board" }],
  },
  {
    effect: { kind: "storeIdentity", identity },
    port: p => p.identity.save,
    args: [identity],
  },
  { effect: { kind: "forgetIdentity" }, port: p => p.identity.clear, args: [] },
  { effect: { kind: "reload" }, port: p => p.reload, args: [] },
  {
    effect: { kind: "listWidth", width: "icons" },
    port: p => p.listWidth,
    args: ["icons"],
  },
  {
    effect: { kind: "page", to: "profile" },
    port: p => p.page,
    args: ["profile"],
  },
  {
    effect: { kind: "createCard", card, text: "t", how },
    port: p => p.session.createCard,
    args: [card, "t", how],
  },
  {
    effect: {
      kind: "moveCard",
      move,
      how,
      queuedBy: ada,
      fly: false,
      here: TEST_CANVAS,
    },
    port: p => p.session.moveCard,
    args: [move, how, ada, TEST_CANVAS],
  },
  {
    effect: {
      kind: "moveCard",
      move,
      how,
      queuedBy: null,
      fly: true,
      here: null,
    },
    port: p => p.fly,
    args: ["c"],
  },
  {
    effect: { kind: "swapSlots", a: 1, b: 2 },
    port: p => p.session.swapSlots,
    args: [1, 2],
  },
  {
    effect: { kind: "undoSwap", direction: "redo" },
    port: p => p.session.undoSwap,
    args: ["redo"],
  },
  {
    effect: { kind: "undoMoves", canvas: TEST_CANVAS, direction: "undo" },
    port: p => p.session.undoMoves,
    args: [TEST_CANVAS, "undo"],
  },
  {
    effect: { kind: "showInventory", brief: true },
    port: p => p.inventory.show,
    args: [true],
  },
  {
    effect: { kind: "select", slot: 4 },
    port: p => p.inventory.select,
    args: [4],
  },
])("the $effect.kind effect is one port call", ({ effect, port, args }) => {
  const p = ports()
  perform([effect], p)
  expect(port(p)).toHaveBeenCalledExactlyOnceWith(...args)
})

test("a keep is one move of every card, and closes its column only once accepted", async () => {
  const close = { kind: "layout", moves: false, action: show } as const
  const moves = [
    { move, slot: 1 },
    { move: { ...move, card: textCardId("d") }, slot: 2 },
  ] as const
  const actedAt = { kind: "column", key: "f" } as const
  const keep: Effect = {
    kind: "moveCards",
    moves,
    actedAt,
    close: [close],
    here: TEST_CANVAS,
  }
  const p = ports()
  perform([keep], p)
  expect(p.session.moveCards).toHaveBeenCalledExactlyOnceWith(
    moves,
    actedAt,
    TEST_CANVAS,
  )
  await vi.waitFor(() => expect(p.dispatch).toHaveBeenCalledWith(show))
  const q = ports()
  q.session.moveCards.mockImplementationOnce(async () => ({
    kind: "refused",
    refusal: null,
  }))
  perform([keep], q)
  await new Promise(r => setTimeout(r, 0))
  expect(q.dispatch).not.toHaveBeenCalled()
})

test("an undo of moves plans what its answer shows, afresh", async () => {
  const p = ports()
  const outcome: Outcome = { kind: "undone", cards: [] }
  p.session.undoMoves.mockImplementationOnce(async () => outcome)
  perform([{ kind: "undoMoves", canvas: TEST_CANVAS, direction: "undo" }], p)
  await vi.waitFor(() =>
    expect(p.intent).toHaveBeenCalledWith({ kind: "undoAnswered", outcome }),
  )
})

test("a move on the board runs what follows it only once the host accepts it; a refusal is said there", async () => {
  const request = {
    kind: "move-canvas",
    canvas: TEST_CANVAS,
    from: workflowStateIdFor("d"),
    to: workflowStateIdFor("x"),
    before: null,
  } as const
  const closed = { kind: "closeCanvas", canvas: TEST_CANVAS } as const
  const effect: Effect = {
    kind: "moveCanvas",
    move: request,
    moved: [{ kind: "layout", moves: false, action: closed }],
  }
  const p = ports()
  p.session.request.mockImplementationOnce(async () => ({ kind: "moved" }))
  perform([effect], p)
  expect(p.session.acted).toHaveBeenCalledWith({ kind: "board" })
  expect(p.session.request).toHaveBeenCalledWith(request)
  await vi.waitFor(() => expect(p.dispatch).toHaveBeenCalledWith(closed))
  const q = ports()
  q.session.request.mockImplementationOnce(async () => ({
    kind: "unmoved",
    code: "moved",
    place: { kind: "board", state: workflowStateIdFor("d") },
    by: writerId("bea@x.io"),
  }))
  perform([effect], q)
  await vi.waitFor(() =>
    expect(q.session.refuse).toHaveBeenCalledWith({
      card: null,
      actedAt: { kind: "board" },
      code: "moved",
      by: writerId("bea@x.io"),
      fromQueue: false,
    }),
  )
  expect(q.dispatch).not.toHaveBeenCalled()
})

test("a spin-off into the sidebar places and shows its thread only once the host started it", async () => {
  const request = {
    kind: "spin-off",
    move: {
      card: textCardId("c"),
      from: { kind: "inventory", holder: writerId("ada@x.io") },
      to: { kind: "trash" },
    },
    root: rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff"),
    thread: threadIdFor("01a0ffd2-0000-7000-8000-0000000000f5"),
    canvas: NEW_CANVAS,
    state: null,
    here: NEW_CANVAS,
  } as const
  const effect: Effect = {
    kind: "spinOff",
    request,
    sidebar: { before: null },
  }
  const p = ports()
  p.session.request.mockImplementationOnce(async () => ({
    kind: "appended",
    id: entryId("t-1"),
  }))
  perform([effect], p)
  expect(p.session.request).toHaveBeenCalledWith(request)
  await vi.waitFor(() =>
    expect(p.session.openThreads.open).toHaveBeenCalledWith(NEW_CANVAS, null),
  )
})

test("a comment queued as a reference keeps its text under a link to its entry, then makes the reference in the queue", async () => {
  const p = ports()
  const thread = threadIdFor("1-r1")
  const entry = { kind: "entry", thread, entry: entryId("e-1") } as const
  const comment = textCardId("01a0ffd2-0000-7000-8000-0000000000d1")
  const card = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000d2")
  const to = { kind: "queued", thread, seen: "" } as const
  const address = { kind: "card", card: comment } as const
  perform(
    [
      {
        kind: "paste",
        paste: {
          kind: "reference",
          card,
          address,
          quote: { kind: "comment", comment, entry },
        },
        to,
        replacing: null,
        how,
        here: null,
      },
    ],
    p,
  )
  expect(p.uploadBlob).toHaveBeenCalledWith(
    `A comment on [a message](${addressUrl(entry)}):\n\nlook at this`,
  )
  await vi.waitFor(() =>
    expect(p.session.paste).toHaveBeenCalledWith(
      {
        paste: { kind: "reference", card, address, quote: SHA },
        to,
        replacing: null,
        here: null,
        text: "",
      },
      how,
    ),
  )
})

test("a pasted text card is sent with its text, to be written first; a kept quote is sent as it is", () => {
  const p = ports()
  const text = textCardId("01a0ffd2-0000-7000-8000-0000000000d3")
  const to = { kind: "inventory", holder: ada } as const
  perform(
    [
      {
        kind: "paste",
        paste: { kind: "text", card: text, origin: null, text: "hello" },
        to,
        replacing: null,
        how,
        here: null,
      },
    ],
    p,
  )
  expect(p.session.paste).toHaveBeenCalledWith(
    {
      paste: { kind: "text", card: text, origin: null },
      to,
      replacing: null,
      here: null,
      text: "hello",
    },
    how,
  )
  expect(p.uploadBlob).not.toHaveBeenCalled()
})

test("a move flies only when its plan says so", () => {
  const p = ports()
  perform(
    [{ kind: "moveCard", move, how, queuedBy: null, fly: false, here: null }],
    p,
  )
  expect(p.fly).not.toHaveBeenCalled()
  expect(p.session.moveCard).toHaveBeenCalledOnce()
})

test("a fold that moves goes through the fold's port, whose commit lands it; one that does not lands at once", () => {
  const canvas = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
  const card = cardIdFor("c1")
  const action = {
    kind: "view",
    canvas,
    first: null,
    change: { kind: "fold", card, unfolded: false },
  } as const
  const p = ports()
  perform([{ kind: "layout", moves: true, action }], p)
  expect(p.dispatch).not.toHaveBeenCalled()
  expect(p.foldColumn).toHaveBeenCalledOnce()
  const [motion, commit] = p.foldColumn.mock.calls[0] ?? []
  expect(motion).toEqual({ column: { kind: "card", card }, unfolded: false })
  commit()
  expect(p.dispatch).toHaveBeenCalledWith(action)
  const q = ports()
  perform([{ kind: "layout", moves: false, action }], q)
  expect(q.foldColumn).not.toHaveBeenCalled()
  expect(q.dispatch).toHaveBeenCalledWith(action)
})

test("not needed marks a run-end report by its ask, proposed changes by its source, and proposed changes with none not at all", () => {
  const p: Ports = ports()
  const lane = threadIdFor("a")
  perform(
    [
      {
        kind: "notNeeded",
        lane,
        raised: {
          kind: "runEnd",
          report: { kind: "unclassified" },
          ask: entryId("p-1"),
        },
      },
      {
        kind: "notNeeded",
        lane,
        raised: {
          kind: "ready",
          source: cardIdFor("c1"),
        },
      },
      { kind: "notNeeded", lane, raised: { kind: "ready", source: null } },
    ],
    p,
  )
  expect(p.attention.dismiss.mock.calls).toEqual([[lane, "p-1"]])
  expect(p.attention.dismissReady.mock.calls).toEqual([[lane, cardIdFor("c1")]])
})
