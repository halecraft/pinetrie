import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import type { MoveAnswer, MoveHow } from "@pineta/session"
import { expect, test, vi } from "vitest"
import { TEST_ROOT } from "./fixtures.ts"
import type { Effect } from "./intent.ts"
import { type AppPorts, perform } from "./perform.ts"

const accepted: MoveAnswer = { kind: "accepted", rev: 1 }
const how: MoveHow = { actedAt: { kind: "inventory" }, slot: null }
const ports = () => {
  const answer = { kind: "restored" } as const
  return {
    dispatch: vi.fn(),
    session: {
      request: vi.fn(async (): Promise<Outcome> => answer),
      offer: vi.fn(async (): Promise<Outcome> => answer),
      mark: vi.fn(async () => answer),
      retitle: vi.fn(async () => answer),
      createCard: vi.fn(async () => accepted),
      moveCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      moveCards: vi.fn(async (): Promise<MoveAnswer> => accepted),
      undoMoves: vi.fn(async (): Promise<Outcome> => ({ kind: "nothing" })),
      swapSlots: vi.fn(),
      undoSwap: vi.fn(async () => {}),
      refuse: vi.fn(),
    },
    inventory: { show: vi.fn(), select: vi.fn() },
    fly: vi.fn(),
    intent: vi.fn(),
    reveal: vi.fn(),
    openWhenHeld: vi.fn(),
    openFold: vi.fn(),
    pickArchived: vi.fn(),
    arm: vi.fn(),
    identity: { save: vi.fn(), clear: vi.fn() },
    reload: vi.fn(),
  } satisfies AppPorts
}
type Ports = ReturnType<typeof ports>

const root = entryId("r")
const identity = { email: "a@x.test", name: "Ada" }
const show = { kind: "show", tab: { kind: "archive" } } as const
const lane = laneNameForThread("x")
const at = atEntry(entryId("e"))
const ada = writerId("ada@x.test")
const move = {
  card: cardId("c"),
  from: null,
  to: { kind: "inventory", holder: ada },
} as const
const card: CardRecord = {
  id: cardId("c"),
  owner: ada,
  placer: ada,
  place: { kind: "drafting", root: TEST_ROOT, at, lane },
  command: "bring-up-to-date",
  unsent: null,
}

interface Row {
  readonly effect: Effect
  readonly port: (p: Ports) => unknown
  readonly args: readonly unknown[]
}

test.each<Row>([
  {
    effect: { kind: "layout", action: show },
    port: p => p.dispatch,
    args: [show],
  },
  {
    effect: { kind: "request", intent: { kind: "name", name: "Ada" } },
    port: p => p.session.request,
    args: [{ kind: "name", name: "Ada" }],
  },
  {
    effect: { kind: "offer", lane, action: "take", to: "wip/x" },
    port: p => p.session.offer,
    args: [lane, "take", "wip/x"],
  },
  {
    effect: { kind: "mark", root, title: "T" },
    port: p => p.session.mark,
    args: [root, "T"],
  },
  {
    effect: { kind: "retitle", root },
    port: p => p.session.retitle,
    args: [root],
  },
  {
    effect: { kind: "reveal", entry: entryId("e") },
    port: p => p.reveal,
    args: ["e"],
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
    effect: { kind: "pickArchived", root: entryId("r") },
    port: p => p.pickArchived,
    args: ["r"],
  },
  { effect: { kind: "armFocus", key: "k" }, port: p => p.arm, args: ["k"] },
  {
    effect: { kind: "storeIdentity", identity },
    port: p => p.identity.save,
    args: [identity],
  },
  { effect: { kind: "forgetIdentity" }, port: p => p.identity.clear, args: [] },
  { effect: { kind: "reload" }, port: p => p.reload, args: [] },
  {
    effect: { kind: "createCard", card, text: "t", how },
    port: p => p.session.createCard,
    args: [card, "t", how],
  },
  {
    effect: { kind: "moveCard", move, how, queuedBy: ada, fly: false },
    port: p => p.session.moveCard,
    args: [move, how, ada],
  },
  {
    effect: { kind: "moveCard", move, how, queuedBy: null, fly: true },
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
    effect: { kind: "undoMoves", root: TEST_ROOT, direction: "undo" },
    port: p => p.session.undoMoves,
    args: [TEST_ROOT, "undo"],
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
  const close = { kind: "layout", action: show } as const
  const moves = [
    { move, slot: 1 },
    { move: { ...move, card: cardId("d") }, slot: 2 },
  ] as const
  const actedAt = { kind: "column", key: "f" } as const
  const keep: Effect = { kind: "keep", moves, actedAt, close: [close] }
  const p = ports()
  perform([keep], p)
  expect(p.session.moveCards).toHaveBeenCalledExactlyOnceWith(moves, actedAt)
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
  perform([{ kind: "undoMoves", root: TEST_ROOT, direction: "undo" }], p)
  await vi.waitFor(() =>
    expect(p.intent).toHaveBeenCalledWith({ kind: "undoAnswered", outcome }),
  )
})

test("a restore, once answered restored, shows its root", async () => {
  const p = ports()
  perform([{ kind: "restore", root }], p)
  expect(p.session.request).toHaveBeenCalledWith({
    kind: "archive",
    action: "restore",
    root,
  })
  await vi.waitFor(() =>
    expect(p.dispatch).toHaveBeenCalledWith({
      kind: "show",
      tab: { kind: "root", root },
    }),
  )
})

test("a move flies only when its plan says so", () => {
  const p = ports()
  perform([{ kind: "moveCard", move, how, queuedBy: null, fly: false }], p)
  expect(p.fly).not.toHaveBeenCalled()
  expect(p.session.moveCard).toHaveBeenCalledOnce()
})
