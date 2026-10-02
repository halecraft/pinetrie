import { laneNameForThread, NOBODY, type Sha256, writerId } from "@pineta/core"
import { encodeChat } from "@pineta/marginalia"
import { expect, test } from "vitest"
import { planSweep, referencedBlobs } from "./index.ts"

const sha = (c: string) => c.repeat(64) as Sha256
const image = (s: Sha256) =>
  ({ sha256: s, mimeType: "image/png", width: 1, height: 1 }) as const
const details = (shas: readonly Sha256[]) => ({
  author: writerId("ada"),
  authorName: "Ada",
  text: "look",
  compels: NOBODY,
  sendId: "s",
  images: shas.map(image),
})

test("referencedBlobs: chats, tool results, typed texts and banners each keep theirs", () => {
  const referenced = referencedBlobs({
    messages: [
      encodeChat(details([sha("a")]), 1),
      { role: "user", content: `![](/blob/${sha("f")})` },
      encodeChat(details([]), 2),
      {
        role: "toolResult",
        toolCallId: "c1",
        content: [
          { type: "text", text: "Read image file [image/png]" },
          { type: "image", ...image(sha("e")) },
        ],
      },
    ],
    texts: [
      `a card ![](/blob/${sha("c")})`,
      `a queued card ![](/blob/${sha("b")})`,
      "`![](/blob/dd)` no",
    ],
    banners: [{ lane: laneNameForThread("1"), sha: sha("g"), at: 1 }],
  })
  expect([...referenced].sort()).toEqual([
    sha("a"),
    sha("b"),
    sha("c"),
    sha("e"),
    sha("g"),
  ])
})

test("planSweep: only the unreferenced and untouched past the grace go", () => {
  const stored = [
    { sha256: sha("a"), touched: 0 },
    { sha256: sha("b"), touched: 0 },
    { sha256: sha("c"), touched: 95 },
  ]
  expect(
    planSweep({ stored, referenced: new Set([sha("b")]), now: 100, grace: 10 }),
  ).toEqual([sha("a")])
  expect(
    planSweep({ stored, referenced: new Set(), now: 100, grace: 1_000 }),
  ).toEqual([])
})
