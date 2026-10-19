import {
  type CanvasId,
  type CardCommand,
  type CardId,
  canvasIdFor,
  cardIdOfKind,
  ERR,
  entryId,
  historyScope,
  isTextCard,
  type MoveDirection,
  PERSON_HISTORY,
  type QueueHoldChange,
  type QueueMove,
  type Reorder,
  rootIdFor,
  runId,
  type Sha256,
  storedText,
  type TextCard,
  type ThreadId,
  TRASH_PLACE,
  threadIdFor,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { PLACES_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readCanvases,
  readCardHistories,
  readCardTitles,
  readPlaces,
  readPlacesRev,
  readQueueHolds,
  readRoots,
  readRunning,
  readThreads,
  readTraces,
} from "@pinetrie/reads"
import {
  CARD_HISTORY,
  type CopyThread,
  encodeCard,
  QUEUE_HOLD,
  ROOT as ROOT_RECORD,
  setRecord,
  THREAD as THREAD_RECORD,
  type UndoResult,
  WORKFLOW,
} from "@pinetrie/rules"
import { readingKey, seatKey } from "@pinetrie/schema"
import {
  beginRun,
  newPresenceDoc,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import { describe, expect, test } from "vitest"
import { memoryBlobs } from "../blobs.ts"
import { canvasesNow } from "../canvases.ts"
import {
  applyWrites,
  basics,
  NO_BLANK_CARDS,
  placesFor,
  putCanvas,
  putNoteColumn,
  putValue,
  record,
  row,
  seedChange,
  seedPlaces,
  storedMessage,
  threadRow,
  writeDirectory,
} from "../fakes.ts"
import { popNextQueuedCard } from "../queued-card-pop.ts"
import { type CardCommandDeps, createCardCommands } from "./cards.ts"

const TEST_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")

const TEST_ROOT = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const LANE = threadIdFor("0123456789abcdef")
const E1 = entryId("e-1")
const C1 = cardIdFor("c1")
/** A note column on the lane's canvas (`putNoteColumn`). */
const NOTES = cardIdOfKind(
  "note-column",
  "01a0ffd2-0000-7000-8000-0000000000a1",
)
/** A note in it: a shared place, in the lane's canvas. */
const atEnd = { kind: "note", column: NOTES, order: "a" } as const
const noteKey = { kind: "note", column: NOTES } as const
/** Pinned at the lane's end: a place a trace is left at (`TRACED`). */
const pinnedPlace = {
  kind: "pinned",
  thread: LANE,
  order: "a",
} as const
const pinnedKey = { kind: "pinned", thread: LANE } as const
/** Texts the host holds whole. */
const held = { textNow: () => "x", holds: () => true }
/** An idle lane, its queue not held, nobody typing. */
const idle = {
  running: false,
  away: false,
  held: false,
  typing: new Set<CardId>(),
}
const queuedKey = {
  kind: "queued",
  thread: LANE,
  seen: "",
} as const

/** The places' text cards: a canvas's thread card is the fixture's (`putCanvas`). */
const textsIn = (places: ReturnType<typeof setUp>["b"]["places"]) =>
  readPlaces(places).filter(isTextCard)

function setUp() {
  const b = basics()
  writeEntry(b.root, threadRow(E1, null, LANE))
  writeLaneTip(b.root, LANE, E1)
  // The lane's thread's card, on the canvas a move's history is in.
  putCanvas(b, LANE, TEST_CANVAS)
  putNoteColumn(b, NOTES, TEST_CANVAS)
  // Each card's text as the host holds it.
  const texts = new Map<string, string>()
  const cards = record<CardCommandDeps["cards"]>({
    destroy: async () => {},
    hydrate: async () => {},
    blankQueued: NO_BLANK_CARDS.blankQueued,
    textNow: id => texts.get(id) ?? "",
  })
  const drains: string[] = []
  // Each run a take stopped, and who stopped it.
  const stops: [ThreadId, WriterId][] = []
  // Which history each move was recorded in; an undo answers `undoing`.
  let undoing: UndoResult = { kind: "none" }
  // What an undo writes before it answers, as Kyneta writes its revert.
  let reverting = () => {}
  const recorded: [string, string][] = []
  const histories = record<CardCommandDeps["histories"]>({
    gestureOf: async (writer, scope) => write => {
      recorded.push([writer, scope.kind === "canvas" ? scope.canvas : "person"])
      return write()
    },
    step: async () => {
      reverting()
      return undoing as never
    },
    // The step an undo would try: the one it answers with.
    top: async () =>
      (undoing.kind === "none" ? undefined : undoing.step) as never,
    unloadCanvas: async () => {},
  })
  const presence = newPresenceDoc()
  const { placesWriter, provenance } = placesFor(b, {
    presence,
    texts: cards.port,
  })
  // Each run a take stopped, as the dispatcher stops it (`onTaken`).
  provenance.onTaken(async (threads, by) => {
    for (const lane of threads)
      if (readRunning(b.live, lane)) stops.push([lane, by])
  })
  const blobs = memoryBlobs()
  const raw = createCardCommands({
    basics: b,
    blobs,
    cards: cards.port,
    drain: lane => void drains.push(lane),
    histories: histories.port,
    placesWriter,
    provenance,
    records: { writeValues: async writes => applyWrites(b, writes) },
    ensureNames: async () => {},
  })
  // Each command gathers the canvas index once, as the dispatcher does.
  type Raw = typeof raw
  const commands = {
    ...raw,
    move: (w: WriterId, m: Parameters<Raw["move"]>[1], h: CanvasId | null) =>
      raw.move(w, m, h, canvasesNow(b)),
    queueCard: (
      w: WriterId,
      m: QueueMove,
      h: QueueHoldChange,
      c: CardCommand | null,
    ) => raw.queueCard(w, m, h, c, canvasesNow(b)),
    reorder: (w: WriterId, r: Reorder) => raw.reorder(w, r, canvasesNow(b)),
    unqueueAll: (w: WriterId, l: ThreadId) =>
      raw.unqueueAll(w, l, canvasesNow(b)),
    undoMove: (w: WriterId, t: CanvasId | null, d: MoveDirection) =>
      raw.undoMove(w, historyScope(t), d, canvasesNow(b)),
    spinOff: (
      w: WriterId,
      r: Parameters<Raw["spinOff"]>[1],
      start: Parameters<Raw["spinOff"]>[2],
    ) => raw.spinOff(w, r, start, canvasesNow(b)),
    copyThread: (w: WriterId, c: CopyThread) =>
      raw.copyThread(w, c, canvasesNow(b)),
    paste: (w: WriterId, p: Parameters<Raw["paste"]>[1]) =>
      raw.paste(w, p, canvasesNow(b)),
    putImages: (w: WriterId, p: Parameters<Raw["putImages"]>[1]) =>
      raw.putImages(w, p, canvasesNow(b)),
    version: (w: WriterId, v: Parameters<Raw["version"]>[1]) =>
      raw.version(w, v, canvasesNow(b)),
    cardWidth: (w: WriterId, c: Parameters<Raw["cardWidth"]>[1]) =>
      raw.cardWidth(w, c, canvasesNow(b)),
  }
  const undoes = (result: UndoResult, revert: () => void = () => {}) => {
    undoing = result
    reverting = revert
  }
  const put = (over: Partial<TextCard> = {}) =>
    seedPlaces(b.places, [
      {
        kind: "write",
        record: {
          kind: "text" as const,
          id: C1,
          owner: ADA,
          placer: ADA,
          place: atEnd,
          content: { command: null, unsent: null, origin: null },
          ...over,
        },
      },
    ])
  return {
    b,
    blobs,
    cards,
    texts,
    drains,
    stops,
    commands,
    raw,
    put,
    histories,
    undoes,
    recorded,
    presence,
  }
}

describe("moves on the documents' keeper: the next queued card's pop and an unqueue in either order", () => {
  test("a queue on an idle lane asks for its drain, and answers with the rev of its write", async () => {
    const { b, drains, commands, put } = setUp()
    put()
    const done = await commands.move(
      BEA,
      [
        {
          card: C1,
          from: atEnd,
          to: queuedKey,
        },
      ],
      null,
    )
    expect(done).toEqual({ outcome: { kind: "moved" }, rev: 4 })
    expect(drains).toEqual([LANE])
    expect(textsIn(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      by: BEA,
    })
  })

  test("the pop, then an unqueue: answered gone, with the current rev", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    const top = popNextQueuedCard(
      seedChange(b.places),
      b.places,
      LANE,
      idle,
      held,
    )
    expect(top.kind === "popped" ? top.popped.card.id : top.kind).toBe(C1)
    const done = await commands.move(
      ADA,
      [
        {
          card: C1,
          from: queuedKey,
          to: atEnd,
        },
      ],
      null,
    )
    expect(done).toEqual({
      outcome: { kind: "unmoved", code: "gone", place: null, by: null },
      rev: readPlacesRev(b.places),
    })
  })

  test("an unqueue, then the pop: nothing is popped", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    await commands.move(ADA, [{ card: C1, from: queuedKey, to: atEnd }], null)
    expect(
      popNextQueuedCard(seedChange(b.places), b.places, LANE, idle, held).kind,
    ).toBe("idle")
  })

  test("a move someone else made first: answered moved, naming them", async () => {
    const { commands, put } = setUp()
    put({ place: { ...queuedKey, order: "a", by: BEA }, placer: BEA })
    const done = await commands.move(
      ADA,
      [
        {
          card: C1,
          from: atEnd,
          to: queuedKey,
        },
      ],
      null,
    )
    expect(done.outcome).toEqual({
      kind: "unmoved",
      code: "moved",
      place: queuedKey,
      by: BEA,
    })
  })

  test("the host names trashing's history: the canvas you are on, or the canvas of the thread it leaves", async () => {
    const elsewhere = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000ee")
    const gone = { kind: "trash" } as const
    const mine = { kind: "inventory", holder: ADA } as const
    const held = setUp()
    held.put({ place: mine })
    await held.commands.move(
      ADA,
      [{ card: C1, from: mine, to: gone }],
      elsewhere,
    )
    expect(textsIn(held.b.places)[0]?.place).toEqual({ ...gone, left: mine })
    expect(held.recorded).toEqual([[ADA, elsewhere]])
    const atThread = setUp()
    atThread.put()
    await atThread.commands.move(
      ADA,
      [{ card: C1, from: atEnd, to: gone }],
      elsewhere,
    )
    expect(textsIn(atThread.b.places)[0]?.place).toMatchObject(gone)
    expect(atThread.recorded).toEqual([[ADA, TEST_CANVAS]])
  })

  test("an unsent new canvas's thread trashed: the canvas's card goes to your trash in the same step", async () => {
    const { b, commands, recorded } = setUp()
    const TAB = threadIdFor("01a0ffd2-0000-7000-8000-0000000000f7")
    const TAB_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000f8")
    // Its root is one the directory does not name: nothing is written in it.
    putCanvas(
      b,
      TAB,
      TAB_CANVAS,
      rootIdFor("01a0ffd2-0000-7000-8000-0000000000f9"),
    )
    expect(readCanvases(b.places).has(TAB_CANVAS)).toBe(true)
    await commands.move(
      ADA,
      [
        {
          card: TAB,
          from: { kind: "canvas", canvas: TAB_CANVAS },
          to: { kind: "trash" },
        },
      ],
      TAB_CANVAS,
    )
    expect(readPlaces(b.places).find(c => c.id === TAB)?.place.kind).toBe(
      "trash",
    )
    expect(readCanvases(b.places).has(TAB_CANVAS)).toBe(false)
    expect(
      readPlaces(b.places).find(c => c.id === TAB_CANVAS)?.place,
    ).toMatchObject({ kind: "trash", left: { kind: "board" } })
    expect(recorded).toEqual([[ADA, "person"]])
  })

  test("a canvas's card moved on the board: between states in your history outside any canvas, a reorder in none", async () => {
    const { b, raw, recorded } = setUp()
    const at = (state: string) => workflowStateIdFor(state)
    const card = readPlaces(b.places).find(c => c.id === TEST_CANVAS)
    if (card?.kind !== "canvas")
      throw new Error("the test's canvas has its card")
    const moved = {
      ...card,
      place: { kind: "board", state: at("d"), order: "z" },
    } as const
    const done = await raw.placeCanvas(ADA, {
      kind: "move",
      transition: "within",
      steps: [{ kind: "write", record: moved }],
    })
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(readPlaces(b.places).find(c => c.id === TEST_CANVAS)?.place).toEqual(
      moved.place,
    )
    expect(recorded).toEqual([[ADA, "person"]])
    await raw.placeCanvas(ADA, {
      kind: "reorder",
      transition: "within",
      steps: [
        {
          kind: "write",
          record: { ...moved, place: { ...moved.place, order: "y" } },
        },
      ],
    })
    expect(recorded).toEqual([[ADA, "person"]])
  })

  test("an undo or a redo that would move a canvas's card across the archive's edge is refused `archived`, nothing reverted", async () => {
    const { b, commands, undoes } = setUp()
    const [doing, done] = [workflowStateIdFor("d"), workflowStateIdFor("x")]
    putValue(
      b,
      setRecord(WORKFLOW, {
        open: [{ id: doing, name: "Doing" }],
        archive: { id: done, name: "Done" },
      }),
    )
    putValue(
      b,
      setRecord(CARD_HISTORY, {
        card: TEST_CANVAS,
        events: [
          {
            kind: "moved",
            by: ADA,
            from: { kind: "board", state: doing },
            to: { kind: "board", state: done },
            at: 1,
          },
        ],
      }),
    )
    let reverted = false
    undoes(
      {
        kind: "undone",
        step: {
          parts: [
            { docId: PLACES_DOC_ID, footprint: [["cards", TEST_CANVAS]] },
          ],
        },
      },
      () => {
        reverted = true
      },
    )
    for (const direction of ["undo", "redo"] as const) {
      const answer = await commands.undoMove(ADA, null, direction)
      expect(answer.outcome).toMatchObject({
        kind: "unmoved",
        code: "archived",
      })
    }
    expect(reverted).toBe(false)
  })

  test("trashing from your inventory on no canvas is in your history outside any canvas, and undone there", async () => {
    const gone = { kind: "trash" } as const
    const mine = { kind: "inventory", holder: ADA } as const
    const { b, commands, put, recorded, histories } = setUp()
    put({ place: mine })
    await commands.move(ADA, [{ card: C1, from: mine, to: gone }], null)
    expect(textsIn(b.places)[0]?.place).toEqual({ ...gone, left: mine })
    expect(recorded).toEqual([[ADA, "person"]])
    await commands.undoMove(ADA, null, "undo")
    expect(histories.calls.at(-1)?.args).toEqual([ADA, PERSON_HISTORY, "undo"])
  })

  test("trashing keeps the card, gone, in the trasher's history of its canvas: no text is destroyed, and its placer gets a trace", async () => {
    const { b, cards, commands, put, recorded } = setUp()
    put({ placer: BEA, place: pinnedPlace })
    const gone = { kind: "trash" } as const
    expect(
      (
        await commands.move(
          ADA,
          [{ card: C1, from: pinnedKey, to: gone }],
          null,
        )
      ).outcome,
    ).toEqual({ kind: "moved" })
    expect(textsIn(b.places).map(c => c.place)).toEqual([
      { ...gone, left: pinnedPlace },
    ])
    expect(cards.calls).toEqual([])
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
    expect([...readTraces(b.session).values()]).toMatchObject([
      { for: BEA, by: ADA, from: pinnedKey },
    ])
  })
})

