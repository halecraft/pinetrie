import { canvasIdFor, type Sha256, threadIdFor, writerId } from "@pinetrie/core"
import {
  type CardRecord,
  cardIdOfKind,
  makeCard,
  UNTICKED,
} from "@pinetrie/threads"
import { describe, expect, test } from "vitest"
import { planCardRead } from "./card-read.ts"

const ADA = writerId("ada@x.io")
const K = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const ELSEWHERE = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000a2")
const T = threadIdFor("reads")
const M = cardIdOfKind("media", "01a0ffd2-0000-7000-8000-0000000000b1")
const N = cardIdOfKind("note-column", "01a0ffd2-0000-7000-8000-0000000000b2")
const I = cardIdOfKind("image", "01a0ffd2-0000-7000-8000-0000000000b3")
const NOTE = cardIdOfKind("text", "01a0ffd2-0000-7000-8000-0000000000b4")
const sha = (c: string) => c.repeat(64) as Sha256
const on = (canvas = K, order = "a") =>
  ({ kind: "canvas", canvas, order, width: 1 }) as const
const version = (c: string) => ({
  sha256: sha(c),
  original: sha(c),
  mimeType: "image/png" as const,
  width: 4,
  height: 3,
  by: ADA,
  at: 1,
})
const cards: readonly CardRecord[] = [
  makeCard("thread", T, on(K, "a"), UNTICKED, ADA),
  makeCard("media", M, on(K, "b"), UNTICKED, ADA),
  makeCard("note-column", N, on(K, "c"), UNTICKED, ADA),
  makeCard(
    "image",
    I,
    { kind: "image", column: M, order: "a" },
    { versions: [version("a"), version("b")] },
    ADA,
  ),
  makeCard(
    "text",
    NOTE,
    { kind: "note", column: N, order: "a" },
    { command: null, unsent: null, origin: null },
    ADA,
  ),
]
const read = (
  card: string,
  version: number | null = null,
  at: readonly CardRecord[] = cards,
) =>
  planCardRead({
    card,
    version,
    thread: T,
    cards: at,
    titles: new Map([[I, { card: I, title: "home", by: ADA, at: 1 }]]),
    noteTexts: new Map([[NOTE, "ship it"]]),
  })

describe("read_card", () => {
  test("an image is its newest version's copy, or the version asked for", () => {
    expect(read(I)).toEqual({
      kind: "image",
      sha256: sha("b"),
      text: `Image "home" (${I}), version 2 of 2, in media column "Images".`,
    })
    expect(read(I, 1)).toMatchObject({ kind: "image", sha256: sha("a") })
    expect(read(I, 3)).toMatchObject({ kind: "refused" })
  })

  test("a media column lists its images; a note column gives its notes' texts", () => {
    expect(read(M)).toEqual({
      kind: "text",
      text: `Media column "Images" (${M}), 1 image:\n- "home" (${I}, 2 versions)`,
    })
    expect(read(N)).toEqual({
      kind: "text",
      text: `Note column "Notes" (${N}), 1 note:\n\nship it`,
    })
  })

  test("a card on another canvas, a kind it does not read, or a thread on no canvas is refused", () => {
    const moved = cards.map(c =>
      c.id === M ? makeCard("media", M, on(ELSEWHERE), UNTICKED, ADA) : c,
    )
    expect(read(I, null, moved).kind).toBe("refused")
    expect(read(T).kind).toBe("refused")
    expect(read(I, null, cards.slice(1)).text).toBe(
      "This thread is on no canvas.",
    )
  })
})
