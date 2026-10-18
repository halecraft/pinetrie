import {
  canvasIdFor,
  cardIdOfKind,
  livePlace,
  makeCard,
  movesDocId,
  rootIdFor,
  type Sha256,
  storedText,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import { readRootRecord } from "@pinetrie/reads"
import { ROOT, setRecord } from "@pinetrie/rules"
import { landedThreadCard } from "@pinetrie/rules/fixtures"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { memoryBlobs } from "./blobs.ts"
import { basics, CANVAS_ID, placesFor, putValue, seedPlaces } from "./fakes.ts"
import {
  type SweepDeps,
  sweepBlobs,
  sweepTrash,
  sweepUnused,
} from "./housekeeping.ts"

// A 1×1 PNG: what the store keeps is only its bytes, type and size.
const ADA = writerId("ada@x.io")
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

test("an image only a card's text shows is kept past its grace", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const put = (bytes: Uint8Array) =>
    blobs.put({ bytes, mimeType: "image/png", width: 1, height: 1 })
  const inCard = put(PNG)
  const orphan = put(new Uint8Array([9, 9]))
  await sweepBlobs({
    basics: b,
    blobs,
    grace: 0,
    texts: async () => [
      {
        id: cardIdFor("c1"),
        text: `pasted ![y](/blob/${inCard.sha256})`,
        clients: [],
      },
    ],
  })
  const kept: Sha256[] = blobs.list().map(x => x.sha256)
  expect(kept).toEqual([inCard.sha256])
  expect(kept).not.toContain(orphan.sha256)
})

test("a draft's file link keeps its file, and an image's original keeps its fitted copy", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const file = blobs.put(storedText("notes"))
  const original = blobs.put(
    { bytes: PNG, mimeType: "image/png", width: 4000, height: 10 },
    {
      bytes: new Uint8Array([7]),
      mimeType: "image/png",
      width: 2000,
      height: 5,
    },
  )
  const fitted = blobs.fitted(original.sha256)?.sha256
  await sweepBlobs({
    basics: b,
    blobs,
    grace: 0,
    texts: async () => [
      {
        id: cardIdFor("c1"),
        text: `[notes.txt](/blob/${file.sha256}) ![big](/blob/${original.sha256})`,
        clients: [],
      },
    ],
  })
  const kept = blobs.list().map(x => x.sha256)
  expect(kept).toContain(file.sha256)
  expect(kept).toContain(original.sha256)
  expect(fitted).toBeDefined()
  expect(kept).toContain(fitted)
})

test("the image sweep keeps what a root's directory record shows, though no root is loaded", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const shown = blobs.put({
    bytes: PNG,
    mimeType: "image/png",
    width: 1,
    height: 1,
  })
  putValue(
    b,
    setRecord(ROOT, {
      ...readRootRecord(rootIdFor("elsewhere"), newRootDoc()),
      blobs: [shown.sha256],
    }),
  )
  await sweepBlobs({ basics: b, blobs, grace: 0, texts: async () => [] })
  expect(blobs.list().map(x => x.sha256)).toEqual([shown.sha256])
})

test("the blob sweep keeps a reference's quote, and deletes one no card holds", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const kept = blobs.put(storedText("| a |"))
  const dropped = blobs.put(storedText("nobody quotes this"))
  const card = cardIdOfKind("reference", "01a0ffd2-0000-7000-8000-0000000000e1")
  seedPlaces(b.places, [
    {
      kind: "write",
      record: makeCard(
        "reference",
        card,
        { kind: "inventory", holder: ADA },
        {
          address: { kind: "thread", thread: threadIdFor("a") },
          quote: kept.sha256,
        },
        ADA,
      ),
    },
  ])
  await sweepBlobs({ basics: b, blobs, grace: 0, texts: async () => [] })
  const left = blobs.list().map(x => x.sha256)
  expect(left).toContain(kept.sha256)
  expect(left).not.toContain(dropped.sha256)
})