describe("a thread's card taken, put and moved", () => {
  const OTHER_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000d")
  const onCanvas = { kind: "canvas", canvas: TEST_CANVAS } as const
  const bea = { kind: "inventory", holder: BEA } as const

  test("taken into an inventory, its run stops with the move, the taker's own stop", async () => {
    const { b, stops, commands } = setUp()
    beginRun(b.live, LANE, runId("r-1"))
    const done = await commands.move(
      BEA,
      [{ card: LANE, from: onCanvas, to: bea }],
      null,
    )
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(readPlaces(b.places).find(c => c.id === LANE)?.place).toEqual(bea)
    expect(stops).toEqual([[LANE, BEA]])
  })

  test("taken while idle, nothing is stopped; put on a canvas, its queue is drained", async () => {
    const { stops, drains, commands } = setUp()
    await commands.move(BEA, [{ card: LANE, from: onCanvas, to: bea }], null)
    expect(stops).toEqual([])
    expect(drains).toEqual([])
    await commands.move(
      BEA,
      [
        {
          card: LANE,
          from: bea,
          to: { kind: "canvas-at", canvas: TEST_CANVAS, after: null },
        },
      ],
      null,
    )
    expect(drains).toEqual([LANE])
  })

  test("an undo that puts a running thread back in an inventory stops it too: the stop follows the places change, whatever wrote it", async () => {
    const { b, stops, commands, undoes } = setUp()
    beginRun(b.live, LANE, runId("r-1"))
    const card = readPlaces(b.places).find(c => c.id === LANE)
    if (card?.kind !== "thread") throw new Error("no thread card")
    undoes(
      {
        kind: "undone",
        step: {
          parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", LANE]] }],
        },
      },
      () =>
        seedPlaces(b.places, [
          { kind: "write", record: { ...card, place: bea } },
        ]),
    )
    await commands.undoMove(BEA, TEST_CANVAS, "undo")
    expect(stops).toEqual([[LANE, BEA]])
  })

  test("moved to another canvas while it runs, it keeps running", async () => {
    const { b, stops, commands } = setUp()
    putCanvas(b, threadIdFor("other"), OTHER_CANVAS)
    beginRun(b.live, LANE, runId("r-1"))
    const done = await commands.move(
      ADA,
      [
        {
          card: LANE,
          from: onCanvas,
          to: { kind: "canvas-at", canvas: OTHER_CANVAS, after: null },
        },
      ],
      null,
    )
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(stops).toEqual([])
  })
})

