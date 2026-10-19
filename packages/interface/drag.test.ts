import {
  canvasIdFor,
  type Sha256,
  threadIdFor,
  workflowStateIdFor,
} from "@pinetrie/core"
import { cardIdOfKind } from "@pinetrie/threads"
import { expect, test } from "vitest"
import {
  type CanvasOver,
  type CanvasSource,
  type CardOver,
  type CardSource,
  type DragAt,
  type DragFrom,
  dropIntents,
  type ImageSource,
  planDrop,
} from "./drag.ts"
import type { IntentState } from "./effects.ts"
import type { PutTarget } from "./put-target.ts"

const T = threadIdFor("t")
const K = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c")
const NEXT = canvasIdFor("01a0ffd2-0000-7000-8000-00000000000d")
const ARCHIVE = workflowStateIdFor("x")
const DOING = workflowStateIdFor("d")
const card: CardSource = { kind: "card", card: T }
const canvas: CanvasSource = {
  kind: "canvas",
  drag: { canvas: K, state: DOING },
}
const cardAt = (over: CardOver): DragAt => ({ ...card, over })
const overCanvas = (over: CanvasOver): DragAt => ({ ...canvas, over })
const from: DragFrom = { column: 1, home: null, archive: ARCHIVE }
/** A planned drop never reads the state for these: a canvas's, or one over the strip. */
const NO_STATE = {} as IntentState

test("a column over the strip reorders, over its own gap moves nothing; a canvas lands by its own drop", () => {
  expect(
    planDrop(cardAt({ kind: "strip", gap: 3 }), from, "move", NO_STATE),
  ).toEqual({ kind: "reorder", to: 2 })
  expect(
    planDrop(cardAt({ kind: "strip", gap: 1 }), from, "move", NO_STATE),
  ).toEqual({ kind: "reorder", to: null })
  expect(
    planDrop(
      overCanvas({ kind: "root", target: { kind: "list", before: NEXT } }),
      from,
      "move",
      NO_STATE,
    ),
  ).toEqual({
    kind: "root",
    intent: { kind: "move-in-list", canvas: K, before: NEXT },
  })
})

test("a drop sends what a key or a menu would: move-column, put or the canvas's drop, nothing else", () => {
  expect(dropIntents(card, { kind: "reorder", to: 2 }, "move")).toEqual([
    { kind: "move-column", column: { kind: "card", card: T }, to: 2 },
  ])
  const target = { kind: "item", canvas: K } as const
  expect(
    dropIntents(
      card,
      {
        kind: "land",
        target,
        landing: { kind: "move", card: T, to: target },
      },
      "copy",
    ),
  ).toEqual([
    { kind: "put", source: { kind: "card", card: T }, target, how: "copy" },
  ])
  expect(
    dropIntents(
      card,
      {
        kind: "land",
        target,
        landing: { kind: "refused", code: "no-place", card: T },
      },
      "move",
    ),
  ).toEqual([])
  expect(dropIntents(card, { kind: "reorder", to: null }, "move")).toEqual([])
})

test("a stored image dropped onto an image is a version, elsewhere on a media column or at a spot a new image, anywhere else nothing", () => {
  const sha256 = "a".repeat(64) as Sha256
  const image: ImageSource = { kind: "image", sha256, name: "shot.png" }
  const column = cardIdOfKind("media", "01a0ffd2-0000-7000-8000-0000000000e1")
  const onto = cardIdOfKind("image", "01a0ffd2-0000-7000-8000-0000000000e2")
  const drop = (target: PutTarget) =>
    planDrop(
      { ...image, over: { kind: "put", target } },
      { column: null, home: null, archive: ARCHIVE },
      "move",
      { cards: { cards: [] } } as unknown as IntentState,
    )
  expect(
    drop({ kind: "images", column, on: { image: onto, edge: "onto" } }),
  ).toEqual({
    kind: "image",
    intent: { kind: "add-version", image: onto, sha256 },
  })
  expect(drop({ kind: "images", column, on: null })).toEqual({
    kind: "image",
    intent: {
      kind: "put-images",
      images: [{ sha256, name: "shot.png" }],
      to: { kind: "image-at", column, before: null },
    },
  })
  expect(
    drop({ kind: "images", column, on: { image: onto, edge: "before" } }),
  ).toMatchObject({
    intent: {
      kind: "put-images",
      to: { kind: "image-at", column, before: onto },
    },
  })
  const spot = drop({ kind: "canvas", canvas: K, after: T })
  expect(spot).toMatchObject({
    intent: { to: { kind: "canvas-at", canvas: K, after: T } },
  })
  expect(dropIntents(image, spot, "move")).toHaveLength(1)
  expect(drop({ kind: "column", key: T })).toEqual({ kind: "nothing" })
})
