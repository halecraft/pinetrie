import {
  type CardId,
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  entryId,
  historyScope,
  indexTree,
  isTextCardId,
  makeCard,
  PERSON_HISTORY,
  rootIdFor,
  type Sha256,
  TEXT_MIME,
  type ThreadRecord,
  TRASH_PLACE,
  threadIdFor,
  UNTICKED,
  writerId,
} from "@pinetrie/core"
import { canvasCard, fromParents, personMessage } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { indexCanvases } from "./canvas-index.ts"
import {
  type CardFacts,
  type CardPlan,
  planCanvasPlacement,
  planCardMove,
  planCardPaste,
  planCardQueue,
  planCardReorder,
  planCardSpend,
  planCardSpinOff,
  planCardTick,
  planCardWidth,
  planImagesPut,
  planImageVersion,
  planThreadCopy,
  planThreadOpening,
  planUndo,
  planUndoAnswer,
  planUndoReach,
  type StoredBlob,
} from "./card-commands.ts"
import { mintContainer } from "./containers.ts"
import { landedThreadCard } from "./fixtures.ts"
import { QUEUE_HOLD } from "./queue-hold.ts"
import { setRecord } from "./records.ts"

const ADA = writerId("ada@x.io")
const uuid = (n: number) =>
  `01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`
const CANVAS = canvasIdFor(uuid(1))
const OTHER = canvasIdFor(uuid(2))
const ROOT = rootIdFor(uuid(3))
const UNSENT_ROOT = rootIdFor(uuid(4))
const T1 = threadIdFor(uuid(5))
const T2 = threadIdFor(uuid(6))
const record = (thread: typeof T1, root = ROOT): ThreadRecord => ({
  thread,
  root,
  by: ADA,
  createdAt: 1,
  origin: { kind: "root" },
})
const t1 = landedThreadCard({ thread: T1, canvas: CANVAS, by: ADA, cards: [] })
const t2 = landedThreadCard({
  thread: T2,
  canvas: CANVAS,
  by: ADA,
  cards: [t1],
})
const CARDS: readonly CardRecord[] = [canvasCard(CANVAS), t1, t2]
const THREADS = new Map([
  [T1, record(T1)],
  [T2, record(T2)],
])
let minted = 0
const facts = (cards: readonly CardRecord[] = CARDS): CardFacts => ({
  cards,
  canvases: indexCanvases(cards, THREADS),
  sender: ADA,
  now: 7,
  running: new Set(),
  newContainer: mintContainer(() => uuid(900 + ++minted)),
})
const stepsOf = <W>(plan: CardPlan<W>) => {
  if (plan.kind !== "steps") throw new Error(`planned ${plan.kind}`)
  return plan
}

describe("planCardMove", () => {
  const moveFacts = (over: Partial<Parameters<typeof planCardMove>[0]>) => ({
    ...facts(),
    moves: [],
    here: null,
    threads: THREADS,
    started: new Set([ROOT]),
    workflow: null,
    entryThreads: new Map(),
    ...over,
  })

  test("a card trashed from a canvas is one step of the history of the canvas it leaves", () => {
    const plan = stepsOf(
      planCardMove(
        moveFacts({
          moves: [
            {
              card: T2,
              from: { kind: "canvas", canvas: CANVAS },
              to: { kind: "trash" },
            },
          ],
          here: OTHER,
        }),
      ),
    )
    expect(plan.history).toEqual(historyScope(CANVAS))
  })

  test("a card trashed from no canvas is one step of the history of the canvas its sender is on", () => {
    const inventory = makeCard(
      "text",
      cardIdOfKind("text", uuid(20)),
      { kind: "inventory", holder: ADA },
      { unsent: null, origin: null, command: null },
      ADA,
    )
    const plan = stepsOf(
      planCardMove({
        ...moveFacts({}),
        ...facts([...CARDS, inventory]),
        moves: [
          {
            card: inventory.id,
            from: { kind: "inventory", holder: ADA },
            to: { kind: "trash" },
          },
        ],
        here: OTHER,
      }),
    )
    expect(plan.history).toEqual(historyScope(OTHER))
  })

  test("an unsent new canvas's thread trashed takes the canvas's card to the trash in the same step, in its closer's history outside any canvas", () => {
    const threads = new Map([...THREADS, [T2, record(T2, UNSENT_ROOT)]])
    const tab = landedThreadCard({
      thread: T2,
      canvas: OTHER,
      by: ADA,
      cards: [],
    })
    const cards = [canvasCard(CANVAS), canvasCard(OTHER, "b"), t1, tab]
    const plan = stepsOf(
      planCardMove({
        ...moveFacts({ threads }),
        ...facts(cards),
        moves: [
          {
            card: T2,
            from: { kind: "canvas", canvas: OTHER },
            to: { kind: "trash" },
          },
        ],
      }),
    )
    expect(plan.history).toEqual(PERSON_HISTORY)
    expect(plan.steps).toContainEqual(
      expect.objectContaining({
        kind: "write",
        record: expect.objectContaining({
          id: OTHER,
          place: expect.objectContaining({ kind: "trash" }),
          placer: ADA,
        }),
      }),
    )
  })
})