describe("a paste", () => {
  const REF = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1")
  const reference = {
    kind: "reference",
    card: REF,
    address: { kind: "entry", thread: LANE, entry: E1 },
    quote: "a".repeat(64) as Sha256,
  } as const

  test("a reference pasted on a thread lands in its nearest notes, one step of the paster's history in its canvas", async () => {
    const { b, commands, recorded } = setUp()
    const done = await commands.paste(BEA, {
      kind: "paste",
      paste: reference,
      to: { kind: "notes", near: "thread", thread: LANE },
      replacing: null,
      here: null,
    })
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(readPlaces(b.places).find(c => c.id === REF)?.place).toMatchObject({
      kind: "note",
      column: NOTES,
    })
    expect(recorded).toEqual([[BEA, TEST_CANVAS]])
  })

  test("a cut card, trashed, is pasted out of its cutter's trash into another place", async () => {
    const { b, commands, put } = setUp()
    put({ owner: BEA })
    await commands.move(
      BEA,
      [{ card: C1, from: noteKey, to: TRASH_PLACE }],
      null,
    )
    const done = await commands.paste(BEA, {
      kind: "paste",
      paste: { kind: "uncut", card: C1 },
      to: { kind: "inventory", holder: BEA },
      replacing: null,
      here: null,
    })
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(readPlaces(b.places).find(c => c.id === C1)?.place).toEqual({
      kind: "inventory",
      holder: BEA,
    })
  })
})

