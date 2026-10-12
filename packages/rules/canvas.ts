// canvas — what a run's agent is told of its task's canvas.

import type {
  CanvasView,
  CardRecord,
  NoteColumnId,
  RootWork,
  TaskId,
  ThreadId,
  ThreadName,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { List, TaskIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { attribute, neutral } from "./pinned.ts"
import { type CanvasCard, isCanvasCard } from "./task.ts"

export const CANVAS_TYPE = "pinetrie.canvas"

/**
 * The line every agent thread's `<rules>` holds for the canvas list.
 * Constant, so the system prompt stays the same between runs.
 */
export const CANVAS_RULE =
  "The task's cards are listed in a `<canvas>` block, in the order everyone sees them, and the latest block is what holds. Only pinned cards' contents are given."

/** How many cards the list names; the rest are counted. */
export const CANVAS_CAP = 50

const CanvasDetailsSchema = Type.Object({
  task: TaskIdSchema,
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
  readonly task: TaskId
  /** The task's title, else its first card's line (`labelsOf`). */
  readonly title: string
  /** Its cards, in order. */
  readonly canvas: readonly CanvasCard[]
  /** The thread whose run reads the list, marked in it; null for none. */
  readonly reading: ThreadId | null
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  /** What each thread's agent is doing; a thread absent is idle. */
  readonly work: ReadonlyMap<ThreadId, RootWork>
  /** Each note column's title, else `NEW_NOTES_TITLE`. */
  readonly noteTitles: ReadonlyMap<NoteColumnId, string>
  /** How many notes each note column holds. */
  readonly noteCounts: ReadonlyMap<NoteColumnId, number>
  readonly nameOf: (writer: WriterId) => string
}

const STATE_WORDS: Readonly<Record<RootWork, string>> = {
  running: "running",
  waiting: "waiting",
  held: "held",
}

const notesWords = (n: number): string => (n === 1 ? "1 note" : `${n} notes`)

/**
 * One card's line. A thread is named by its two words, else by "a thread";
 * the reading thread says so, and no state, which is always its own run.
 */
function cardLine(c: CanvasCard, f: CanvasFacts): string {
  const by = `put by ${f.nameOf(c.placer)}`
  switch (c.kind) {
    case "thread": {
      const name = f.names.get(c.id) ?? "a thread"
      if (c.id === f.reading) return `thread ${name} (this thread), ${by}`
      const work = f.work.get(c.id)
      return `thread ${name}, ${work === undefined ? "idle" : STATE_WORDS[work]}, ${by}`
    }
    case "note-column": {
      const title = f.noteTitles.get(c.id) ?? ""
      return `note column "${title}", ${notesWords(f.noteCounts.get(c.id) ?? 0)}, ${by}`
    }
    // A new kind of canvas card does not compile until it has its line.
    default:
      return c satisfies never
  }
}

/** The canvas list `facts` make: at most `CANVAS_CAP` lines, the rest counted. */
export function canvasList(facts: CanvasFacts): CanvasView {
  const lines = facts.canvas.map(c => cardLine(c, facts))
  return {
    task: facts.task,
    title: facts.title,
    lines: lines.slice(0, CANVAS_CAP),
    more: Math.max(0, lines.length - CANVAS_CAP),
  }
}

const sameCanvas = (a: CanvasView, b: CanvasView): boolean =>
  a.task === b.task &&
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

/** The list's lines as the task column and the model read them, its tail counted. */
export const canvasLines = (view: CanvasView): readonly string[] =>
  view.more === 0 ? view.lines : [...view.lines, `and ${view.more} more`]

/** What the model reads of `view`. */
export const canvasContent = (view: CanvasView): string =>
  `<canvas task="${attribute(view.title)}">\n${canvasLines(view)
    .map(neutral)
    .join("\n")}\n</canvas>`

/** The canvas entry for `view`. */
export const encodeCanvas = (
  view: CanvasView,
  timestamp: number,
): CanvasMessage =>
  CANVAS.encode(
    {
      task: view.task,
      title: view.title,
      lines: [...view.lines],
      more: view.more,
    },
    canvasContent(view),
    timestamp,
  )

// ── a change during a run ─────────────────────────────────────

/**
 * A card added to a task's canvas or taken from it, as a running thread of
 * the task is told; or, told to a running thread itself, its card moved to
 * another task's canvas: a fact line, steered after the turn in
 * flight as base news is. Reorders, widths and titles wait
 * for the next run's list.
 */
export interface CanvasFact {
  readonly task: TaskId
  readonly by: WriterId
  /**
   * The card's title as the list names it: a thread's name, a note column's
   * title; for `moved`, the title of the task it moved to.
   */
  readonly title: string
  readonly change: "added" | "taken" | "moved"
}

export const CANVAS_FACT_TYPE = "pinetrie.canvas-fact"

const CanvasFactDetailsSchema = Type.Object({
  task: TaskIdSchema,
  by: WriterIdSchema,
  /** Who moved it, by their display name then, as a chat keeps its author's. */
  byName: Type.String(),
  title: Type.String(),
  change: Type.Union([
    Type.Literal("added"),
    Type.Literal("taken"),
    Type.Literal("moved"),
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
    case "moved":
      return `${fact.byName} moved this thread to the task "${fact.title}"`
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
 * What a change to the places tells the running threads of each task a card
 * was added to or taken from: one steer per card per running
 * lane of that task, the card's own thread left out; and a running thread
 * whose card moved from one task's canvas to another's, that it moved.
 * `by` is who moved it; a change the host made itself tells
 * nothing.
 */
export function planCanvasFacts(input: {
  readonly before: readonly CardRecord[]
  readonly after: readonly CardRecord[]
  readonly by: WriterId | null
  /** Each task's threads, after the change (`TaskIndex.threadsOf`). */
  readonly threadsOf: ReadonlyMap<TaskId, readonly ThreadId[]>
  readonly running: ReadonlySet<ThreadId>
  /** A card's title as the list names it. */
  readonly titleOf: (card: CanvasCard) => string
  /** A task's title, as its canvas list names it. */
  readonly taskTitleOf: (task: TaskId) => string
}): readonly CanvasSteer[] {
  const { by } = input
  if (by === null) return []
  const onCanvas = (c: CardRecord | undefined): CanvasCard | undefined =>
    c !== undefined && isCanvasCard(c) ? c : undefined
  const was = new Map(input.before.map(c => [c.id, c] as const))
  const is = new Map(input.after.map(c => [c.id, c] as const))
  const changes: {
    task: TaskId
    card: CanvasCard
    change: "added" | "taken"
  }[] = []
  const moved: CanvasSteer[] = []
  for (const id of new Set([...was.keys(), ...is.keys()])) {
    const before = onCanvas(was.get(id))
    const after = onCanvas(is.get(id))
    const [from, to] = [before?.place.task ?? null, after?.place.task ?? null]
    if (from === to) continue
    if (from !== null && before !== undefined)
      changes.push({ task: from, card: before, change: "taken" })
    if (to !== null && after !== undefined)
      changes.push({ task: to, card: after, change: "added" })
    if (
      from !== null &&
      to !== null &&
      after?.kind === "thread" &&
      input.running.has(after.id)
    )
      moved.push({
        kind: "steer",
        lane: after.id,
        fact: { task: to, by, title: input.taskTitleOf(to), change: "moved" },
      })
  }
  const told = changes.flatMap(({ task, card, change }) =>
    (input.threadsOf.get(task) ?? [])
      .filter(lane => lane !== card.id && input.running.has(lane))
      .map(
        (lane): CanvasSteer => ({
          kind: "steer",
          lane,
          fact: { task, by, title: input.titleOf(card), change },
        }),
      ),
  )
  return [...told, ...moved]
}