describe("planCardPaste", () => {
  test("a new text card pasted on a canvas is one step of its paster's history there", () => {
    const card = cardIdOfKind("text", uuid(30))
    const plan = stepsOf(
      planCardPaste({
        ...facts(),
        pasted: {
          kind: "paste",
          paste: { kind: "text", card, origin: null },
          to: { kind: "canvas-at", canvas: CANVAS, after: null },
          replacing: null,
          here: null,
        },
        entryThreads: new Map(),
      }),
    )
    expect(plan.history).toEqual(historyScope(CANVAS))
    expect(
      plan.steps.some(s => s.kind === "write" && s.record.id === card),
    ).toBe(true)
  })
})

const sha = (c: string) => c.repeat(64) as Sha256
const IMAGE: StoredBlob = {
  ref: { sha256: sha("a"), mimeType: "image/png", width: 4, height: 3 },
  fitted: undefined,
}
const TEXT: StoredBlob = {
  ref: { sha256: sha("b"), mimeType: TEXT_MIME, width: null, height: null },
  fitted: undefined,
}

describe("planImagesPut", () => {
  const put = (name: string) =>
    ({
      kind: "put-images",
      images: [
        { card: cardIdOfKind("image", uuid(40)), sha256: sha("a"), name },
      ],
      to: { kind: "canvas-at", canvas: CANVAS, after: null },
      made: null,
    }) as const

  test("images land in their canvas's history, each titled by its file's name once they have", () => {
    const plan = stepsOf(
      planImagesPut({
        ...facts(),
        put: put("cat.png"),
        blobs: new Map([[sha("a"), IMAGE]]),
      }),
    )
    expect(plan.history).toEqual(historyScope(CANVAS))
    expect(plan.after).toHaveLength(1)
  })

  test("a blob that is no image, or none, is refused, and nothing is put", () => {
    expect(
      planImagesPut({ ...facts(), put: put("cat.png"), blobs: new Map() }),
    ).toEqual({ kind: "declined", why: { kind: "missing", sha256: sha("a") } })
    expect(
      planImagesPut({
        ...facts(),
        put: put("cat.png"),
        blobs: new Map([[sha("a"), TEXT]]),
      }),
    ).toEqual({ kind: "declined", why: { kind: "not-an-image" } })
  })
})

describe("planImageVersion", () => {
  test("a new version is one step of the history of its image's canvas", () => {
    const column = makeCard(
      "media",
      cardIdOfKind("media", uuid(50)),
      { kind: "canvas", canvas: CANVAS, order: "z", width: 1 },
      UNTICKED,
      ADA,
    )
    const image = makeCard(
      "image",
      cardIdOfKind("image", uuid(51)),
      { kind: "image", column: column.id, order: "a" },
      { versions: [] },
      ADA,
    )
    const plan = stepsOf(
      planImageVersion({
        ...facts([...CARDS, column, image]),
        change: { kind: "version", image: image.id, sha256: sha("a") },
        blob: IMAGE,
      }),
    )
    expect(plan.history).toEqual(historyScope(CANVAS))
  })
})

describe("planCardReorder", () => {
  test("a reorder is one step of its canvas's history; one of a card gone is refused", () => {
    const at = { kind: "canvas", canvas: CANVAS } as const
    const plan = stepsOf(
      planCardReorder({
        ...facts(),
        reorder: { card: T1, at, after: T2, before: null },
      }),
    )
    expect(plan.history).toEqual(historyScope(CANVAS))
    expect(
      planCardReorder({
        ...facts(),
        reorder: { card: threadIdFor(uuid(60)), at, after: T2, before: null },
      }),
    ).toEqual({ kind: "refused", code: "gone", now: null })
  })
})

