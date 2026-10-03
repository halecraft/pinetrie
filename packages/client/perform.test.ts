import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import { expect, test, vi } from "vitest"
import type { MoveAnswer, MoveHow } from "./card-moves.ts"
import { TEST_ROOT } from "./fixtures.ts"
import type { Effect } from "./intent.ts"
import { type AppPorts, perform } from "./perform.ts"

const accepted: MoveAnswer = { kind: "accepted", rev: 1 }
const how: MoveHow = {
  actedAt: { kind: "inventory" },
  history: { kind: "none" },
  slot: null,
}
const ports = () => {
  const answer = { kind: "restored" } as const
  return {
    dispatch: vi.fn(),
    session: {
      archive: vi.fn(async (): Promise<Outcome> => answer),
      mark: vi.fn(async () => answer),
      discardCard: vi.fn(),
      setName: vi.fn(async () => answer),
      createCard: vi.fn(async () => accepted),
      queueCard: vi.fn(),
      unqueueCard: vi.fn(),
      moveCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      swapSlots: vi.fn(),
      dropEntry: vi.fn(),
      refuse: vi.fn(),
      setCommand: vi.fn(),
      offer: vi.fn(async () => answer),
    },
    inventory: { show: vi.fn(), select: vi.fn() },
    fly: vi.fn(),
    askRestore: vi.fn(),
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
    effect: { kind: "archive", root },
    port: p => p.session.archive,
    args: ["archive", root],
  },
  {
    effect: { kind: "mark", root, title: "T" },
    port: p => p.session.mark,
    args: [root, "T"],
  },
  {
    effect: { kind: "discardCard", card: cardId("c"), how },
    port: p => p.session.discardCard,
    args: ["c", how],
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
    effect: { kind: "setName", name: "Ada" },
    port: p => p.session.setName,
    args: ["Ada"],
  },
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
    effect: { kind: "queueCard", card: cardId("c"), lane, at, how },
    port: p => p.session.queueCard,
    args: ["c", { lane, at }, how],
  },
  {
    effect: { kind: "unqueueCard", card: cardId("c"), lane, by: ada, how },
    port: p => p.session.unqueueCard,
    args: ["c", { lane, by: ada }, how],
  },
  {
    effect: { kind: "moveCard", move, how },
    port: p => p.session.moveCard,
    args: [move, how],
  },
  {
    effect: { kind: "moveCard", move, how },
    port: p => p.fly,
    args: ["c"],
  },
  {
    effect: { kind: "swapSlots", a: 1, b: 2, step: { kind: "none" } },
    port: p => p.session.swapSlots,
    args: [1, 2, { kind: "none" }],
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
  {
    effect: { kind: "askRestore", root, direction: "undo" },
    port: p => p.askRestore,
    args: [root, "undo"],
  },
  {
    effect: { kind: "setCommand", card: cardId("c"), command: null },
    port: p => p.session.setCommand,
    args: ["c", null],
  },
  {
    effect: { kind: "offer", lane, action: "take", to: "wip/x" },
    port: p => p.session.offer,
    args: [lane, "take", "wip/x"],
  },
])("the $effect.kind effect is one port call", ({ effect, port, args }) => {
  const p = ports()
  perform([effect], p)
  expect(port(p)).toHaveBeenCalledExactlyOnceWith(...args)
})

test("a keep closes its column only once every card is accepted", async () => {
  const close = { kind: "layout", action: show } as const
  const keep: Effect = {
    kind: "keep",
    moves: [
      { move, how },
      { move: { ...move, card: cardId("d") }, how },
    ],
    close: [close],
  }
  const p = ports()
  perform([keep], p)
  await vi.waitFor(() => expect(p.dispatch).toHaveBeenCalledWith(show))
  const q = ports()
  q.session.moveCard.mockImplementationOnce(async () => ({
    kind: "refused",
    refusal: null,
  }))
  perform([keep], q)
  await vi.waitFor(() => expect(q.session.moveCard).toHaveBeenCalledTimes(2))
  await new Promise(r => setTimeout(r, 0))
  expect(q.dispatch).not.toHaveBeenCalled()
})

test("restore-then asks for its intent afresh, only once restored", async () => {
  const next = { kind: "undoMove", direction: "undo", restored: root } as const
  const p = ports()
  perform([{ kind: "restoreThen", root, next }], p)
  await vi.waitFor(() => expect(p.intent).toHaveBeenCalledWith(next))
  const q = ports()
  q.session.archive.mockImplementationOnce(async () => ({ kind: "marked" }))
  perform([{ kind: "restoreThen", root, next }], q)
  await new Promise(r => setTimeout(r, 0))
  expect(q.intent).not.toHaveBeenCalled()
})

test("a restore, once answered restored, shows its root", async () => {
  const p = ports()
  perform([{ kind: "restore", root }], p)
  expect(p.session.archive).toHaveBeenCalledWith("restore", root)
  await vi.waitFor(() =>
    expect(p.dispatch).toHaveBeenCalledWith({
      kind: "show",
      tab: { kind: "root", root },
    }),
  )
})