describe("a thread copied", () => {
  const COPY = threadIdFor("copy")
  const copy = (to: CopyThread["move"]["to"]): CopyThread => ({
    source: LANE,
    end: E1,
    move: { card: COPY, from: null, to },
  })

  test("its record names its fork, its card lands where it was dropped, and no entry is written", async () => {
    const { b, commands } = setUp()
    const done = await commands.copyThread(
      BEA,
      copy({ kind: "canvas-at", canvas: TEST_CANVAS, after: LANE }),
    )
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(readThreads(b.session).get(COPY)).toMatchObject({
      root: TEST_ROOT,
      by: BEA,
      origin: { kind: "fork", at: E1, how: "copy" },
    })
    const placed = readPlaces(b.places).filter(
      c => c.place.kind === "canvas" && c.place.canvas === TEST_CANVAS,
    )
    expect(placed.map(c => c.id)).toEqual(expect.arrayContaining([LANE, COPY]))
  })

  test("a copy is one step of its copier's history, in the canvas it lands in", async () => {
    const { commands, recorded } = setUp()
    await commands.copyThread(
      BEA,
      copy({ kind: "canvas-at", canvas: TEST_CANVAS, after: LANE }),
    )
    expect(recorded).toEqual([[BEA, TEST_CANVAS]])
  })

  test("refused: an end not in its source; a thread someone else holds", async () => {
    const { b, commands } = setUp()
    expect(
      (
        await commands.copyThread(BEA, {
          ...copy({ kind: "inventory", holder: BEA }),
          end: entryId("e-none"),
        })
      ).outcome,
    ).toMatchObject({ kind: "refused", code: ERR.UNKNOWN_TARGET })
    await commands.move(
      ADA,
      [
        {
          card: LANE,
          from: { kind: "canvas", canvas: TEST_CANVAS },
          to: { kind: "inventory", holder: ADA },
        },
      ],
      null,
    )
    expect(
      (await commands.copyThread(BEA, copy({ kind: "inventory", holder: BEA })))
        .outcome,
    ).toMatchObject({ kind: "refused", code: ERR.REFUSED })
    expect(readThreads(b.session).has(COPY)).toBe(false)
  })
})

describe("queue-card", () => {
  test("release: the card queued last and the hold gone in one step, then the lane drained", async () => {
    const { b, commands, put, drains, recorded } = setUp()
    put()
    applyWrites(b, [setRecord(QUEUE_HOLD, { lane: LANE, by: BEA, at: 1 })])
    const done = await commands.queueCard(
      ADA,
      { card: C1, from: atEnd, to: queuedKey },
      "release",
      null,
    )
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(readQueueHolds(b.session).has(LANE)).toBe(false)
    expect(textsIn(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      by: ADA,
    })
    expect(drains).toEqual([LANE])
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
  })

  test("hold-if-idle holds an idle queue before the drain; a refused move changes no hold", async () => {
    const { b, commands, put } = setUp()
    put()
    await commands.queueCard(
      ADA,
      { card: C1, from: atEnd, to: queuedKey },
      "hold-if-idle",
      null,
    )
    expect(readQueueHolds(b.session).get(LANE)?.by).toBe(ADA)
    const other = setUp()
    const refused = await other.commands.queueCard(
      ADA,
      { card: C1, from: atEnd, to: queuedKey },
      "hold-if-idle",
      null,
    )
    expect(refused.outcome).toMatchObject({ kind: "unmoved", code: "gone" })
    expect(readQueueHolds(other.b.session).size).toBe(0)
  })
})

test("a card made in the queue is written there with its command, never in another place, and drains", async () => {
  const { b, commands, drains, recorded } = setUp()
  const done = await commands.queueCard(
    ADA,
    { card: C1, from: null, to: queuedKey },
    "keep",
    "get-latest",
  )
  expect(done.outcome).toEqual({ kind: "moved" })
  expect(textsIn(b.places)).toMatchObject([
    {
      kind: "text" as const,
      id: C1,
      place: { kind: "queued", by: ADA },
      content: { command: "get-latest" },
    },
  ])
  expect(drains).toEqual([LANE])
  expect(recorded).toEqual([])
})