describe("planCardWidth", () => {
  test("a width is one step of its canvas's history; the width it has writes nothing", () => {
    const at = { kind: "canvas", canvas: CANVAS } as const
    expect(
      stepsOf(
        planCardWidth({
          ...facts(),
          change: { kind: "card-width", card: T1, at, width: 2 },
        }),
      ).history,
    ).toEqual(historyScope(CANVAS))
    expect(
      planCardWidth({
        ...facts(),
        change: { kind: "card-width", card: T1, at, width: 1 },
      }),
    ).toEqual({ kind: "nothing" })
  })
})

describe("planCardTick", () => {
  test("a tick is one step of its canvas's history; the state it has writes nothing", () => {
    const at = { kind: "canvas", canvas: CANVAS } as const
    expect(
      stepsOf(
        planCardTick({
          ...facts(),
          change: { kind: "card-tick", card: T1, at, ticked: true },
        }),
      ).history,
    ).toEqual(historyScope(CANVAS))
    expect(
      planCardTick({
        ...facts(),
        change: { kind: "card-tick", card: T1, at, ticked: false },
      }),
    ).toEqual({ kind: "nothing" })
  })
})

describe("planCardQueue", () => {
  test("a card queued with its queue held writes the hold first, in the queue's canvas's history", () => {
    const composing = { kind: "composing", thread: T1 } as const
    const card = makeCard(
      "text",
      cardIdOfKind("text", uuid(70)),
      composing,
      { unsent: null, origin: null, command: null },
      ADA,
    )
    const plan = stepsOf(
      planCardQueue({
        ...facts([...CARDS, card]),
        move: {
          card: card.id,
          from: composing,
          to: { kind: "queued", thread: T1, seen: "" },
        },
        hold: "hold-if-idle",
        command: null,
        holds: new Map(),
      }),
    )
    expect(plan.before).toEqual([
      setRecord(QUEUE_HOLD, { lane: T1, by: ADA, at: 7 }),
    ])
    expect(plan.history).toEqual(historyScope(CANVAS))
  })
})

describe("planCardSpend", () => {
  test("a held card's record is removed in no history; one gone writes nothing and leaves its text to destroy", () => {
    const gone = cardIdOfKind("text", uuid(72))
    if (!isTextCardId(gone)) throw new Error("a text card's id")
    const held = planCardSpend({ ...facts(), card: gone })
    expect(held.destroyText).toBe(true)
    expect(held.plan.steps).toEqual([])
    const card = makeCard(
      "text",
      cardIdOfKind("text", uuid(71)),
      { kind: "composing", thread: T1 },
      { unsent: null, origin: null, command: null },
      ADA,
    )
    if (!isTextCardId(card.id)) throw new Error("a text card's id")
    const spent = planCardSpend({ ...facts([...CARDS, card]), card: card.id })
    expect(spent).toMatchObject({
      destroyText: false,
      plan: { steps: [{ kind: "remove", id: card.id }], history: null },
    })
  })
})

describe("planCanvasPlacement", () => {
  test("a canvas moved between states is in your history outside any canvas; a reorder within one, in none", () => {
    const steps = [{ kind: "remove", id: OTHER }] as const
    expect(
      stepsOf(
        planCanvasPlacement({ kind: "move", steps, transition: "within" }),
      ).history,
    ).toEqual(PERSON_HISTORY)
    expect(
      stepsOf(
        planCanvasPlacement({ kind: "reorder", steps, transition: "within" }),
      ).history,
    ).toBeNull()
  })
})

describe("planThreadOpening", () => {
  test("a thread opens with its records first and its names after, in no history", () => {
    const thread = threadIdFor(uuid(80))
    const open = {
      thread,
      root: rootIdFor(uuid(81)),
      canvas: CANVAS,
      start: { kind: "new-root", after: null },
    } as const
    const plan = stepsOf(
      planThreadOpening({
        ...facts(),
        open,
        start: open.start,
        threads: THREADS,
        roots: new Set([ROOT]),
        held: new Set([CANVAS]),
        workflow: null,
      }),
    )
    expect(plan.before.length).toBeGreaterThan(0)
    expect(plan.names).toBe(true)
    expect(plan.history).toBeNull()
  })
})

