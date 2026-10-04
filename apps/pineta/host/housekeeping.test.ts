import type { Exchange } from "@kyneta/exchange"
import { cardId, rootDocId, rootIdFor, type Sha256 } from "@pineta/core"
import {
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { readRootRecord } from "@pineta/reads"
import { ROOT, setRecord } from "@pineta/rules"
import { newRootDoc } from "@pineta/schema"
import { expect, test } from "vitest"
import { memoryBlobs } from "./blobs.ts"
import { basics, putValue } from "./fakes.ts"
import { compactAfter, planCompaction, sweepBlobs } from "./housekeeping.ts"

// A 1×1 PNG: what the store keeps is only its bytes, type and size.
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
        id: cardId("c-1"),
        text: `pasted ![y](/blob/${inCard.sha256})`,
        clients: [],
      },
    ],
  })
  const kept: Sha256[] = blobs.list().map(x => x.sha256)
  expect(kept).toEqual([inCard.sha256])
  expect(kept).not.toContain(orphan.sha256)
})

test("planCompaction: the roots that ran, and the session, the places and what is streaming; no other root", () => {
  const [a, b] = [rootIdFor("a"), rootIdFor("b")]
  expect(planCompaction(new Set([b, a]))).toEqual([
    rootDocId(a),
    rootDocId(b),
    SESSION_DOC_ID,
    PLACES_DOC_ID,
    LIVE_DOC_ID,
  ])
  expect(planCompaction(new Set())).toEqual([
    SESSION_DOC_ID,
    PLACES_DOC_ID,
    LIVE_DOC_ID,
  ])
})

test("compactAfter compacts each document planCompaction names", async () => {
  const compacted: string[] = []
  const exchange = {
    compact: async (id: string) => {
      compacted.push(id)
    },
  } as unknown as Exchange
  const ran = new Set([rootIdFor("a")])
  await compactAfter(exchange, ran)
  expect(compacted).toEqual([...planCompaction(ran)])
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
      images: [shown.sha256],
    }),
  )
  await sweepBlobs({ basics: b, blobs, grace: 0, texts: async () => [] })
  expect(blobs.list().map(x => x.sha256)).toEqual([shown.sha256])
})