describe("moves' history", () => {
  const inventory = { kind: "inventory", holder: ADA } as const

  test("a take into the inventory is one step of the taker's history in the root it left; a creation is in none", async () => {
    const { commands, put, recorded } = setUp()
    put()
    await commands.move(ADA, [{ card: C1, from: atEnd, to: inventory }], null)
    await commands.move(
      ADA,
      [
        {
          card: cardIdFor("c2"),
          from: null,
          to: inventory,
        },
      ],
      null,
    )
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
  })

  test("several moves are one, refused whole: nothing written when one has moved", async () => {
    const { b, commands, put } = setUp()
    const unstarted = { kind: "composing", thread: threadIdFor("new") } as const
    put({ place: unstarted })
    const before = textsIn(b.places)
    const done = await commands.move(
      ADA,
      [
        { card: C1, from: unstarted, to: inventory },
        {
          card: cardIdFor("c9"),
          from: unstarted,
          to: inventory,
        },
      ],
      null,
    )
    expect(done.outcome).toMatchObject({ kind: "unmoved", code: "gone" })
    expect(textsIn(b.places)).toEqual(before)
  })

  test("an undo answers each card it moved and where it is now, with a rev raised after it", async () => {
    const { b, commands, put, histories, undoes } = setUp()
    put()
    const rev = readPlacesRev(b.places)
    const was = textsIn(b.places)[0]
    // Kyneta writes the revert itself, with no `rev`.
    undoes(
      {
        kind: "undone",
        step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
      },
      () => {
        if (was !== undefined)
          b.places.cards.set(
            C1,
            encodeCard({ ...was, place: { ...atEnd, order: "b" } }),
          )
      },
    )
    const done = await commands.undoMove(ADA, TEST_CANVAS, "undo")
    expect(done).toEqual({
      outcome: { kind: "undone", cards: [{ card: C1, place: noteKey }] },
      rev: rev + 1,
    })
    expect(histories.calls.at(-1)?.args).toEqual([
      ADA,
      historyScope(TEST_CANVAS),
      "undo",
    ])
  })

  test("a refused undo names who moved the card; one with nothing to undo is nothing", async () => {
    const { commands, put, undoes } = setUp()
    put({ placer: BEA })
    const part = { docId: PLACES_DOC_ID, footprint: [["cards", C1]] }
    undoes({ kind: "refused", step: { parts: [part] }, stale: [part] })
    expect((await commands.undoMove(ADA, TEST_CANVAS, "undo")).outcome).toEqual(
      {
        kind: "unmoved",
        code: "moved",
        place: noteKey,
        by: BEA,
      },
    )
    undoes({ kind: "none" })
    expect(await commands.undoMove(ADA, TEST_CANVAS, "redo")).toEqual({
      outcome: { kind: "nothing" },
      rev: null,
    })
  })
})

describe("reorders and unqueue all", () => {
  const queuedAt = (order: string) => ({ ...queuedKey, order, by: BEA })

  test("a reorder writes only the card's order, in the sender's history of its root, with the rev; it drains nothing", async () => {
    const { b, commands, put, recorded, drains } = setUp()
    put({ place: queuedAt("0000000100"), placer: BEA })
    seedPlaces(b.places, [
      {
        kind: "write",
        record: {
          kind: "text" as const,
          id: cardIdFor("c2"),
          owner: ADA,
          placer: ADA,
          place: queuedAt("0000000300"),
          content: { command: null, unsent: null, origin: null },
        },
      },
    ])
    const done = await commands.reorder(ADA, {
      card: cardIdFor("c2"),
      at: queuedKey,
      after: null,
      before: C1,
    })
    expect(done).toEqual({
      outcome: { kind: "moved" },
      rev: readPlacesRev(b.places),
    })
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
    expect(drains).toEqual([])
    const order = textsIn(b.places).map(c => c.id)
    const queue = textsIn(b.places)
      .filter(c => c.place.kind === "queued")
      .sort((x, y) =>
        (x.place as { order: string }).order <
        (y.place as { order: string }).order
          ? -1
          : 1,
      )
      .map(c => c.id)
    expect(order).toHaveLength(2)
    expect(queue).toEqual([cardIdFor("c2"), C1])
  })

  test("a width writes only the card's width, in the sender's history of its canvas; the width it has, nothing", async () => {
    const { b, commands, recorded, drains } = setUp()
    const at = { kind: "canvas", canvas: TEST_CANVAS } as const
    const done = await commands.cardWidth(ADA, {
      kind: "card-width",
      card: LANE,
      at,
      width: 2,
    })
    expect(done).toEqual({
      outcome: { kind: "moved" },
      rev: readPlacesRev(b.places),
    })
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
    expect(drains).toEqual([])
    const card = readPlaces(b.places).find(c => c.id === LANE)
    expect(card?.place).toMatchObject({ kind: "canvas", width: 2 })
    expect(card?.placer).not.toBe(ADA)
    expect(
      await commands.cardWidth(ADA, {
        kind: "card-width",
        card: LANE,
        at,
        width: 2,
      }),
    ).toEqual({ outcome: { kind: "nothing" }, rev: null })
  })

  test("unqueue all: every queued card below the line in one step of the sender's history; with none queued, nothing", async () => {
    const { b, commands, put, recorded } = setUp()
    expect(await commands.unqueueAll(ADA, LANE)).toEqual({
      outcome: { kind: "nothing" },
      rev: null,
    })
    put({ place: queuedAt("a") })
    seedPlaces(b.places, [
      {
        kind: "write",
        record: {
          kind: "text" as const,
          id: cardIdFor("c2"),
          owner: BEA,
          placer: BEA,
          place: queuedAt("b"),
          content: { command: null, unsent: null, origin: null },
        },
      },
    ])
    const done = await commands.unqueueAll(ADA, LANE)
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(textsIn(b.places).map(c => c.place.kind)).toEqual(["note", "note"])
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
  })
})

describe("a chat from a card that found its lane busy", () => {
  const said = {
    kind: "send",
    text: "@bob look",
    root: TEST_ROOT,
    at: { kind: "end", thread: LANE, seen: E1 },
    mentions: [],
    card: { id: C1, seen: "" },
    pinned: [],
    base: null,
    state: null,
  } as const

  test("its card is queued behind the others in the same step, and answered queued with the rev", async () => {
    const { b, drains, commands, put } = setUp()
    put()
    beginRun(b.live, LANE, runId("r-1"))
    const done = await commands.queueBusy(ADA, said)
    expect(done).toEqual({ outcome: { kind: "queued" }, rev: 4 })
    expect(textsIn(b.places)[0]?.place).toMatchObject({
      kind: "queued",
      thread: LANE,
      by: ADA,
    })
    // The lane runs: its end drains it.
    expect(drains).toEqual([])
  })

  test("a card the host does not hold stays a busy answer", async () => {
    const { b, commands } = setUp()
    beginRun(b.live, LANE, runId("r-1"))
    expect(await commands.queueBusy(ADA, said)).toBeNull()
  })
})

