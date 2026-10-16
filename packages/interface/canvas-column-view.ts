// interface/canvas-column-view — the canvas column: the canvas's own column,
// first, outside its order. It shows the canvas's title, renamed there; where
// it is on the board, a topic or a task by its state, changed there; who is here; the cards pinned to the
// canvas; and the canvas list its agents are told. Its title and its state are
// the same intents the sidebar and the board send. Folded, it shows the title
// and how many cards are pinned to the canvas. `CanvasColumn`
// (`packages/web/canvas-column.tsx`) draws it.

import type {
  CanvasId,
  CardHistoryRecord,
  CardId,
  CardRecord,
  MarkRecord,
  NoteColumnId,
  NoteColumnRecord,
  ThreadId,
  ThreadName,
  Workflow,
  WorkflowStateId,
  WriterId,
} from "@pinetrie/core"
import {
  type CanvasRole,
  canvasRole,
  NEW_NOTES_TITLE,
  trashDeadline,
  trashedAt,
} from "@pinetrie/rules"
import { type ControlWords, who } from "./card-words.ts"
import { agoWords, spanWords, until } from "./counts.ts"
import { FOLD, UNFOLD, UNNAMED_THREAD } from "./folded-column-view.ts"
import { type CanvasSummary, NO_TEXT } from "./root-label.ts"
import type { Reader } from "./send.ts"
import type { ThreadCardHead, ThreadMove } from "./thread-card.ts"

/** A canvas's state on the board, by name, and the role it gives the canvas. */
export interface PlaceOnBoard {
  readonly name: string
  readonly role: CanvasRole
}

/** Where a canvas in `state` is on the board; null before it is placed, or its state is gone. */
export function placeOnBoard(
  workflow: Workflow | null,
  state: WorkflowStateId | null,
): PlaceOnBoard | null {
  const found =
    state === null || workflow === null
      ? undefined
      : [...workflow.open, workflow.archive].find(s => s.id === state)
  return found === undefined || workflow === null
    ? null
    : { name: found.name, role: canvasRole(workflow, found.id) }
}

/** The canvas column, as drawn. */
export interface CanvasColumnView {
  readonly canvas: CanvasId
  readonly folded: boolean
  /** Its label: its title, else its first card's (`labelsOf`). */
  readonly label: string
  /** Its stored title, or null: what the rename field starts with. */
  readonly titled: string | null
  /** The rename field's placeholder: its first message's line. */
  readonly placeholder: string
  /**
   * Where it is on the board: its state's name, and what that makes it
   * (`canvasRole`); null before the host placed it.
   */
  readonly place: PlaceOnBoard | null
  /** Move to ▸ each other state, as its thread card offers (`ThreadMove`). */
  readonly moves: readonly ThreadMove[]
  /** Nothing may be changed here: an archived canvas's column. */
  readonly readOnly: boolean
  /** Its canvas's trash (`canvasTrash`). */
  readonly trash: CanvasTrash
}

/** A canvas's trash, as its list draws it. */
export interface CanvasTrash {
  /** The columns trashed from the canvas, newest first. */
  readonly rows: readonly TrashRow[]
  /** How long a trashed column is kept before it is deleted. */
  readonly keepMs: number
}

