import {
  addressUrl,
  type CardRecord,
  cardIdOfKind,
  entryId,
  rootIdFor,
  type Sha256,
  taskIdFor,
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
import { NEW_TASK } from "./fixtures.ts"
import { type AppPorts, perform } from "./perform.ts"

const TEST_TASK = taskIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const SHA = "a".repeat(64) as Sha256
const accepted: MoveAnswer = { kind: "accepted", rev: 1 }
const how: MoveHow = { actedAt: { kind: "inventory" }, slot: null }
const ports = () => {
  const answer = { kind: "marked" } as const
  return {
    dispatch: vi.fn(),
    session: {
      request: vi.fn(async (): Promise<Outcome> => answer),
      offer: vi.fn(async (): Promise<Outcome> => answer),
      createCard: vi.fn(async () => accepted),
      // Every card's text, as the comment queued below has it.
      cardText: vi.fn(
        () => ({ text: () => "  look at this  " }) as never,
      ) as AppPorts["session"]["cardText"],
      makeReference: vi.fn(async (): Promise<MoveAnswer> => accepted),
      editAsText: vi.fn(async (): Promise<Outcome> => answer),
      moveCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      queueCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      moveCards: vi.fn(async (): Promise<MoveAnswer> => accepted),
      reorderCard: vi.fn(async (): Promise<MoveAnswer> => accepted),
      undoMoves: vi.fn(async (): Promise<Outcome> => ({ kind: "nothing" })),
      swapSlots: vi.fn(),
      undoSwap: vi.fn(async () => {}),
      refuse: vi.fn(),
      openThreads: {
        tasks: { current: () => [], subscribe: () => () => {} },
        open: vi.fn(),
        ensure: vi.fn(),
        close: vi.fn(),
        here: vi.fn(),
        repair: vi.fn(),
        dispose: vi.fn(),
      },
    },
    inventory: { show: vi.fn(), select: vi.fn(), openSelected: vi.fn() },
    attention: { dismiss: vi.fn(), dismissOffer: vi.fn() },
    fly: vi.fn(),
    intent: vi.fn(),
    reveal: vi.fn(),
    revealCard: vi.fn(),
    openWhenHeld: vi.fn(),
    openFold: vi.fn(),
    arm: vi.fn(),
    identity: { save: vi.fn(), clear: vi.fn() },
    reload: vi.fn(),
    listWidth: vi.fn(),
    uploadText: vi.fn(async () => ({
      ok: true as const,
      ref: {
        sha256: SHA,
        mimeType: "text/markdown" as const,
        width: null,
        height: null,
      },
    })),
    clipboard: vi.fn(),
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
    effect: { kind: "offer", lane, action: "accept", to: "wip/x" },
    port: p => p.session.offer,
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
    effect: { kind: "list", act: { kind: "ensure", task: TEST_TASK } },
    port: p => p.session.openThreads.ensure,
    args: [TEST_TASK],
  },
  {
    effect: {
      kind: "list",
      act: { kind: "place", task: TEST_TASK, before: null },
    },
    port: p => p.session.openThreads.open,
    args: [TEST_TASK, null],
  },
  {
    effect: { kind: "list", act: { kind: "close", task: TEST_TASK } },
    port: p => p.session.openThreads.close,
    args: [TEST_TASK],
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
      here: TEST_TASK,
    },
    port: p => p.session.moveCard,
    args: [move, how, ada, TEST_TASK],
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
    effect: { kind: "undoMoves", task: TEST_TASK, direction: "undo" },
    port: p => p.session.undoMoves,
    args: [TEST_TASK, "undo"],
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
    { move: { ...move, card: textCardId("d") }, slot: 2 },
  ] as const
  const actedAt = { kind: "column", key: "f" } as const
  const keep: Effect = {
    kind: "keep",
    moves,
    actedAt,
    close: [close],
    here: TEST_TASK,
  }
  const p = ports()
  perform([keep], p)
  expect(p.session.moveCards).toHaveBeenCalledExactlyOnceWith(
    moves,
    actedAt,
    TEST_TASK,
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
  perform([{ kind: "undoMoves", task: TEST_TASK, direction: "undo" }], p)
  await vi.waitFor(() =>
    expect(p.intent).toHaveBeenCalledWith({ kind: "undoAnswered", outcome }),
  )
})

test("a move on the board runs what follows it only once the host accepts it (ADR-0122)", async () => {
  const request = {
    kind: "move-task",
    task: TEST_TASK,
    from: workflowStateIdFor("d"),
    to: workflowStateIdFor("x"),
    before: null,
  } as const
  const closed = { kind: "closeTask", task: TEST_TASK } as const
  const effect: Effect = {
    kind: "moveTask",
    move: request,
    moved: [{ kind: "layout", action: closed }],
  }
  const p = ports()
  p.session.request.mockImplementationOnce(async () => ({ kind: "moved-task" }))
  perform([effect], p)
  expect(p.session.request).toHaveBeenCalledWith(request)
  await vi.waitFor(() => expect(p.dispatch).toHaveBeenCalledWith(closed))
  const q = ports()
  q.session.request.mockImplementationOnce(async () => ({
    kind: "refused",
    code: "task_moved",
    message: "not moved",
  }))
  perform([effect], q)
  await new Promise(r => setTimeout(r, 0))
  expect(q.dispatch).not.toHaveBeenCalled()
})

test("a spin-off into the sidebar places and shows its thread only once the host started it (ADR-0111)", async () => {
  const thread = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const request = {
    kind: "spin-off",
    move: {
      card: textCardId("c"),
      from: { kind: "inventory", holder: writerId("ada@x.io") },
      to: {
        kind: "trash",
        why: { kind: "spun", into: thread, thread: threadIdFor("spun") },
      },
    },
    task: NEW_TASK,
    state: null,
    here: NEW_TASK,
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
    expect(p.session.openThreads.open).toHaveBeenCalledWith(NEW_TASK, null),
  )
})

test("a comment queued as a reference keeps its text under a link to its entry, then makes the reference in the queue (ADR-0126)", async () => {
  const p = ports()
  const thread = threadIdFor("1-r1")
  const entry = { kind: "entry", thread, entry: entryId("e-1") } as const
  const comment = textCardId("01a0ffd2-0000-7000-8000-0000000000d1")
  const card = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000d2")
  const to = { kind: "queued", thread, seen: "" } as const
  perform([{ kind: "queueComment", card, comment, entry, to, how }], p)
  expect(p.uploadText).toHaveBeenCalledWith(
    `A comment on [a message](${addressUrl(entry)}):\n\nlook at this`,
  )
  await vi.waitFor(() =>
    expect(p.session.makeReference).toHaveBeenCalledWith(
      { card, to, address: { kind: "card", card: comment }, quote: SHA },
      how,
    ),
  )
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

test("not needed marks a verdict by its ask, an offer by its source, and an offer with none not at all (ADR-0077)", () => {
  const p: Ports = ports()
  const lane = threadIdFor("a")
  perform(
    [
      {
        kind: "notNeeded",
        lane,
        raised: {
          kind: "verdict",
          verdict: { kind: "unclassified" },
          ask: entryId("p-1"),
        },
      },
      {
        kind: "notNeeded",
        lane,
        raised: {
          kind: "offer",
          source: cardIdFor("c1"),
        },
      },
      { kind: "notNeeded", lane, raised: { kind: "offer", source: null } },
    ],
    p,
  )
  expect(p.attention.dismiss.mock.calls).toEqual([[lane, "p-1"]])
  expect(p.attention.dismissOffer.mock.calls).toEqual([[lane, cardIdFor("c1")]])
})
