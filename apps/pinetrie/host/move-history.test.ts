import { createInMemoryStore, Exchange, whenHydrated } from "@kyneta/exchange"
import {
  atEntry,
  type CardRecord,
  entryId,
  movesDocId,
  rootIdFor,
  type TaskId,
  type TextCard,
  taskIdFor,
  textCardId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import { readPlaces } from "@pinetrie/reads"
import { PlacesDoc } from "@pinetrie/schema"
import { expect, test } from "vitest"
import { createMoveHistories } from "./move-history.ts"
import { applyPlaceSteps } from "./places.ts"

const TEST_THREAD = threadIdFor("e")

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
/** Two tasks, each with its own history (ADR-0116); their cards in one root. */
const R1 = taskIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const R2 = taskIdFor("01a0ffd2-0000-7000-8000-00000000000b")
const _ROOT_ID = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")
const atEnd = (_task: TaskId) =>
  ({
    kind: "note",
    at: atEntry(entryId("e-1")),
    thread: TEST_THREAD,
    cell: 0,
  }) as const
const inventory = { kind: "inventory", holder: ADA } as const

async function setUp() {
  const store = createInMemoryStore()
  const exchange = new Exchange({ principal: "pinetrie-host", store })
  const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
  await whenHydrated(places)
  const histories = createMoveHistories(exchange)
  const card = (id: string, root: TaskId): TextCard => ({
    kind: "text",
    id: textCardId(id),
    owner: ADA,
    placer: ADA,
    place: atEnd(root),
    carries: { kind: "message", command: null },
    unsent: null,
  })
  /** The host's own write, outside any history. */
  const seed = (c: CardRecord) =>
    applyPlaceSteps(places, [{ kind: "write", record: c }])
  /** `writer` moves `c` to `place`, as one step of their history in `root`. */
  const move = async (
    writer: typeof ADA,
    root: TaskId,
    c: TextCard,
    place: TextCard["place"],
  ) =>
    applyPlaceSteps(
      places,
      [{ kind: "write", record: { ...c, place, placer: writer } }],
      await histories.gestureOf(writer, root),
    )
  const placeOf = (id: string) =>
    readPlaces(places).find(c => c.id === id)?.place.kind
  const recordOf = (id: string) => readPlaces(places).find(c => c.id === id)
  return { store, exchange, histories, card, seed, move, placeOf, recordOf }
}

test("a move is one step of its writer's history in its task, and undoes whole after rev was raised (S82)", async () => {
  const { histories, card, seed, move, placeOf } = await setUp()
  const a = card("a", R1)
  seed(a)
  await move(ADA, R1, a, inventory)
  expect(placeOf("a")).toBe("inventory")
  const undone = await histories.step(ADA, R1, "undo")
  expect(undone.kind).toBe("undone")
  expect(placeOf("a")).toBe("note")
  expect((await histories.step(ADA, R1, "redo")).kind).toBe("undone")
  expect(placeOf("a")).toBe("inventory")
  histories.dispose()
})

test("another task's history, and another writer's, are untouched by an undo", async () => {
  const { histories, card, seed, move, placeOf } = await setUp()
  const [a, b, c] = [card("a", R1), card("b", R2), card("c", R1)]
  for (const x of [a, b, c]) seed(x)
  await move(ADA, R1, a, inventory)
  await move(ADA, R2, b, inventory)
  await move(BEA, R1, c, inventory)
  expect((await histories.step(ADA, R1, "undo")).kind).toBe("undone")
  expect([placeOf("a"), placeOf("b"), placeOf("c")]).toEqual([
    "note",
    "inventory",
    "inventory",
  ])
  expect((await histories.step(ADA, R1, "undo")).kind).toBe("none")
  histories.dispose()
})

test("an undo is refused, and nothing reverted, after someone else moved the card", async () => {
  const { histories, card, seed, move, recordOf } = await setUp()
  const a = card("a", R1)
  seed(a)
  await move(ADA, R1, a, inventory)
  await move(BEA, R1, a, atEnd(R2))
  const refused = await histories.step(ADA, R1, "undo")
  expect(refused.kind).toBe("refused")
  // Where Bea put it.
  expect(recordOf("a")).toMatchObject({ place: atEnd(R2), placer: BEA })
  histories.dispose()
})

test("a stored history not loaded is retired by id, and a stack made on it again is empty (S91)", async () => {
  const { store, histories, card, seed, move } = await setUp()
  const a = card("a", R1)
  seed(a)
  await move(ADA, R1, a, inventory)
  expect(histories.loaded()).toEqual([ADA])
  await histories.unloadWriters([ADA])
  expect(histories.loaded()).toEqual([])
  const listed = async () => {
    const out: string[] = []
    for await (const id of store.listDocIds("moves:")) out.push(id)
    return out
  }
  expect(await listed()).toEqual([movesDocId(ADA, R1)])
  await histories.retire([movesDocId(ADA, R1)])
  expect(await listed()).toEqual([])
  expect((await histories.step(ADA, R1, "undo")).kind).toBe("none")
  histories.dispose()
})
