import {
  atEntry,
  type CardRecord,
  cardId,
  entryId,
  laneNameForThread,
  writerId,
} from "@pineta/core"
import { expect, test, vi } from "vitest"
import type { Effect } from "./intent.ts"
import { type AppPorts, perform } from "./perform.ts"

const ports = () => {
  const answer = { kind: "restored" } as const
  return {
    dispatch: vi.fn(),
    session: {
      archive: vi.fn(async () => answer),
      mark: vi.fn(async () => answer),
      discardCard: vi.fn(),
      setName: vi.fn(async () => answer),
      createCard: vi.fn(),
      queueCard: vi.fn(),
      unqueueCard: vi.fn(),
      setCommand: vi.fn(),
      offer: vi.fn(async () => answer),
    },
    reveal: vi.fn(),
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
const card: CardRecord = {
  id: cardId("c"),
  owner: ada,
  placer: ada,
  place: { kind: "drafting", at, lane },
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
    effect: { kind: "discardCard", card: cardId("c") },
    port: p => p.session.discardCard,
    args: ["c"],
  },
  {
    effect: { kind: "reveal", entry: entryId("e") },
    port: p => p.reveal,
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
    effect: { kind: "createCard", card },
    port: p => p.session.createCard,
    args: [card, ""],
  },
  {
    effect: { kind: "queueCard", card: cardId("c"), lane, at },
    port: p => p.session.queueCard,
    args: ["c", { lane, at }],
  },
  {
    effect: { kind: "unqueueCard", card: cardId("c"), lane, by: ada },
    port: p => p.session.unqueueCard,
    args: ["c", { lane, by: ada }],
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
