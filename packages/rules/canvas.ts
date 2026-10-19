// canvas — what a run's agent is told of its canvas.

import type {
  AgentWork,
  CanvasId,
  CanvasView,
  CardId,
  CardRecord,
  ImageId,
  ThreadId,
  ThreadName,
  TitledCardId,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { type CardOnCanvas, isCardOnCanvas } from "./canvas-index.ts"
import type { CardTitleRecord } from "./card-title.ts"
import { count, namesAndMore, noteCountWords } from "./counts.ts"
import { CanvasIdSchema, List, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { type ImageInColumn, imagesIn } from "./media.ts"
import { NEW_NOTES_TITLE, notesIn } from "./notes.ts"
import { attribute, neutral } from "./pinned.ts"

export const CANVAS_TYPE = "pinetrie.canvas"

/**
 * The line every agent thread's `<rules>` holds for the canvas list.
 * Constant, so the system prompt stays the same between runs.
 */
export const CANVAS_RULE =
  "The canvas's cards are listed in a `<canvas>` block, in the order everyone sees them, and the latest block is what holds. Only pinned cards' contents are given; `read_card` reads an image, a media column or a note column by the id the list gives."

/** How many cards the list names; the rest are counted. */
export const CANVAS_CAP = 50

const CanvasDetailsSchema = Type.Object({
  canvas: CanvasIdSchema,
  title: Type.String(),
  lines: List(Type.String()),
  more: Type.Number(),
})

/** The column draws its own marker for a canvas entry, not pi's message. */
export const CANVAS = historyMessage(CANVAS_TYPE, CanvasDetailsSchema, false)

/** The pi `CustomMessage` a canvas entry is stored as. */
export type CanvasMessage = HistoryMessage<typeof CANVAS_TYPE, CanvasView>

/** A stored message -> the canvas list it told, or undefined. */
export const decodeCanvas = (message: unknown): CanvasView | undefined =>
  CANVAS.decode(message)

/** What one card of a canvas list is drawn from. */
export interface CanvasFacts {
  readonly canvas: CanvasId
  /** The canvas's title, else its first card's line (`taskLabels`). */
  readonly title: string
  /** Its cards, in order. */
  readonly onCanvas: readonly CardOnCanvas[]
  /** The thread whose run reads the list, marked in it; null for none. */
  readonly reading: ThreadId | null
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  /** What each thread's agent is doing; a thread absent is idle. */
  readonly work: ReadonlyMap<ThreadId, AgentWork>
  /** What the list says of each column on the canvas (`columnGlances`). */
  readonly glances: ReadonlyMap<CardId, ColumnGlance>
  readonly nameOf: (writer: WriterId) => string
}

const STATE_WORDS: Readonly<Record<AgentWork, string>> = {
  running: "running",
  waiting: "waiting",
  held: "held",
}

/** How many images a media column's line names; the rest are counted. */
export const MEDIA_LINE_CAP = 12

/** What the list says of a column: its title, and its notes' count or its images. */
export type ColumnGlance =
  | {
      readonly kind: "note-column"
      readonly title: string
      readonly notes: number
    }
  | {
      readonly kind: "media"
      readonly title: string
      readonly images: readonly ImageGlance[]
    }

/** An image as a media column's line names it: never the image itself. */
export interface ImageGlance {
  readonly id: ImageId
  readonly title: string
  readonly versions: number
}

/** The title an image without a title record reads. */
export const UNTITLED_IMAGE = "untitled image"

/** The title a media column without a title record reads. */
export const NEW_MEDIA_TITLE = "Images"

/** What the canvas list says of each column in `onCanvas`. */
export function columnGlances(input: {
  readonly cards: readonly CardRecord[]
  readonly onCanvas: readonly CardOnCanvas[]
  readonly titles: ReadonlyMap<TitledCardId, CardTitleRecord>
}): ReadonlyMap<CardId, ColumnGlance> {
  const glances = new Map<CardId, ColumnGlance>()
  for (const c of input.onCanvas)
    if (c.kind === "note-column")
      glances.set(c.id, {
        kind: "note-column",
        title: input.titles.get(c.id)?.title ?? NEW_NOTES_TITLE,
        notes: notesIn(input.cards, c.id).length,
      })
    else if (c.kind === "media")
      glances.set(c.id, {
        kind: "media",
        title: input.titles.get(c.id)?.title ?? NEW_MEDIA_TITLE,
        images: imagesIn(input.cards, c.id).map(i => ({
          id: i.id,
          title: input.titles.get(i.id)?.title ?? UNTITLED_IMAGE,
          versions: i.content.versions.length,
        })),
      })
  return glances
}

/** A media column's images as its line names them, the rest counted. */
const imagesLine = (images: readonly ImageGlance[]): string =>
  namesAndMore(
    images.map(
      i =>
        `"${i.title}" (${i.id}, ${count(i.versions, "version", "versions")})`,
    ),
    MEDIA_LINE_CAP,
  )

/**
 * One card's line. A thread is named by its two words, else by "a thread";
 * the reading thread says so, and no state, which is always its own run.
 */
function cardLine(c: CardOnCanvas, f: CanvasFacts): string {
  const by = `put by ${f.nameOf(c.placer)}`
  switch (c.kind) {
    case "thread": {
      const name = f.names.get(c.id) ?? "a thread"
      if (c.id === f.reading) return `thread ${name} (this thread), ${by}`
      const work = f.work.get(c.id)
      return `thread ${name}, ${work === undefined ? "idle" : STATE_WORDS[work]}, ${by}`
    }
    case "note-column": {
      const g = f.glances.get(c.id)
      const title = g?.title ?? NEW_NOTES_TITLE
      const notes = g?.kind === "note-column" ? g.notes : 0
      return `note column "${title}" (${c.id}), ${noteCountWords(notes)}, ${by}`
    }
    case "media": {
      const g = f.glances.get(c.id)
      const title = g?.title ?? NEW_MEDIA_TITLE
      const images = g?.kind === "media" ? g.images : []
      return images.length === 0
        ? `media column "${title}" (${c.id}), no images, ${by}`
        : `media column "${title}" (${c.id}), ${count(images.length, "image", "images")}: ${imagesLine(images)}, ${by}`
    }
    // A new kind of canvas card does not compile until it has its line.
    default:
      return c satisfies never
  }
}

/** The canvas list `facts` make: at most `CANVAS_CAP` lines, the rest counted. */
export function canvasList(facts: CanvasFacts): CanvasView {
  const lines = facts.onCanvas.map(c => cardLine(c, facts))
  return {
    canvas: facts.canvas,
    title: facts.title,
    lines: lines.slice(0, CANVAS_CAP),
    more: Math.max(0, lines.length - CANVAS_CAP),
  }
}

const sameCanvas = (a: CanvasView, b: CanvasView): boolean =>
  a.canvas === b.canvas &&
  a.title === b.title &&
  a.more === b.more &&
  a.lines.length === b.lines.length &&
  a.lines.every((l, i) => b.lines[i] === l)

/**
 * The canvas list a run is told, or null when the newest on its path says
 * the same.
 */
export const planCanvasRead = (input: {
  readonly inView: CanvasView | null
  readonly now: CanvasView
}): CanvasView | null =>
  input.inView !== null && sameCanvas(input.inView, input.now)
    ? null
    : input.now

/** The list's lines as the canvas column and the model read them, its tail counted. */
export const canvasLines = (view: CanvasView): readonly string[] =>
  view.more === 0 ? view.lines : [...view.lines, `and ${view.more} more`]

/** What the model reads of `view`. */
export const canvasContent = (view: CanvasView): string =>
  `<canvas title="${attribute(view.title)}">\n${canvasLines(view)
    .map(neutral)
    .join("\n")}\n</canvas>`

/** The canvas entry for `view`. */
export const encodeCanvas = (
  view: CanvasView,
  timestamp: number,
): CanvasMessage =>
  CANVAS.encode(
    {
      canvas: view.canvas,
      title: view.title,
      lines: [...view.lines],
      more: view.more,
    },
    canvasContent(view),
    timestamp,
  )

// ── a change during a run ─────────────────────────────────────

/**
 * A card added to a canvas or taken from it, as a running thread of
 * the canvas is told; or, told to a running thread itself, its card moved to
 * another canvas: a fact line, steered after the turn in
 * flight as base news is. Reorders, widths and titles wait
 * for the next run's list.
 */
export interface CanvasFact {
  readonly canvas: CanvasId
  readonly by: WriterId
  /**
   * The card's title as the list names it: a thread's name, a column's
   * title, an image's with its column's; for `moved`, the title of the
   * canvas it moved to.
   */
  readonly title: string
  readonly change: "added" | "taken" | "moved" | "versioned"
}

export const CANVAS_FACT_TYPE = "pinetrie.canvas-fact"

const CanvasFactDetailsSchema = Type.Object({
  canvas: CanvasIdSchema,
  by: WriterIdSchema,
  /** Who moved it, by their display name then, as a chat keeps its author's. */
  byName: Type.String(),
  title: Type.String(),
  change: Type.Union([
    Type.Literal("added"),
    Type.Literal("taken"),
    Type.Literal("moved"),
    Type.Literal("versioned"),
  ]),
})

/** The column draws a canvas fact as a fact row (`canvasFactLine`). */
export const CANVAS_FACT = historyMessage(
  CANVAS_FACT_TYPE,
  CanvasFactDetailsSchema,
)

/** A canvas fact as told: with who moved it, by name. */
export type ToldCanvasFact = CanvasFact & { readonly byName: string }

/** The pi `CustomMessage` a canvas fact is steered as. */
export type CanvasFactMessage = HistoryMessage<
  typeof CANVAS_FACT_TYPE,
  ToldCanvasFact
>

/** A stored message -> the canvas fact it told, or undefined. */
export const decodeCanvasFact = (
  message: unknown,
): ToldCanvasFact | undefined => CANVAS_FACT.decode(message)

/** A canvas fact in words: "Bea added Decisions to the canvas". The one wording, for the model and the column. */
export function canvasFactLine(fact: ToldCanvasFact): string {
  switch (fact.change) {
    case "added":
      return `${fact.byName} added ${fact.title} to the canvas`
    case "taken":
      return `${fact.byName} took ${fact.title} from the canvas`
    case "versioned":
      return `${fact.byName} added a version of ${fact.title}`
    case "moved":
      return `${fact.byName} moved this thread to the canvas "${fact.title}"`
  }
}

/** The steer for `fact`, its content the line in `<canvas-change>`. */
export function encodeCanvasFact(
  fact: CanvasFact,
  nameOf: (writer: WriterId) => string,
  timestamp: number,
): CanvasFactMessage {
  const told = { ...fact, byName: nameOf(fact.by) }
  return CANVAS_FACT.encode(
    told,
    `<canvas-change>${neutral(canvasFactLine(told))}</canvas-change>`,
    timestamp,
  )
}

/** A canvas fact steered into one running lane. Never a queued fact card: those wait for the run's end. */
export interface CanvasSteer {
  readonly kind: "steer"
  readonly lane: ThreadId
  readonly fact: CanvasFact
}

/**
 * What a change to the places tells the running threads of each canvas a card
 * was added to or taken from: one steer per card per running
 * lane of that canvas, the card's own thread left out; and a running thread
 * whose card moved from one canvas to another's, that it moved.
 * `by` is who moved it; a change the host made itself tells
 * nothing.
 */
export function planCanvasFacts(input: {
  readonly before: readonly CardRecord[]
  readonly after: readonly CardRecord[]
  readonly by: WriterId | null
  /** Each canvas's threads, after the change (`CanvasIndex.threadsOf`). */
  readonly threadsOf: ReadonlyMap<CanvasId, readonly ThreadId[]>
  readonly running: ReadonlySet<ThreadId>
  /** A card's title as the list names it. */
  readonly titleOf: (card: CardOnCanvas) => string
  /** An image's title as a fact names it, with its column's. */
  readonly imageTitleOf: (image: ImageInColumn) => string
  /** A canvas's title, as its canvas list names it. */
  readonly canvasTitleOf: (canvas: CanvasId) => string
}): readonly CanvasSteer[] {
  const { by } = input
  if (by === null) return []
  const onCanvas = (c: CardRecord | undefined): CardOnCanvas | undefined =>
    c !== undefined && isCardOnCanvas(c) ? c : undefined
  const was = new Map(input.before.map(c => [c.id, c] as const))
  const is = new Map(input.after.map(c => [c.id, c] as const))
  const changes: {
    canvas: CanvasId
    card: CardOnCanvas
    change: "added" | "taken"
  }[] = []
  const moved: CanvasSteer[] = []
  for (const id of new Set([...was.keys(), ...is.keys()])) {
    const before = onCanvas(was.get(id))
    const after = onCanvas(is.get(id))
    const [from, to] = [
      before?.place.canvas ?? null,
      after?.place.canvas ?? null,
    ]
    if (from === to) continue
    if (from !== null && before !== undefined)
      changes.push({ canvas: from, card: before, change: "taken" })
    if (to !== null && after !== undefined)
      changes.push({ canvas: to, card: after, change: "added" })
    if (
      from !== null &&
      to !== null &&
      after?.kind === "thread" &&
      input.running.has(after.id)
    )
      moved.push({
        kind: "steer",
        lane: after.id,
        fact: {
          canvas: to,
          by,
          title: input.canvasTitleOf(to),
          change: "moved",
        },
      })
  }
  const said: {
    canvas: CanvasId
    title: string
    change: CanvasFact["change"]
    card: CardId
  }[] = changes.map(c => ({
    ...c,
    title: input.titleOf(c.card),
    card: c.card.id,
  }))
  // An image is on its column's canvas: added, taken, or given a version.
  const canvasOfColumn = (cards: Map<CardId, CardRecord>, column: CardId) => {
    const c = cards.get(column)
    return c !== undefined && isCardOnCanvas(c) ? c.place.canvas : null
  }
  const inColumn = (c: CardRecord | undefined): ImageInColumn | undefined =>
    c?.kind === "image" && c.place.kind === "image"
      ? { ...c, place: c.place }
      : undefined
  for (const id of new Set([...was.keys(), ...is.keys()])) {
    const before = inColumn(was.get(id))
    const after = inColumn(is.get(id))
    const from =
      before === undefined ? null : canvasOfColumn(was, before.place.column)
    const to =
      after === undefined ? null : canvasOfColumn(is, after.place.column)
    if (from !== to) {
      if (from !== null && before !== undefined)
        said.push({
          canvas: from,
          title: input.imageTitleOf(before),
          change: "taken",
          card: id,
        })
      if (to !== null && after !== undefined)
        said.push({
          canvas: to,
          title: input.imageTitleOf(after),
          change: "added",
          card: id,
        })
    } else if (
      to !== null &&
      after !== undefined &&
      before !== undefined &&
      after.content.versions.length > before.content.versions.length
    )
      said.push({
        canvas: to,
        title: input.imageTitleOf(after),
        change: "versioned",
        card: id,
      })
  }
  const told = said.flatMap(({ canvas, card, title, change }) =>
    (input.threadsOf.get(canvas) ?? [])
      .filter(lane => lane !== card && input.running.has(lane))
      .map(
        (lane): CanvasSteer => ({
          kind: "steer",
          lane,
          fact: { canvas, by, title, change },
        }),
      ),
  )
  return [...told, ...moved]
}