/** A column in the trash of a canvas, as its list draws it. */
export interface TrashRow {
  readonly card: ThreadId | NoteColumnId
  /** The thread's name, or the note column's title. */
  readonly title: string
  /** Who trashed it: its placer. */
  readonly by: WriterId
  /** How long ago it was trashed (`trashedAt`). */
  readonly ageMs: number
  /**
   * How long until the sweep deletes it (`trashDeadline`), at least 0, once
   * that is close enough to warn of (`trashWarnMs`); null before.
   */
  readonly deletesInMs: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How close a trashed column's deletion is before its row warns of it: its
 * last day, or the last quarter of a keep shorter than four days, so a short
 * keep does not warn from the start.
 */
export const trashWarnMs = (keepMs: number): number =>
  Math.min(DAY_MS, keepMs / 4)

/**
 * The columns trashed from `canvas`'s canvas: each thread or note column in a
 * trash whose `left` is that canvas, the newest discard first.
 */
export function canvasTrash(input: {
  readonly cards: readonly CardRecord[]
  readonly histories: ReadonlyMap<CardId, CardHistoryRecord>
  readonly canvas: CanvasId
  readonly now: number
  /** How long a trashed card is kept (`TRASH_KEEP_MS`). */
  readonly keepMs: number
  readonly names: ReadonlyMap<ThreadId, ThreadName>
  readonly noteTitles: ReadonlyMap<NoteColumnId, NoteColumnRecord>
}): CanvasTrash {
  const rows = input.cards.flatMap(c => {
    if (
      c.place.kind !== "trash" ||
      c.place.left.kind !== "canvas" ||
      c.place.left.canvas !== input.canvas
    )
      return []
    const { now, keepMs } = input
    const deadline = trashDeadline(c.id, input.histories, now, keepMs)
    const left = Math.max(0, deadline - now)
    const row = (card: ThreadId | NoteColumnId, title: string) => [
      {
        deadline,
        row: {
          card,
          title,
          by: c.placer,
          ageMs: now - trashedAt(c.id, input.histories, now),
          deletesInMs: left <= trashWarnMs(keepMs) ? left : null,
        },
      },
    ]
    switch (c.kind) {
      case "thread":
        return row(c.id, input.names.get(c.id) ?? UNNAMED_THREAD)
      case "note-column":
        return row(c.id, input.noteTitles.get(c.id)?.title ?? NEW_NOTES_TITLE)
      default:
        return []
    }
  })
  const sorted = rows
    .sort((a, b) =>
      b.deadline !== a.deadline
        ? b.deadline - a.deadline
        : a.row.card < b.row.card
          ? -1
          : 1,
    )
    .map(r => r.row)
  return { rows: sorted, keepMs: input.keepMs }
}

/**
 * A trash row's words: who trashed it and when, or, once its deletion is
 * close, when it is deleted. Kept short to fit one line under the title in a
 * narrow column.
 */
export const trashWords = (row: TrashRow, reader: Reader): string =>
  `${who(row.by, reader)} · ${
    row.deletesInMs === null
      ? agoWords(row.ageMs)
      : `deleted ${until(row.deletesInMs)}`
  }`

/** The trash list's heading, with how many it holds. */
export const trashHeading = (n: number): string => `trash · ${n}`

/** Under the heading: how long a trashed column is kept, from the keep itself. */
export const trashKeepWords = (keepMs: number): string =>
  `kept for ${spanWords(keepMs)} after it is trashed, then deleted`

/** A trash row's button, and what it does. */
export const RESTORE_WORDS = {
  label: "restore",
  title: "bring it back where it was, for everyone",
} as const

/** The canvas column of `canvas`, from its thread card's head and its title's record. */
export function canvasColumnView(input: {
  readonly canvas: CanvasId
  readonly folded: boolean
  readonly head: ThreadCardHead | undefined
  readonly mark: MarkRecord | undefined
  readonly summary: CanvasSummary | undefined
  readonly workflow: Workflow | null
  readonly archived: boolean
  /** Its canvas's trash (`canvasTrash`). */
  readonly trash: CanvasTrash
}): CanvasColumnView {
  const { head, workflow } = input
  const place = placeOnBoard(workflow, head?.state ?? null)
  return {
    canvas: input.canvas,
    folded: input.folded,
    label: head?.label ?? NO_TEXT,
    titled: input.mark?.title ?? null,
    placeholder: input.summary?.line ?? NO_TEXT,
    place,
    moves: input.archived ? [] : (head?.moves ?? []),
    readOnly: input.archived,
    trash: input.trash,
  }
}

/** The canvas column's ⇤, which folds it to a strip: a card column's, titled for the canvas. */
export const FOLD_CANVAS: ControlWords = {
  ...FOLD,
  title: "fold the canvas's column: only you see your folds",
}

/** The canvas column folded: its button, which unfolds it, a card column's strip's. */
export const UNFOLD_CANVAS: ControlWords = {
  ...UNFOLD,
  title:
    "the canvas: its title, its state, who is here, its pins and what its agents are told",
}

/** The canvas column's rename, on its title. */
export const RENAME_CANVAS_TITLE = "rename this canvas, for everyone"

/** How many cards are pinned to the canvas, as its folded column says it. */
export const pinnedCountWords = (n: number): string | null =>
  n === 0 ? null : `${n} pinned`

/** The canvas column's pinned cards, empty: where a drop pins one. */
export const CANVAS_PINS_EMPTY =
  "drop a card here to pin it to the canvas: every thread's agent reads it"

/** The heading over the canvas's pinned cards. */
export const CANVAS_PINS_HEADING = "pinned to the canvas"

/** The heading over the canvas list the canvas's agents are told. */
export const CANVAS_LIST_HEADING = "what its agents are told of the canvas"

/** The canvas a role makes, as a person reads it. */
const ROLE_NOUN = {
  topic: "topic",
  task: "task",
  archived: "canvas",
} as const satisfies Record<CanvasRole, string>

/**
 * What the state's line says, where the canvas is on the board and what that
 * makes it, and its Move to ▸ menu's name.
 */
export function boardPlaceWords(place: PlaceOnBoard | null): {
  readonly line: string
  readonly moveLabel: string
} {
  if (place === null)
    return {
      line: "not on the board yet",
      moveLabel: "move this canvas on the board",
    }
  const noun = ROLE_NOUN[place.role]
  return {
    line:
      place.role === "archived"
        ? `archived, in ${place.name}`
        : `a ${noun}, in ${place.name}`,
    moveLabel: `move this ${noun} on the board`,
  }
}
