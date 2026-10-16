// web/strip — the columns of the canvas you are on: the canvas
// column first, then each card of the canvas in its order, folded to a
// strip or drawn whole (a thread's column, a note column), a branch not yet
// sent among them. What is drawn is decided in `@pinetrie/interface` (`canvasStrip`);
// this draws it. A column's header is its drag handle (`use-drag.ts`).

import type {
  CanvasId,
  CanvasPinnedView,
  CardId,
  EntryId,
  ForeignLane,
  NoteColumnId,
  TextCard,
  ThreadId,
  WriterId,
} from "@pinetrie/core"
import {
  type CanvasColumnView,
  type CanvasPut,
  type CardColumn,
  type ColumnMatches,
  type Column as ColumnSpec,
  type ColumnView,
  cardOfFace,
  columnReadOnly,
  detailOf,
  dropProps,
  foldedView,
  type Intent,
  type NoteColumnView,
  newColumnButton,
  type Reader,
  type ReadOnly,
  type Stage,
  type Strip as StripView,
  stripCards,
  type ThreadFace,
} from "@pinetrie/interface"
import type { CardOnCanvas } from "@pinetrie/rules"
import type { ReactElement, RefObject } from "react"
import { useMemo } from "react"
import { AddButton } from "./add-button.tsx"
import { CanvasColumn } from "./canvas-column.tsx"
import { Column, type ColumnProps } from "./column.tsx"
import { FoldedColumn } from "./folded-column.tsx"
import type { MenuItem } from "./menu.tsx"
import { NoteColumn } from "./note-column.tsx"
import type { ReadersProps } from "./root-signals.tsx"

/** What every thread column shares, whichever canvas or tab draws it. */
export type SharedColumnProps = Omit<
  ColumnProps,
  | "column"
  | "columnKey"
  | "canvas"
  | "count"
  | "onTyping"
  | "path"
  | "matches"
  | "position"
  | "drawnAt"
  | "readOnly"
  | "track"
  | "view"
  | "width"
>

/** Each thread column drawn whole, as the tab projected it, by its key. */
interface Projected {
  /** Its place among the columns drawn whole: its `data-position`. */
  readonly at: number
  readonly column: ColumnSpec
  readonly view: ColumnView
  readonly path: ReadonlySet<EntryId>
  readonly track: number
  /** Who holds the thread a branch not yet sent forks in, when someone else does. */
  readonly heldBy: WriterId | null
  /** Why no run starts from it: its lane, or the one its first send clones, is of another kind. */
  readonly foreign: ForeignLane | null
  /** Its matches while a search applies, else null. */
  readonly matches: ColumnMatches | null
}