test("set-command: the command set, its place and placer kept", async () => {
  const { b, commands, put } = setUp()
  put({ placer: BEA })
  const done = await commands.setCommand(ADA, C1, "get-latest")
  expect(done).toEqual({ outcome: { kind: "moved" }, rev: 4 })
  expect(textsIn(b.places)[0]).toMatchObject({
    content: { command: "get-latest" },
    placer: BEA,
    place: atEnd,
  })
})

const aSend = {
  kind: "send",
  text: "hi",
  root: TEST_ROOT,
  at: { kind: "end", thread: LANE, seen: E1 },
  mentions: [],
  card: { id: C1, seen: "" },
  pinned: [],
  base: null,
  state: null,
} as const

test("spend: the record goes, then its text; a card already gone answers the current rev", async () => {
  const { b, cards, commands, put } = setUp()
  put()
  const sent = { sendId: "s-1", send: aSend }
  expect(await commands.spend(ADA, C1, sent)).toBe(4)
  expect(await commands.spend(ADA, C1, sent)).toBe(4)
  expect(textsIn(b.places)).toEqual([])
  expect(cards.calls.map(c => c.method)).toEqual(["destroy", "destroy"])
})

describe("every command that moves a card records it", () => {
  const eventsOf = (b: ReturnType<typeof setUp>["b"]) =>
    (readCardHistories(b.session).get(C1)?.events ?? []).map(e => [
      e.kind,
      e.by,
      e.to.kind,
    ])
  const tracesOf = (b: ReturnType<typeof setUp>["b"]) => [
    ...readTraces(b.session).values(),
  ]
  // A reader names the end it reads and its canvas: only a canvas someone reads
  // has its roots read.
  const reading = (s: ReturnType<typeof setUp>, writer: string) => {
    s.presence.reading.set(readingKey(seatKey(writer, "s1"), "k"), E1)
    s.presence.readingCanvas.set(
      readingKey(seatKey(writer, "s1"), "k"),
      TEST_CANVAS,
    )
  }

  test("a move: an event; and a trace for the card's placer, who was not reading its thread", async () => {
    const { b, commands, put } = setUp()
    put({ place: pinnedPlace })
    await commands.move(
      BEA,
      [{ card: C1, from: pinnedKey, to: queuedKey }],
      null,
    )
    expect(eventsOf(b)).toEqual([["moved", BEA, "queued"]])
    expect(tracesOf(b)).toMatchObject([{ for: ADA, by: BEA, card: C1 }])
  })

  test("no trace while the placer reads the card's thread end", async () => {
    const s = setUp()
    const pinned = { ...queuedKey, kind: "pinned", order: "a" } as const
    s.put({ place: pinned })
    writeDirectory(s.b)
    reading(s, ADA)
    await s.commands.move(
      BEA,
      [
        {
          card: C1,
          from: { kind: "pinned", thread: LANE },
          to: queuedKey,
        },
      ],
      null,
    )
    expect(tracesOf(s.b)).toEqual([])
  })

  test("an undo, whose revert Kyneta writes: an event, and the trace it makes moot goes", async () => {
    const { b, commands, put, undoes } = setUp()
    put()
    await commands.move(BEA, [{ card: C1, from: atEnd, to: queuedKey }], null)
    undoes(
      {
        kind: "undone",
        step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
      },
      () => void put(),
    )
    await commands.undoMove(BEA, TEST_CANVAS, "undo")
    expect(eventsOf(b).at(-1)).toEqual(["undone", BEA, "note"])
    expect(tracesOf(b)).toEqual([])
  })

  test("a spend: the history goes with the card, and the trace carries the message", async () => {
    const { b, commands, put } = setUp()
    put({ place: pinnedPlace })
    await commands.move(
      ADA,
      [{ card: C1, from: pinnedKey, to: queuedKey }],
      null,
    )
    await commands.move(
      ADA,
      [{ card: C1, from: queuedKey, to: pinnedKey }],
      null,
    )
    expect(eventsOf(b)).toHaveLength(2)
    const sent = entryId("e-2")
    writeEntry(b.root, row(sent, E1, storedMessage("hi", { sendId: "s-1" })))
    await commands.spend(BEA, C1, { sendId: "s-1", send: aSend })
    expect(readCardHistories(b.session).has(C1)).toBe(false)
    expect(tracesOf(b)).toMatchObject([
      { for: ADA, by: BEA, to: null, message: sent },
    ])
  })

  test("a busy chat's queue: an event", async () => {
    const { b, commands, put } = setUp()
    put()
    beginRun(b.live, LANE, runId("r-1"))
    await commands.queueBusy(ADA, { ...aSend, card: { id: C1, seen: "" } })
    expect(eventsOf(b)).toEqual([["moved", ADA, "queued"]])
  })

  test("traces seen: only the sender's go", async () => {
    const { b, commands, put } = setUp()
    put({ place: pinnedPlace })
    await commands.move(
      BEA,
      [{ card: C1, from: pinnedKey, to: queuedKey }],
      null,
    )
    const [trace] = tracesOf(b)
    await commands.tracesSeen(BEA, [trace?.id ?? ""])
    expect(tracesOf(b)).toHaveLength(1)
    expect(await commands.tracesSeen(ADA, [trace?.id ?? ""])).toEqual({
      outcome: { kind: "seen" },
      rev: null,
    })
    expect(tracesOf(b)).toEqual([])
  })
})

