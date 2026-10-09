// web/strip — the columns of the task you are on, or a new tab's one column
// (ADR-0116): the task column first, then each card of the canvas in its
// order, folded to a strip or drawn whole (a thread's column, a note
// column), with your branches not yet sent after the thread each forks
// from. What is drawn is decided in `@pinetrie/interface` (`taskStrip`);
// this draws it. A column's header is its drag handle (`use-column-drag.ts`).

import type {
  CardId,
  EntryId,
  NoteColumnId,
  TaskId,
  TaskPinnedView,
  TextCard,
  ThreadId,
  ThreadName,
} from "@pinetrie/core"
import {
  type CardColumn,
  type Column as ColumnSpec,
  type ColumnView,
  foldedView,
  type Intent,
  type NoteColumnView,
  type Reader,
  type ReadOnly,
  type Strip as StripView,
  stripCards,
  type TaskColumnView,
  type Workspace,
} from "@pinetrie/interface"
import type { CanvasCard } from "@pinetrie/rules"
import type { PointerEvent, ReactElement, RefObject } from "react"
import { useMemo } from "react"
import { Column, type ColumnProps } from "./column.tsx"
import { FoldedColumn } from "./folded-column.tsx"
import type { MenuItem } from "./menu.tsx"
import { NoteColumn } from "./note-column.tsx"
import type { ReadersProps } from "./root-signals.tsx"
import { TaskColumn } from "./task-column.tsx"

/** What every thread column shares, whichever task or tab draws it. */
export type SharedColumnProps = Omit<
  ColumnProps,
  | "column"
  | "columnKey"
  | "closable"
  | "task"
  | "count"
  | "onTyping"
  | "path"
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
  readonly closable: boolean
  readonly track: number
}

export function Strip(p: {
  stripRef: RefObject<HTMLDivElement | null>
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
  workspace: Extract<Workspace, { kind: "task" | "new" }>
  /** The task's strip; null for a new tab. */
  strip: StripView | null
  /** Each thread column drawn whole, by its key (`openColumns`). */
  projected: ReadonlyMap<string, Projected>
  /** The task's canvas, for each card's place in it. */
  canvas: readonly CanvasCard[]
  /** The task column, as drawn; null for a new tab. */
  taskColumn: TaskColumnView | null
  taskPins: readonly TextCard[]
  /** What the agent of the task's first column last read of its pins. */
  taskPinsInView: TaskPinnedView | null
  /** The canvas list the task's agents are told, its lines. */
  told: readonly string[]
  noteViews: ReadonlyMap<NoteColumnId, NoteColumnView>
  names: ReadonlyMap<ThreadId, ThreadName>
  shared: SharedColumnProps
  reader: Reader
  readers: ReadersProps
  thread: (end: EntryId, task: TaskId) => MenuItem
  onIntent: (intent: Intent) => void
  /** This window is typing at `end` (null for none), in `card`. */
  typing: (end: EntryId | null, card: CardId | null) => void
}) {
  const { workspace } = p
  const readOnly: ReadOnly | null =
    workspace.kind === "task" ? workspace.readOnly : null
  // Each card's place on the canvas: what its grip moves it from.
  const positions = useMemo(
    () => new Map<string, number>(p.canvas.map((c, i) => [c.id, i])),
    [p.canvas],
  )
  const threadColumn = (
    item: Extract<CardColumn, { kind: "thread" }> | null,
    column: ColumnSpec,
  ): ReactElement | null => {
    const projected = p.projected.get(column.key)
    if (projected === undefined) return null
    const task =
      workspace.kind === "task" ? workspace.task : (column.fresh?.task ?? null)
    return (
      <Column
        {...p.shared}
        closable={projected.closable}
        column={projected.column}
        drawnAt={projected.at}
        columnKey={
          item === null
            ? { kind: "newTab", thread: column.thread }
            : item.card === null
              ? { kind: "fresh", thread: column.thread }
              : { kind: "card", card: item.card }
        }
        count={p.canvas.length}
        key={column.key}
        onTyping={card => p.typing(projected.view.tipId, card)}
        path={projected.path}
        position={
          item?.card === null || item === null
            ? -1
            : (positions.get(item.card) ?? -1)
        }
        readOnly={readOnly}
        task={task}
        track={projected.track}
        view={projected.view}
        width={item?.width ?? 1}
      />
    )
  }
  const cardColumn = (item: CardColumn): ReactElement | null => {
    const folded = item.folded
      ? foldedView(item, { names: p.names, notes: p.noteViews })
      : null
    if (folded !== null)
      return (
        <FoldedColumn key={folded.card} onIntent={p.onIntent} view={folded} />
      )
    if (item.kind === "thread") return threadColumn(item, item.column)
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
  return (
    <div id="strip" onPointerDown={p.onPointerDown} ref={p.stripRef}>
      {p.taskColumn !== null && (
        <TaskColumn
          onIntent={p.onIntent}
          onTyping={card => p.typing(null, card)}
          pins={p.taskPins}
          pinsInView={p.taskPinsInView}
          readOnly={readOnly}
          reader={p.reader}
          readers={p.readers}
          session={p.shared.session}
          thread={p.thread}
          told={p.told}
          view={p.taskColumn}
        />
      )}
      {p.strip === null
        ? [...p.projected.values()].map(({ column }) =>
            threadColumn(null, column),
          )
        : stripCards(p.strip).map(cardColumn)}
    </div>
  )
}