export function Strip(p: {
  stripRef: RefObject<HTMLDivElement | null>
  stage: Extract<Stage, { kind: "canvas" | "new" }>
  /** The canvas's strip; null off a canvas. */
  strip: StripView | null
  /** Each thread column drawn whole, by its key (`openColumns`). */
  projected: ReadonlyMap<string, Projected>
  /** The canvas, for each card's place in it. */
  onCanvas: readonly CardOnCanvas[]
  /** The canvas column, as drawn; null off a canvas. */
  canvasColumn: CanvasColumnView | null
  canvasPins: readonly TextCard[]
  /** What the agent of the canvas's first column last read of its pins. */
  canvasPinsInView: CanvasPinnedView | null
  /** The canvas list the canvas's agents are told, its lines. */
  told: readonly string[]
  noteViews: ReadonlyMap<NoteColumnId, NoteColumnView>
  /** A thread's face, which its column draws when folded. */
  threadFaceOf: (thread: ThreadId) => ThreadFace
  /** A folded thread's colour track: the one its column takes. */
  threadTrackOf: (thread: ThreadId) => number
  shared: SharedColumnProps
  reader: Reader
  readers: ReadersProps
  thread: (end: EntryId, canvas: CanvasId) => MenuItem | null
  onIntent: (intent: Intent) => void
  /** This window is typing at `end` (null for none), in `card`. */
  typing: (end: EntryId | null, card: CardId | null) => void
}) {
  const { stage } = p
  const readOnly: ReadOnly | null =
    stage.kind === "canvas" ? stage.readOnly : null
  // Each card's place on the canvas: what Alt+arrows move it from.
  const positions = useMemo(
    () => new Map<string, number>(p.onCanvas.map((c, i) => [c.id, i])),
    [p.onCanvas],
  )
  const threadColumn = (
    item: Extract<CardColumn, { kind: "thread" }>,
    column: ColumnSpec,
  ): ReactElement | null => {
    const projected = p.projected.get(column.key)
    if (projected === undefined) return null
    const canvas = stage.kind === "canvas" ? stage.canvas : null
    return (
      <Column
        {...p.shared}
        column={projected.column}
        drawnAt={projected.at}
        columnKey={{ kind: "card", card: item.card }}
        key={column.key}
        onTyping={card => p.typing(projected.view.tipId, card)}
        path={projected.path}
        position={
          item?.card === null || item === null
            ? -1
            : (positions.get(item.card) ?? -1)
        }
        readOnly={columnReadOnly({
          canvas: readOnly,
          heldBy: projected.heldBy,
          foreign: projected.foreign,
          reader: p.reader,
        })}
        canvas={canvas}
        track={projected.track}
        view={projected.view}
        matches={projected.matches}
        width={item?.width ?? 1}
      />
    )
  }
  // A drop where no column takes one is a spot on the canvas:
  // just after a folded column, or past the last, where `.canvas-end`
  // leaves room for it. Past the last is where ＋ makes a column too.
  const canvasDrop = (after: CardId | null): CanvasPut | null =>
    stage.kind === "canvas" && readOnly === null
      ? { kind: "canvas", canvas: stage.canvas, after }
      : null
  const endDrop = canvasDrop(p.onCanvas.at(-1)?.id ?? null)
  const cardColumn = (item: CardColumn): ReactElement | null => {
    const folded =
      detailOf("canvas", item.folded) === "face"
        ? foldedView(item, {
            threadFaceOf: p.threadFaceOf,
            notes: p.noteViews,
          })
        : null
    if (folded !== null)
      return (
        <FoldedColumn
          drop={canvasDrop(cardOfFace(folded))}
          face={folded}
          key={cardOfFace(folded)}
          track={
            folded.kind === "thread" ? p.threadTrackOf(folded.thread) : null
          }
          onIntent={p.onIntent}
        />
      )
    // Each kind of column in one component; a new kind does not compile
    // until it is drawn.
    switch (item.kind) {
      case "thread":
        return threadColumn(item, item.column)
      case "notes": {
        const notes = p.noteViews.get(item.card)
        return notes === undefined ? null : (
          <NoteColumn
            colorOf={p.shared.colorOf}
            key={item.card}
            onIntent={p.onIntent}
            onTyping={card => p.typing(null, card)}
            readOnly={readOnly}
            reader={p.reader}
            seats={p.shared.seats}
            session={p.shared.session}
            view={notes}
            width={item.width}
          />
        )
      }
      default:
        return item satisfies never
    }
  }
  return (
    <div
      {...(endDrop === null ? {} : dropProps(endDrop))}
      id="strip"
      ref={p.stripRef}
    >
      {p.canvasColumn !== null && (
        <CanvasColumn
          onIntent={p.onIntent}
          onTyping={card => p.typing(null, card)}
          pins={p.canvasPins}
          pinsInView={p.canvasPinsInView}
          readOnly={readOnly}
          reader={p.reader}
          readers={p.readers}
          session={p.shared.session}
          thread={p.thread}
          told={p.told}
          view={p.canvasColumn}
        />
      )}
      {p.strip !== null && stripCards(p.strip).map(cardColumn)}
      {endDrop !== null && (
        <div className="canvas-end">
          <AddButton
            add={newColumnButton(endDrop)}
            folded
            onIntent={p.onIntent}
          />
        </div>
      )}
    </div>
  )
}
