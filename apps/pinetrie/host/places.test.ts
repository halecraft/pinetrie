import {
  canvasIdFor,
  entryId,
  rootIdFor,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import {
  readCardHistories,
  readPlaces,
  readPlacesRev,
  readTraces,
} from "@pinetrie/reads"
import type { Cause } from "@pinetrie/rules"
import { readingKey, seatKey } from "@pinetrie/schema"
import {
  newPresenceDoc,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import {
  type CardRecord,
  makeCard,
  type TextCard,
  type TextPlace,
  textCardId,
  UNTICKED,
} from "@pinetrie/threads"
import { cardIdFor } from "@pinetrie/threads/fixtures"
import { describe, expect, test } from "vitest"
import {
  basics,
  CANVAS_ID,
  deferred,
  placesFor,
  putCanvas,
  seedPlaces,
  threadRow,
  writeDirectory,
} from "./fakes.ts"
import { type PersonCause, planClose } from "./places.ts"

const LANE = threadIdFor("0123456789abcdef")
const ADA = writerId("ada@x.io")
const BEA = writerId("bea@x.io")
const MOVE: PersonCause = { kind: "move", by: ADA }
const HOST = { kind: "host" } as const

const card = (
  id: string,
  place: TextPlace = { kind: "composing", thread: LANE },
  placer = ADA,
): TextCard => ({
  kind: "text",
  id: textCardId(id),
  owner: placer,
  placer,
  place,
  content: { command: null, unsent: null, origin: null },
})
const C1 = card(cardIdFor("c1"))
const C2 = card(cardIdFor("c2"))

/** `planClose` over the touched cards `before`, the places now `cards`, and the steps `apply` wrote. */
const close = (input: {
  readonly before: readonly CardRecord[]
  readonly made?: readonly CardRecord[]
  readonly cards: readonly CardRecord[]
  readonly applied: Parameters<typeof planClose>[0]["applied"]
  readonly cause?: Cause
}) =>
  planClose({
    touched: new Map([
      ...input.before.map(c => [c.id, c] as const),
      ...(input.made ?? []).map(c => [c.id, undefined] as const),
    ]),
    ends: new Map(),
    applied: input.applied,
    cards: input.cards,
    cause: input.cause ?? MOVE,
    histories: new Map(),
    traces: [],
    reading: [],
    now: 1,
    newId: () => "t-1",
  })

describe("planClose", () => {
  test("a text card removed in a change has its text destroyed", () => {
    expect(
      close({
        before: [C1],
        cards: [],
        applied: [{ kind: "remove", id: C1.id }],
      }).texts,
    ).toEqual([C1.id])
  })

  test("a card written back after its removal keeps its text", () => {
    expect(
      close({
        before: [C1],
        cards: [C1],
        applied: [
          { kind: "remove", id: C1.id },
          { kind: "write", record: C1 },
        ],
      }).texts,
    ).toEqual([])
  })

  test("a change's history covers only the cards it touched", () => {
    const moved = { ...C1, place: { kind: "inventory", holder: ADA } } as const
    const plan = close({
      before: [C1],
      // C2 was made by another change meanwhile: not this one's.
      cards: [moved, C2],
      applied: [{ kind: "write", record: moved }],
    })
    expect(
      plan.provenance.histories.map(h => h.kind === "set" && h.record.card),
    ).toEqual([C1.id])
    expect(plan.change.after).toEqual([moved])
    expect(plan.change.places).toEqual([moved, C2])
  })

  test("a host's change takes no thread's run", () => {
    const thread = makeCard(
      "thread",
      LANE,
      {
        kind: "canvas",
        canvas: canvasIdFor("01a0ffd2-0000-7000-8000-0000000000aa"),
        order: "a",
        width: 1,
      },
      UNTICKED,
      ADA,
    )
    const taken = makeCard(
      "thread",
      LANE,
      { kind: "inventory", holder: ADA },
      UNTICKED,
      ADA,
    )
    const step = [{ kind: "write", record: taken }] as const
    expect(
      close({ before: [thread], cards: [taken], applied: step }).taken,
    ).toEqual({ threads: [LANE], by: ADA })
    expect(
      close({ before: [thread], cards: [taken], applied: step, cause: HOST })
        .taken,
    ).toBeNull()
  })
})

describe("the writer", () => {
  test("apply: one rev per batch of writes and removals", async () => {
    const b = basics()
    const { placesWriter } = placesFor(b)
    await placesWriter.change(HOST, open => {
      expect(
        open.apply([
          { kind: "write", record: C1 },
          { kind: "write", record: C2 },
        ]),
      ).toBe(1)
      expect(readPlaces(b.places)).toEqual([C1, C2])
      expect(open.apply([{ kind: "remove", id: C1.id }])).toBe(2)
      // No steps: nothing written, `rev` as it was.
      expect(open.apply([])).toBe(2)
    })
    expect([readPlaces(b.places), readPlacesRev(b.places)]).toEqual([[C2], 2])
  })

  test("apply: inside a gesture, rev is raised outside it", async () => {
    const b = basics()
    const { placesWriter } = placesFor(b)
    const inside: number[] = []
    const gesture = <T>(write: () => T): T => {
      const out = write()
      inside.push(readPlacesRev(b.places))
      return out
    }
    const rev = await placesWriter.change(HOST, open =>
      open.apply([{ kind: "write", record: C1 }], gesture),
    )
    expect(rev).toBe(1)
    // The gesture saw its record written and `rev` not yet raised.
    expect(inside).toEqual([0])
    expect(readPlaces(b.places)).toHaveLength(1)
  })

  test("a removed card's text goes after its record", async () => {
    const b = basics()
    seedPlaces(b.places, [{ kind: "write", record: C1 }])
    const seen: (readonly string[])[] = []
    const { placesWriter } = placesFor(b, {
      texts: {
        destroy: async () => {
          seen.push(readPlaces(b.places).map(c => c.id))
        },
      },
    })
    await placesWriter.change(
      MOVE,
      open => open.apply([{ kind: "remove", id: C1.id }]),
      b.roots,
    )
    expect(seen).toEqual([[]])
  })

  test("a write by another change during an await is not in this one's history", async () => {
    const b = basics()
    const { placesWriter } = placesFor(b)
    const waiting = deferred<void>()
    const first = placesWriter.change(
      MOVE,
      async open => {
        open.apply([{ kind: "write", record: C1 }])
        await waiting.promise
      },
      b.roots,
    )
    // Another change, the host's, while the first waits.
    await placesWriter.change(HOST, open =>
      open.apply([{ kind: "write", record: C2 }]),
    )
    waiting.resolve()
    await first
    const histories = readCardHistories(b.session)
    expect(histories.get(C1.id)?.events.map(e => e.by)).toEqual([ADA])
    expect(histories.get(C2.id)?.events.map(e => e.by)).toEqual([null])
  })

  test("an undo that reverts nothing raises no rev", async () => {
    const b = basics()
    seedPlaces(b.places, [{ kind: "write", record: C1 }])
    const { placesWriter } = placesFor(b)
    const before = readPlacesRev(b.places)
    const nothing = await placesWriter.change(
      { kind: "undo", by: ADA },
      open => open.revert([C1.id], async () => "nothing"),
      b.roots,
    )
    expect(nothing).toEqual({ result: "nothing", rev: before })
    const undone = await placesWriter.change(
      { kind: "undo", by: ADA },
      open =>
        open.revert([C1.id], async () => {
          seedPlaces(b.places, [{ kind: "remove", id: C1.id }])
          return "undone"
        }),
      b.roots,
    )
    // The seed raised one, the revert's own one more.
    expect(undone).toEqual({ result: "undone", rev: before + 2 })
  })

  test("an undo keeps the texts of the cards it removes", async () => {
    const b = basics()
    seedPlaces(b.places, [{ kind: "write", record: C1 }])
    const destroyed: string[] = []
    const { placesWriter } = placesFor(b, {
      texts: { destroy: async id => void destroyed.push(id) },
    })
    await placesWriter.change(
      { kind: "undo", by: ADA },
      open =>
        open.revert([C1.id], async () => {
          seedPlaces(b.places, [{ kind: "remove", id: C1.id }])
        }),
      b.roots,
    )
    expect(readPlaces(b.places)).toEqual([])
    expect(destroyed).toEqual([])
  })

  test("a close that fails after a failed body rethrows the body's error", async () => {
    const b = basics()
    const { placesWriter } = placesFor(b, {
      records: {
        writeValues: async () => {
          throw new Error("the close")
        },
      },
    })
    await expect(
      placesWriter.change(
        MOVE,
        open => {
          open.apply([{ kind: "write", record: C1 }])
          throw new Error("the body")
        },
        b.roots,
      ),
    ).rejects.toThrow("the body")
    expect(b.lines).toEqual([
      "[host] a change to the places did not close: the close",
    ])
  })

  test("a moved card's watched thread end leaves no trace; one in a canvas no one reads does", async () => {
    const b = basics()
    const E1 = entryId("e-1")
    writeEntry(b.root, threadRow(E1, null, LANE))
    writeLaneTip(b.root, LANE, E1)
    // A thread's root is its record's: LANE's canvas is read, AWAY's is not.
    const AWAY = threadIdFor("fedcba9876543210")
    putCanvas(b, LANE)
    putCanvas(
      b,
      AWAY,
      canvasIdFor("01a0ffd2-0000-7000-8000-0000000000bc"),
      rootIdFor("01a0ffd2-0000-7000-8000-0000000000bb"),
    )
    const here = card(cardIdFor("here"), {
      kind: "pinned",
      thread: LANE,
      order: "a",
    })
    const away = card(cardIdFor("away"), {
      kind: "pinned",
      thread: AWAY,
      order: "a",
    })
    seedPlaces(b.places, [
      { kind: "write", record: here },
      { kind: "write", record: away },
    ])
    // Ada reads the thread end both cards are pinned at, as far as the host
    // can tell: LANE's end, E1.
    writeDirectory(b)
    const presence = newPresenceDoc()
    presence.reading.set(readingKey(seatKey(ADA, "s1"), "c1"), E1)
    presence.readingCanvas.set(readingKey(seatKey(ADA, "s1"), "c1"), CANVAS_ID)
    const { placesWriter } = placesFor(b, { presence })
    const inBea = (c: TextCard): TextCard => ({
      ...c,
      place: { kind: "inventory", holder: BEA } as const,
      placer: BEA,
    })
    await placesWriter.change(
      { kind: "move", by: BEA },
      open =>
        open.apply([
          { kind: "write", record: inBea(here) },
          { kind: "write", record: inBea(away) },
        ]),
      b.roots,
    )
    expect([...readTraces(b.session).values()].map(t => t.card)).toEqual([
      away.id,
    ])
  })
})
