// web/task-column — the task column: the task's own place on its canvas,
// drawn before every card and outside the order, so nothing moves it. Its
// title is renamed in place, its state changed from its Move to ▸, the same
// intents the sidebar and the board send; who is here is the board's
// readers. Folded, it is a `FoldedStrip` with its title, and no mark. What it
// says is `taskColumnView`'s.

import type {
  CardId,
  EntryId,
  TaskId,
  TaskPinnedView,
  TextCard,
} from "@pinetrie/core"
import {
  boardStateWords,
  type ColumnAct,
  dropProps,
  dropsWords,
  FIRST_NOTE_COLUMN,
  FOLD_TASK,
  type Intent,
  NO_MARK,
  pinnedCountWords,
  RENAME_TASK_TITLE,
  RESTORE_WORDS,
  type Reader,
  type ReadOnly,
  renameIntent,
  TASK_LIST_HEADING,
  TASK_PINS_EMPTY,
  TASK_PINS_HEADING,
  type TaskColumnView,
  trashHeading,
  trashWords,
  UNFOLD_TASK,
} from "@pinetrie/interface"
import { TASK_BUSY_REASON } from "@pinetrie/rules"
import type { SessionClient } from "@pinetrie/session"
import { useState } from "react"
import { PinnedCardEditor } from "./card-editor.tsx"
import { FoldedStrip } from "./folded-strip.tsx"
import { Menu, type MenuItem } from "./menu.tsx"
import { ReaderMenus, type ReadersProps } from "./root-signals.tsx"
import { TitleField } from "./title-field.tsx"

export function TaskColumn(p: {
  session: SessionClient
  view: TaskColumnView
  /** The cards pinned to the task, in order (`taskPinnedOf`). */
  pins: readonly TextCard[]
  /**
   * What the agent of the task's first column last read of them
   * (`taskPinnedInView`), as a thread's pins are read; null for nothing yet.
   */
  pinsInView: TaskPinnedView | null
  /** The canvas list the task's agents are told (`canvasList`), its lines. */
  told: readonly string[]
  reader: Reader
  readOnly: ReadOnly | null
  onTyping: (card: CardId) => void
  readers: ReadersProps
  /** A reader's menu row: one of their threads, which opens it. */
  thread: (end: EntryId, task: TaskId) => MenuItem | null
  onIntent: (intent: Intent) => void
}) {
  const { view } = p
  const [renaming, setRenaming] = useState(false)
  const fold = (unfolded: boolean) => p.onIntent({ kind: "foldTask", unfolded })
  // A pin's acts are said in the task column, by its task's id.
  const act = (a: ColumnAct) =>
    p.onIntent({
      kind: "column",
      column: { kind: "task", task: view.task },
      act: a,
    })
  if (view.folded)
    return (
      <section className="task-column folded-column" data-task={view.task}>
        <FoldedStrip
          detail={pinnedCountWords(p.pins.length)}
          mark={NO_MARK}
          name={view.label}
          onUnfold={() => fold(true)}
          unfold={UNFOLD_TASK}
        />
      </section>
    )
  return (
    <section className="task-column" data-task={view.task}>
      <header className="task-column-head">
        {renaming && !view.readOnly ? (
          <TitleField
            label="title for this task"
            onEnd={() => setRenaming(false)}
            onSend={title => p.onIntent(renameIntent(view.task, title))}
            placeholder={view.placeholder}
            stored={view.titled}
          />
        ) : (
          <button
            className="task-column-title"
            disabled={view.readOnly}
            onClick={() => setRenaming(true)}
            title={RENAME_TASK_TITLE}
            type="button"
          >
            <span data-fold-name="">{view.label}</span>
          </button>
        )}
        <button
          aria-label={FOLD_TASK.title}
          className={FOLD_TASK.className}
          onClick={() => fold(false)}
          title={FOLD_TASK.title}
          type="button"
        >
          {FOLD_TASK.label}
        </button>
      </header>
      <div className="task-column-body">
        <div className="task-state">
          <span className="task-state-name">{boardStateWords(view.state)}</span>
          {view.moves.length > 0 && (
            <Menu
              className="task-state-menu"
              label="move this task on the board"
              sections={[
                {
                  key: "moves",
                  items: view.moves.map(m => {
                    const drops = m.busy === null ? dropsWords(m.drops) : null
                    return {
                      key: m.name,
                      className: m.closes ? "move-to closes" : "move-to",
                      disabled: m.busy !== null,
                      title: m.closes
                        ? "archive: read-only for everyone until moved out"
                        : "move it on the board, for everyone",
                      label: (
                        <>
                          Move to {m.name}
                          {m.busy !== null && (
                            <span className="why">
                              {" "}
                              · {TASK_BUSY_REASON[m.busy]}
                            </span>
                          )}
                          {drops !== null && (
                            <span className="why drops"> · {drops}</span>
                          )}
                        </>
                      ),
                      onChoose: () => p.onIntent(m.intent),
                    }
                  }),
                },
              ]}
              trigger="Move to ▸"
              triggerClassName="task-state-move"
            />
          )}
        </div>
        <div
          className="task-pins"
          data-empty={p.pins.length === 0 || undefined}
          {...(view.readOnly
            ? {}
            : dropProps({ kind: "taskPinned", task: view.task }))}
        >
          <span className="task-pins-heading">{TASK_PINS_HEADING}</span>
          {p.pins.length === 0 && (
            <span className="pinned-empty">{TASK_PINS_EMPTY}</span>
          )}
          {p.pins.map(c => (
            <PinnedCardEditor
              among={p.pins}
              card={c}
              catchUps={null}
              inView={p.pinsInView}
              key={c.id}
              onAct={act}
              onTyping={p.onTyping}
              queueOn={null}
              readOnly={p.readOnly}
              reader={p.reader}
              session={p.session}
            />
          ))}
        </div>
        <details className="task-told">
          <summary>{TASK_LIST_HEADING}</summary>
          {p.told.map(line => (
            <div className="task-told-line" key={line}>
              {line}
            </div>
          ))}
        </details>
        {view.trash.length > 0 && (
          <details className="task-trash">
            <summary>{trashHeading(view.trash.length)}</summary>
            {view.trash.map(row => (
              <div className="trash-row" data-card={row.card} key={row.card}>
                <span className="trash-title">{row.title}</span>
                <span className="why"> · {trashWords(row, p.reader)}</span>
                <button
                  className="trash-restore"
                  disabled={view.readOnly}
                  onClick={() =>
                    p.onIntent({
                      kind: "restore",
                      card: row.card,
                      at: { kind: "column", key: view.task },
                    })
                  }
                  title={RESTORE_WORDS.title}
                  type="button"
                >
                  {RESTORE_WORDS.label}
                </button>
              </div>
            ))}
          </details>
        )}
        <div className="task-here">
          <ReaderMenus {...p.readers} task={view.task} thread={p.thread} />
        </div>
        {!view.readOnly && (
          <button
            className={FIRST_NOTE_COLUMN.className}
            onClick={() => p.onIntent({ kind: "addNoteColumn", after: null })}
            title={FIRST_NOTE_COLUMN.title}
            type="button"
          >
            {FIRST_NOTE_COLUMN.label}
          </button>
        )}
      </div>
    </section>
  )
}