describe("a card made a thread, and lifted back", () => {
  const THREAD = rootIdFor("01a0ffd2-0000-7000-8000-0000000000ff")
  const STARTS = threadIdFor("spun")
  /** The canvas the thread was spun into: a new one. */
  const SPUN_CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000fe")
  const spun = { kind: "trash" } as const
  const spinMove = { card: C1, from: atEnd, to: spun }
  /** The board a new canvas lands on. */
  const board = (b: ReturnType<typeof setUp>["b"]) =>
    putValue(
      b,
      setRecord(WORKFLOW, {
        open: [{ id: workflowStateIdFor("d"), name: "Doing" }],
        archive: { id: workflowStateIdFor("x"), name: "Done" },
      }),
    )
  const spinOff = {
    move: spinMove,
    root: THREAD,
    thread: STARTS,
    canvas: SPUN_CANVAS,
    state: null,
    here: null,
  }
  /** The thread as the directory names it, with `writers`' messages in it. */
  const thread = async (
    b: ReturnType<typeof setUp>["b"],
    writers: readonly (typeof ADA)[],
  ) => {
    applyWrites(b, [
      setRecord(ROOT_RECORD, {
        root: THREAD,
        entry: entryId("t-1"),
        first: entryId("t-1"),
        firstLine: "plan",
        messages: writers.length,
        newest: null,
        writers: [...writers],
        threads: {},
        mentions: [],
        blobs: [],
      }),
    ])
    putCanvas(b, STARTS, SPUN_CANVAS, THREAD)
    // Its record says it was spun from the card.
    putValue(
      b,
      setRecord(THREAD_RECORD, {
        thread: STARTS,
        root: THREAD,
        by: ADA,
        createdAt: 0,
        origin: { kind: "spun", card: C1 },
      }),
    )
    const doc = await b.roots.root(THREAD)
    for (const [i, w] of writers.entries())
      writeEntry(
        doc,
        row(
          `t-${i + 1}`,
          i === 0 ? null : `t-${i}`,
          storedMessage("x", { author: w, sendId: `s-t-${i + 1}` }),
        ),
      )
  }

  test("the thread is started with the card's text, never asking the agent, and the card trashed", async () => {
    const { b, commands, put, texts, recorded } = setUp()
    board(b)
    put()
    texts.set(C1, "  plan this @agent with @Bea ")
    const sends: unknown[] = []
    const done = await commands.spinOff(ADA, spinOff, async said => {
      sends.push(said)
      return { kind: "appended", id: entryId("t-1") }
    })
    expect(done.outcome).toEqual({ kind: "appended", id: entryId("t-1") })
    expect(sends).toMatchObject([
      {
        text: "plan this @agent with @Bea",
        root: THREAD,
        at: { kind: "branch", thread: STARTS, at: null, canvas: SPUN_CANVAS },
        mentions: [{ kind: "person", name: "Bea" }],
        card: { id: C1 },
        state: null,
      },
    ])
    expect(textsIn(b.places)[0]?.place).toMatchObject({
      ...spun,
      left: { kind: "note" },
    })
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
    expect(readThreads(b.session).get(STARTS)?.origin).toEqual({
      kind: "spun",
      card: C1,
    })
    expect(
      readPlaces(b.places).find(c => c.id === STARTS)?.place,
    ).toMatchObject({ kind: "canvas", canvas: SPUN_CANVAS })
    expect(
      readPlaces(b.places).find(c => c.id === SPUN_CANVAS)?.place,
    ).toMatchObject({ kind: "board", state: workflowStateIdFor("d") })
  })

  test("a thread that is not started leaves the card where it was; a blank card starts none", async () => {
    const { b, commands, put, texts } = setUp()
    board(b)
    put()
    texts.set(C1, "plan")
    const refused = await commands.spinOff(ADA, spinOff, async () => ({
      kind: "refused",
      code: "refused",
      message: "no",
    }))
    expect(refused.outcome.kind).toBe("refused")
    expect(textsIn(b.places)[0]?.place).toEqual(atEnd)
    texts.set(C1, " ")
    let started = false
    const blank = await commands.spinOff(ADA, spinOff, async () => {
      started = true
      return { kind: "appended", id: entryId("t-1") }
    })
    expect(blank.outcome.kind).toBe("refused")
    expect(started).toBe(false)
  })

  const spunStep = {
    kind: "undone",
    step: { parts: [{ docId: PLACES_DOC_ID, footprint: [["cards", C1]] }] },
  } as const

  test("an undo while the thread holds its first message alone lifts it back: the card where it was, the thread deleted", async () => {
    const { b, commands, put, undoes } = setUp()
    put({ place: { ...spun, left: { ...noteKey, order: "m" } } })
    await thread(b, [ADA])
    undoes(spunStep, () => put())
    const done = await commands.undoMove(ADA, TEST_CANVAS, "undo")
    expect(done.outcome).toEqual({
      kind: "undone",
      cards: [{ card: C1, place: noteKey }],
    })
    expect(readRoots(b.session).has(THREAD)).toBe(false)
    expect(readPlaces(b.places).some(c => c.id === SPUN_CANVAS)).toBe(false)
    expect(readPlaces(b.places).some(c => c.id === STARTS)).toBe(false)
    expect(b.rootsLoaded()).not.toContain(THREAD)
  })

  test("once someone replied, the undo is refused, naming them, and nothing is reverted", async () => {
    const { b, commands, put, undoes } = setUp()
    put({ place: { ...spun, left: { ...noteKey, order: "m" } } })
    await thread(b, [ADA, BEA])
    let reverted = false
    undoes(spunStep, () => {
      reverted = true
    })
    expect((await commands.undoMove(ADA, TEST_CANVAS, "undo")).outcome).toEqual(
      {
        kind: "unmoved",
        code: "replied",
        place: null,
        by: BEA,
      },
    )
    expect(reverted).toBe(false)
    expect(readRoots(b.session).has(THREAD)).toBe(true)
  })
})

