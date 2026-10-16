import { entryId, type Sha256, threadIdFor } from "@pinetrie/core"
import { writeEntry } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { basics, putLane, row } from "./fakes.ts"
import { createReadBlob } from "./save-blob.ts"

const LANE = threadIdFor("saver")
const OTHER = threadIdFor("other")
const SHARED = "a".repeat(64) as Sha256
const ELSEWHERE = "b".repeat(64) as Sha256
const BYTES = new Uint8Array([1, 2, 3])

test("save_blob is given a blob the lane's path shared, never one shared beside it", async () => {
  const b = basics()
  writeEntry(
    b.root,
    row(
      "e1",
      null,
      { role: "user", content: `see [x](/blob/${SHARED})` },
      LANE,
    ),
  )
  writeEntry(
    b.root,
    row("e2", "e1", { role: "assistant", content: "ok" }, LANE),
  )
  writeEntry(
    b.root,
    row(
      "o1",
      "e1",
      { role: "user", content: `[y](/blob/${ELSEWHERE})` },
      OTHER,
    ),
  )
  putLane(b, LANE, entryId("e2"))
  const stored = new Map([
    [SHARED, BYTES],
    [ELSEWHERE, BYTES],
  ])
  const readBlob = createReadBlob({
    runs: { docOf: () => b.root },
    blobs: {
      get: sha => {
        const bytes = stored.get(sha)
        return bytes === undefined
          ? undefined
          : { bytes, mimeType: "application/octet-stream" }
      },
    },
  })
  expect(await readBlob(LANE, `/blob/${SHARED}`)).toEqual({
    kind: "blob",
    sha256: SHARED,
    bytes: BYTES,
  })
  expect((await readBlob(LANE, `/blob/${ELSEWHERE}`)).kind).toBe("refused")
  stored.delete(SHARED)
  expect(await readBlob(LANE, SHARED)).toMatchObject({
    kind: "refused",
    text: expect.stringContaining("no longer stored"),
  })
})