describe("planThreadCopy", () => {
  test("a copy of a source whose root holds no tree is refused unknown", () => {
    expect(
      planThreadCopy({
        ...facts(),
        copy: {
          source: T1,
          end: entryId("e"),
          move: {
            card: threadIdFor(uuid(90)),
            from: null,
            to: { kind: "canvas-at", canvas: CANVAS, after: null },
          },
        } as Parameters<typeof planThreadCopy>[0]["copy"],
        threads: THREADS,
        index: null,
      }),
    ).toEqual({ kind: "declined", why: "unknown" })
  })
})

describe("planCardSpinOff", () => {
  const request = (card: CardId) =>
    ({
      move: { card, from: { kind: "canvas", canvas: CANVAS }, to: TRASH_PLACE },
      root: rootIdFor(uuid(100)),
      thread: threadIdFor(uuid(101)),
      canvas: canvasIdFor(uuid(102)),
      state: null,
      here: CANVAS,
    }) as Parameters<typeof planCardSpinOff>[0]["request"]
  const spin = (card: CardId, text: string) =>
    planCardSpinOff({
      ...facts(),
      request: request(card),
      text,
      roots: new Set([ROOT]),
      threads: new Set(THREADS.keys()),
      workflow: null,
    })

  test("only a text card with text starts a thread", () => {
    expect(spin(T2, "x")).toMatchObject({ kind: "refused", code: "no-place" })
    expect(spin(cardIdOfKind("text", uuid(103)), "  ")).toEqual({
      kind: "declined",
      why: "blank",
    })
  })
})

describe("undoing a step", () => {
  const SPUN_CARD = cardIdOfKind("text", uuid(110))
  const SPUN = threadIdFor(uuid(111))
  const SPUN_ROOT = rootIdFor(uuid(112))
  const threads = new Map([
    ...THREADS,
    [
      SPUN,
      { ...record(SPUN, SPUN_ROOT), origin: { kind: "spun", card: SPUN_CARD } },
    ],
  ]) as ReadonlyMap<typeof T1, ThreadRecord>
  const parts = [{ docId: "places", footprint: [["cards", SPUN_CARD]] }]
  const reach = (direction: "undo" | "redo") =>
    planUndoReach({
      parts,
      placesId: "places",
      direction,
      cards: CARDS,
      histories: new Map(),
      workflow: null,
      threads,
      roots: new Set([ROOT, SPUN_ROOT]),
    })

  test("an undo reads the threads spun from the cards it moves; a redo none", () => {
    expect(reach("undo")).toMatchObject({
      kind: "reach",
      cards: [SPUN_CARD],
      spun: [{ thread: SPUN, root: SPUN_ROOT, known: true }],
    })
    expect(reach("redo")).toMatchObject({ kind: "reach", spun: [] })
  })

  test("an undo that would lift a thread someone replied in is refused, naming who wrote second", () => {
    const step = reach("undo")
    if (step.kind !== "reach") throw new Error("reached")
    const tree = indexTree(
      fromParents({ r: null, s: "r" }, id =>
        personMessage(id, { author: id === "r" ? "ada" : "bea" }),
      ),
    )
    expect(
      planUndo({
        reach: step,
        trees: new Map([[SPUN_ROOT, tree]]),
        cards: CARDS,
        lanes: [],
        rootOfThread: new Map(),
        histories: new Map(),
      }),
    ).toEqual({ kind: "replied", by: writerId("bea@x.io") })
  })

  test("a redo reverts its cards and lifts nothing; its answer is planned from that revert", () => {
    const step = reach("redo")
    if (step.kind !== "reach") throw new Error("reached")
    const revert = planUndo({
      reach: step,
      trees: new Map(),
      cards: CARDS,
      lanes: [],
      rootOfThread: new Map(),
      histories: new Map(),
    })
    expect(revert).toMatchObject({
      kind: "revert",
      cards: [SPUN_CARD],
      lift: [],
    })
    if (revert.kind !== "revert") throw new Error("reverted")
    expect(planUndoAnswer(revert, { kind: "none" }, CARDS)).toEqual({
      kind: "nothing",
    })
  })
})