test("the blob sweep keeps every version of an image, in a trash too", async () => {
  const b = basics()
  const blobs = memoryBlobs(() => 0)
  const [v1, v2] = [blobs.put(storedText("v1")), blobs.put(storedText("v2"))]
  const dropped = blobs.put(storedText("no image holds this"))
  const column = cardIdOfKind("media", "01a0ffd2-0000-7000-8000-0000000000e2")
  seedPlaces(b.places, [
    {
      kind: "write",
      record: makeCard(
        "image",
        cardIdOfKind("image", "01a0ffd2-0000-7000-8000-0000000000e3"),
        { kind: "trash", left: { kind: "image", column, order: "m" } },
        {
          versions: [
            {
              sha256: v1.sha256,
              original: v1.sha256,
              mimeType: "image/png",
              width: 4,
              height: 3,
              by: ADA,
              at: 1,
            },
            {
              sha256: v2.sha256,
              original: v2.sha256,
              mimeType: "image/png",
              width: 4,
              height: 3,
              by: ADA,
              at: 2,
            },
          ],
        },
        ADA,
      ),
    },
  ])
  await sweepBlobs({ basics: b, blobs, grace: 0, texts: async () => [] })
  const left = blobs.list().map(x => x.sha256)
  expect(left).toEqual(expect.arrayContaining([v1.sha256, v2.sha256]))
  expect(left).not.toContain(dropped.sha256)
})

test("a thread deleted from the trash leaves the shared files' lineages it read", async () => {
  const b = basics()
  const thread = threadIdFor("0123456789abcdef")
  const card = landedThreadCard({
    thread,
    canvas: CANVAS_ID,
    by: ADA,
    cards: [],
  })
  // In the trash with no history to tell: its deadline is now.
  seedPlaces(b.places, [
    {
      kind: "write",
      record: {
        ...card,
        place: { kind: "trash", left: livePlace(card.place) },
      },
    },
  ])
  const { placesWriter } = placesFor(b)
  const forgotten: ReadonlySet<ThreadId>[] = []
  await sweepTrash({
    basics: b,
    placesWriter,
    work: {
      destination: null,
      teardown: async () => {},
      forgetReaders: async lanes => {
        forgotten.push(lanes)
      },
    },
  })
  expect(forgotten).toEqual([new Set([thread])])
})

/** A history of moves on a canvas no place holds: only a starting host retires it. */
const GONE_HISTORY = movesDocId(ADA, {
  kind: "canvas",
  canvas: canvasIdFor("01a0ffd2-0000-7000-8000-0000000000c9"),
})

/**
 * The sweeps' dependencies over `b`, recording each sweep reached and the
 * histories retired: the image store's list throws, so an image sweep
 * fails, and the store holds `GONE_HISTORY`.
 */
function sweepsOver(b: ReturnType<typeof basics>) {
  const reached: string[] = []
  const retired: string[] = []
  const deps: SweepDeps = {
    basics: b,
    blobs: {
      ...memoryBlobs(),
      list: () => {
        throw new Error("no list")
      },
    },
    grace: 0,
    texts: async () => [],
    store: {
      async *listDocIds() {
        reached.push("histories")
        yield GONE_HISTORY
      },
    },
    histories: {
      retire: async ids => {
        retired.push(...ids)
      },
    },
    records: { writeValues: async () => {} },
    placesWriter: placesFor(b).placesWriter,
    work: {
      destination: null,
      teardown: async () => {},
      forgetReaders: async () => {},
    },
    provenance: {
      sweep: async () => {
        reached.push("traces")
      },
    },
  }
  return { deps, reached, retired }
}

test("a failed image sweep is logged, and the sweeps after it run", async () => {
  const b = basics()
  const { deps, reached } = sweepsOver(b)
  await sweepUnused(deps, "upkeep")
  expect(b.lines[0]).toBe("[host] deleting unreferenced images failed: no list")
  expect(reached).toEqual(["histories", "traces"])
})

test("a starting host's sweeps leave the images to its first upkeep", async () => {
  const b = basics()
  const { deps, reached } = sweepsOver(b)
  await sweepUnused(deps, "start")
  expect(b.lines.filter(l => l.includes("images"))).toEqual([])
  expect(reached).toEqual(["histories", "traces"])
})

test("only a starting host retires the history of a canvas no place holds", async () => {
  const atStart = sweepsOver(basics())
  await sweepUnused(atStart.deps, "start")
  expect(atStart.retired).toEqual([GONE_HISTORY])
  const atUpkeep = sweepsOver(basics())
  await sweepUnused(atUpkeep.deps, "upkeep")
  expect(atUpkeep.retired).toEqual([])
})