describe("a press on a proposal", () => {
  const PROPOSAL = {
    branches: [
      { title: "one", brief: "do one" },
      { title: "two", brief: "do two" },
    ],
  }
  const RESULT = entryId("e-3")
  const FIRST = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b1")
  const SECOND = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b2")
  /** The lane's run, after its chat: a call, its proposal's result, the reply. */
  const proposed = (b: ReturnType<typeof setUp>["b"]) => {
    writeEntry(
      b.root,
      row(
        "e-2",
        "e-1",
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "propose_branches" }],
        },
        LANE,
      ),
    )
    writeEntry(
      b.root,
      row(
        "e-3",
        "e-2",
        {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "propose_branches",
          content: [{ type: "text", text: "proposed" }],
          details: PROPOSAL,
          isError: false,
        },
        LANE,
      ),
    )
    writeEntry(
      b.root,
      row(
        "e-4",
        "e-3",
        { role: "assistant", content: [{ type: "text", text: "two" }] },
        LANE,
      ),
    )
    writeLaneTip(b.root, LANE, entryId("e-4"))
  }
  const start = {
    kind: "branch-out",
    how: "start",
    root: TEST_ROOT,
    canvas: TEST_CANVAS,
    proposal: RESULT,
    branches: [
      { thread: FIRST, row: 0, brief: "do one" },
      { thread: SECOND, row: 1, brief: "do two" },
    ],
  } as const

  test("Start opens every branch in one change before any send, sends each in order, then queues one fact", async () => {
    const { b, raw } = setUp()
    proposed(b)
    const seenAtSend: boolean[] = []
    const sent: string[] = []
    const facts: unknown[] = []
    const done = await raw.branchOut(
      ADA,
      start,
      canvasesNow(b),
      async said => {
        const cards = readPlaces(b.places)
        seenAtSend.push(
          cards.some(c => c.id === FIRST) && cards.some(c => c.id === SECOND),
        )
        sent.push(said.text)
        return { kind: "started", runId: runId("r") }
      },
      async fact => void facts.push(fact),
    )
    expect(done.outcome).toEqual({ kind: "moved" })
    expect(seenAtSend).toEqual([true, true])
    expect(sent).toEqual(["@agent do one", "@agent do two"])
    expect(facts).toMatchObject([
      { kind: "branched", lane: LANE, how: "started", titles: ["one", "two"] },
    ])
    expect(readThreads(b.session).get(SECOND)?.origin).toEqual({
      kind: "fork",
      at: entryId("e-4"),
      how: "branch",
      proposal: { entry: RESULT, row: 1 },
    })
  })

  test("a refused send leaves its thread opened, and a second press is refused as spent", async () => {
    const { b, raw } = setUp()
    proposed(b)
    const refuse = async () =>
      ({ kind: "refused", code: "refused", message: "no" }) as const
    await raw.branchOut(ADA, start, canvasesNow(b), refuse, async () => {})
    expect(readPlaces(b.places).some(c => c.id === FIRST)).toBe(true)
    const again = await raw.branchOut(
      BEA,
      {
        ...start,
        branches: [
          {
            thread: threadIdFor("01a0ffd2-0000-7000-8000-0000000000b3"),
            row: 0,
            brief: "x",
          },
        ],
      },
      canvasesNow(b),
      refuse,
      async () => {},
    )
    expect(again.outcome).toMatchObject({
      kind: "refused",
      message: "someone has already opened these branches",
    })
  })
})

describe("images in a media column", () => {
  const png = (shade: number) => ({
    bytes: new Uint8Array([shade]),
    mimeType: "image/png" as const,
    width: 40,
    height: 30,
  })
  const image = (n: number) =>
    cardIdOfKind("image", `01a0ffd2-0000-7000-8000-0000000000b${n}`)

  test("a put at a spot on the canvas makes a media column there, its images in it, each titled by its file's name", async () => {
    const { b, blobs, commands, recorded } = setUp()
    const [a, c] = [blobs.put(png(1)), blobs.put(png(2))]
    const out = await commands.putImages(ADA, {
      kind: "put-images",
      images: [
        { card: image(1), sha256: a.sha256, name: "home.png" },
        { card: image(2), sha256: c.sha256, name: "login.png" },
      ],
      to: { kind: "canvas-at", canvas: TEST_CANVAS, after: LANE },
      made: null,
    })
    expect(out.outcome).toEqual({ kind: "moved" })
    const cards = readPlaces(b.places)
    const column = cards.find(x => x.kind === "media")
    expect(column?.place).toMatchObject({ kind: "canvas", canvas: TEST_CANVAS })
    expect(
      cards.flatMap(x =>
        x.kind === "image" && x.place.kind === "image"
          ? [[x.id, x.place.column, x.content.versions[0]?.sha256]]
          : [],
      ),
    ).toEqual([
      [image(1), column?.id, a.sha256],
      [image(2), column?.id, c.sha256],
    ])
    expect(readCardTitles(b.session).get(image(1))?.title).toBe("home.png")
    expect(recorded).toEqual([[ADA, TEST_CANVAS]])
  })

  test("a blob that is no image, or none, is refused, and nothing is put", async () => {
    const { b, blobs, commands } = setUp()
    const text = blobs.put(storedText("notes"))
    for (const sha256 of [text.sha256, "f".repeat(64) as Sha256])
      expect(
        (
          await commands.putImages(ADA, {
            kind: "put-images",
            images: [{ card: image(1), sha256, name: "x" }],
            to: { kind: "canvas-at", canvas: TEST_CANVAS, after: null },
            made: null,
          })
        ).outcome,
      ).toMatchObject({ kind: "refused" })
    expect(readPlaces(b.places).some(x => x.kind === "image")).toBe(false)
  })

  test("a version is added to an image, after its first", async () => {
    const { b, blobs, commands } = setUp()
    const [a, c] = [blobs.put(png(1)), blobs.put(png(2))]
    await commands.putImages(ADA, {
      kind: "put-images",
      images: [{ card: image(1), sha256: a.sha256, name: "home.png" }],
      to: { kind: "canvas-at", canvas: TEST_CANVAS, after: null },
      made: null,
    })
    await commands.version(ADA, {
      kind: "version",
      image: image(1),
      sha256: c.sha256,
    })
    const held = readPlaces(b.places).find(x => x.id === image(1))
    expect(
      held?.kind === "image" ? held.content.versions.map(v => v.sha256) : [],
    ).toEqual([a.sha256, c.sha256])
  })
})
