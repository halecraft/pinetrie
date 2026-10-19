import {
  type CardRecord,
  canvasIdFor,
  cardIdOfKind,
  type ImageVersion,
  imageMargin,
  makeCard,
  NO_CONTENT,
  type Sha256,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { canvasCard } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import { mintContainer } from "./containers.ts"
import { imagesIn } from "./media.ts"
import { planMoveTargets } from "./moves.ts"
import { afterSteps } from "./place-steps.ts"
import {
  type PutImageAsk,
  planImageAsk,
  planPutImages,
  planVersion,
} from "./put-images.ts"

const ADA = writerId("ada@x.io")
const CANVAS = canvasIdFor("01a0ffd2-0000-7000-8000-0000000000a1")
const uuid = (n: number) =>
  `01a0ffd2-0000-7000-8000-${String(n).padStart(12, "0")}`
const COLUMN = cardIdOfKind("media", uuid(1))
const sha = (c: string) => c.repeat(64) as Sha256
const ref = (c: string) =>
  ({
    sha256: sha(c),
    original: sha(c),
    mimeType: "image/png",
    width: 4,
    height: 3,
  }) as const
const image = (n: number) => cardIdOfKind("image", uuid(100 + n))
let minted = 0
const newContainer = mintContainer(() => uuid(900 + ++minted))

const column = (
  place: CardRecord["place"] = {
    kind: "canvas",
    canvas: CANVAS,
    order: "m",
    width: 1,
  },
): CardRecord =>
  makeCard(
    "media",
    COLUMN,
    place.kind === "canvas" || place.kind === "trash"
      ? place
      : { kind: "canvas", canvas: CANVAS, order: "m", width: 1 },
    NO_CONTENT,
    ADA,
  )

const base = [canvasCard(CANVAS), column()]

describe("putting images", () => {
  test("a spot on a canvas makes a media column there, the images in it in order, one version each", () => {
    const step = planPutImages({
      cards: [canvasCard(CANVAS)],
      images: [
        { card: image(1), image: ref("a") },
        { card: image(2), image: ref("b") },
      ],
      to: { kind: "canvas-at", canvas: CANVAS, after: null },
      sender: ADA,
      now: 7,
      newContainer,
    })
    if (step.kind !== "steps") throw new Error(step.code)
    const after = afterSteps([canvasCard(CANVAS)], step.steps)
    const made = after.find(c => c.kind === "media")
    expect(made?.place).toMatchObject({ kind: "canvas", canvas: CANVAS })
    const images =
      made === undefined ? [] : imagesIn(after, made.id as typeof COLUMN)
    expect(images.map(i => i.id)).toEqual([image(1), image(2)])
    expect(images[0]?.content.versions).toEqual([
      { ...ref("a"), by: ADA, at: 7 },
    ])
  })

  test("a media column's end takes them after its images", () => {
    const step = planPutImages({
      cards: base,
      images: [{ card: image(1), image: ref("a") }],
      to: { kind: "image", column: COLUMN },
      sender: ADA,
      now: 1,
      newContainer,
    })
    if (step.kind !== "steps") throw new Error(step.code)
    const next = planPutImages({
      cards: afterSteps(base, step.steps),
      images: [{ card: image(2), image: ref("b") }],
      to: { kind: "image", column: COLUMN },
      sender: ADA,
      now: 2,
      newContainer,
    })
    if (next.kind !== "steps") throw new Error(next.code)
    const after = afterSteps(afterSteps(base, step.steps), next.steps)
    expect(imagesIn(after, COLUMN).map(i => i.id)).toEqual([image(1), image(2)])
  })

  test("a trashed media column, or none, takes none", () => {
    const trashed = column({
      kind: "trash",
      left: { kind: "canvas", canvas: CANVAS, order: "m", width: 1 },
    })
    for (const cards of [[canvasCard(CANVAS), trashed], [canvasCard(CANVAS)]])
      expect(
        planPutImages({
          cards,
          images: [{ card: image(1), image: ref("a") }],
          to: { kind: "image", column: COLUMN },
          sender: ADA,
          now: 1,
          newContainer,
        }),
      ).toMatchObject({ kind: "refused", code: "no-place" })
  })
})

describe("an image's versions", () => {
  const first: ImageVersion = { ...ref("a"), by: ADA, at: 1 }
  const inColumn = { kind: "image", column: COLUMN, order: "m" } as const
  const held = makeCard("image", image(1), inColumn, { versions: [first] }, ADA)
  const trashed = makeCard(
    "image",
    image(1),
    { kind: "trash", left: inColumn },
    { versions: [first] },
    ADA,
  )

  test("a version is added after the others, by its adder, at now", () => {
    expect(
      planVersion({
        cards: [...base, held],
        image: image(1),
        version: ref("b"),
        sender: ADA,
        now: 9,
      }),
    ).toEqual({
      kind: "write",
      record: {
        ...held,
        content: { versions: [first, { ...ref("b"), by: ADA, at: 9 }] },
      },
    })
  })

  test("an older version brought back is added again, as the newest", () => {
    const step = planVersion({
      cards: [...base, held],
      image: image(1),
      version: ref("a"),
      sender: ADA,
      now: 9,
    })
    expect(
      step.kind === "write" && step.record.kind === "image"
        ? step.record.content.versions.map(v => v.sha256)
        : [],
    ).toEqual([sha("a"), sha("a")])
  })

  test("a trashed image takes no version", () => {
    expect(
      planVersion({
        cards: [trashed],
        image: image(1),
        version: ref("b"),
        sender: ADA,
        now: 9,
      }),
    ).toMatchObject({ kind: "refused", code: "gone" })
  })

  test("a comment goes in the margin of an image in a column, never of one in a trash", () => {
    const comment = cardIdOfKind("text", uuid(500))
    const to = {
      kind: "margin",
      on: imageMargin(image(1)),
      seen: sha("a"),
    } as const
    const into = (cards: readonly CardRecord[]) =>
      planMoveTargets({
        cards,
        moves: [{ card: comment, from: null, to }],
        sender: ADA,
        newContainer,
        entryThreads: new Map(),
      }).kind
    expect(into([...base, held])).toBe("resolved")
    expect(into([...base, trashed])).toBe("refused")
  })
})

describe("an agent's put_image ask", () => {
  const thread = threadIdFor("ask")
  const onCanvas = makeCard(
    "thread",
    thread,
    { kind: "canvas", canvas: CANVAS, order: "a", width: 1 },
    NO_CONTENT,
    ADA,
  )
  const held = makeCard(
    "image",
    image(9),
    { kind: "image", column: COLUMN, order: "m" },
    { versions: [{ ...ref("a"), by: ADA, at: 1 }] },
    ADA,
  )
  const cards = [canvasCard(CANVAS), onCanvas, column(), held]
  const titles = new Map([
    [COLUMN, { card: COLUMN, title: "Mockups", by: ADA, at: 1 }],
  ])
  const ask = (over: Partial<PutImageAsk> = {}): PutImageAsk => ({
    sha256: sha("b"),
    name: "shot.png",
    title: null,
    column: null,
    onto: null,
    ...over,
  })
  const plan = (a: PutImageAsk, at = cards) =>
    planImageAsk({ ask: a, thread, cards: at, titles, card: image(1) })

  test("a column named by its title, case aside, takes the image at its end, titled by its file", () => {
    expect(plan(ask({ column: " mockups " }))).toEqual({
      kind: "put",
      intent: {
        kind: "put-images",
        images: [{ card: image(1), sha256: sha("b"), name: "shot.png" }],
        to: { kind: "image", column: COLUMN },
        made: null,
      },
      columnTitle: null,
    })
  })

  test("a column no media column has is made at the canvas's end, titled so", () => {
    expect(plan(ask({ column: "Logos", title: "logo v1" }))).toMatchObject({
      kind: "put",
      intent: {
        images: [{ name: "logo v1" }],
        to: { kind: "canvas-at", canvas: CANVAS, after: COLUMN },
      },
      columnTitle: "Logos",
    })
  })

  test("an image named by its id takes a version", () => {
    expect(plan(ask({ onto: image(9) }))).toEqual({
      kind: "version",
      intent: { kind: "version", image: image(9), sha256: sha("b") },
    })
  })

  test("a thread on no canvas, or an image not on its canvas, is refused", () => {
    const away = {
      ...onCanvas,
      place: { kind: "inventory", holder: ADA },
    } as const
    expect(plan(ask(), [canvasCard(CANVAS), away]).kind).toBe("refused")
    expect(plan(ask({ onto: image(5) })).kind).toBe("refused")
  })
})
