// client/board — the board (ADR-0085): everyone's roots, each in its
// workflow state. Its strip sits in the footer and says each state's name,
// count, the people reading in its roots, and its highest mark; ▦ opens the
// board over the columns, moving none of them, and ▦, Escape or a click
// outside it closes it.
//
// Opened, each open state is a column: drag an item to another column, or
// within one, or use its ⋯'s Move to ▸, to move it for everyone. To the
// closed state it is archived (ADR-0029). Selecting an item opens it in your
// list; dragged onto your list, it opens there. A state's name is edited in
// place, its ⋯ moves or removes it, and ＋ state adds one. The closed state
// is a count, a search over labels and its most recent roots. What it shows
// is `boardView`'s.

import type { EntryId, WriterId } from "@pinetrie/core"
import { ROOT_BUSY_REASON } from "@pinetrie/rules"
import { useEffect, useRef, useState } from "react"
import { LEVEL_CLASS, LEVEL_WORDS, type Level } from "./attention.ts"
import {
  type BoardItem,
  type BoardSide,
  type BoardView,
  clickClosesBoard,
  closedWords,
  nameStateIntent,
  type StripState,
} from "./board-view.ts"
import type { Intent } from "./intent.ts"
import { Menu, type MenuItem } from "./menu.tsx"
import { AddButton } from "./open-list.tsx"
import { type MessageCount, messageCountTitle } from "./root-label.ts"
import {
  ReaderMenus,
  Readers,
  type ReadersProps,
  RootStatus,
  StatusMark,
} from "./root-signals.tsx"
import { rootDropProps, rootGroupProps } from "./root-target.ts"
import { startRootDrag } from "./use-root-drag.ts"

/** ▦'s mark's title: what the roots not in your list raise. */
const elsewhereWords = (level: Level): string =>
  `a thread not in your list: ${LEVEL_WORDS[level]}`

/** The strip: ▦, then each state's name, count, readers and mark. */
export function BoardStrip({
  view,
  open,
  onIntent,
  count,
  elsewhere,
  pip,
  readers,
}: {
  view: BoardView | null
  open: boolean
  onIntent: (intent: Intent) => void
  /** The session's message count: ▦'s title and `data-messages`. */
  count: MessageCount
  /** The highest a root not in your list raises (`markOf`). */
  elsewhere: Level | null
  /** A root not in your list holds an unsent card of yours. */
  pip: React.ReactNode | null
  readers: ReadersProps
}) {
  const toggle = () => onIntent({ kind: "board", open: !open })
  return (
    <div className="board-strip">
      <button
        aria-expanded={open}
        className="board-toggle"
        data-messages={count.total}
        onClick={toggle}
        title={messageCountTitle(count)}
        type="button"
      >
        <span aria-hidden className="glyph">
          ▦
        </span>{" "}
        Board
        {elsewhere !== null && (
          <StatusMark
            arrived={null}
            level={elsewhere}
            title={elsewhereWords(elsewhere)}
          />
        )}
        {pip}
      </button>
      {view?.strip.map(s => (
        <StripStateButton
          key={s.id}
          onOpen={() => onIntent({ kind: "board", open: true })}
          readers={readers}
          state={s}
        />
      ))}
    </div>
  )
}

function StripStateButton({
  state,
  onOpen,
  readers,
}: {
  state: StripState
  onOpen: () => void
  readers: ReadersProps
}) {
  return (
    <button
      className="strip-state"
      data-closed={state.closed || undefined}
      data-state={state.id}
      onClick={onOpen}
      type="button"
    >
      <span className="strip-name">{state.name}</span>{" "}
      <b className="strip-count">{state.count}</b>
      {!state.closed && <Readers {...readers} roots={state.roots} />}
      {state.mark !== null && (
        <span
          aria-label={LEVEL_WORDS[state.mark]}
          className={`root-status ${LEVEL_CLASS[state.mark]}`}
          role="img"
          title={LEVEL_WORDS[state.mark]}
        />
      )}
    </button>
  )
}

/** The board, open over the columns. */
export function Board({
  view,
  onIntent,
  query,
  onQuery,
  mine,
  onMine,
  readers,
  thread,
  pip,
}: {
  view: BoardView
  onIntent: (intent: Intent) => void
  /** The closed state's search and its "mine": never stored. */
  query: string
  onQuery: (q: string) => void
  mine: boolean
  onMine: (mine: boolean) => void
  readers: ReadersProps
  /** A thread as a row of a reader's menu, which opens it. */
  thread: (end: EntryId, root: EntryId) => MenuItem
  pip: React.ReactNode
}) {
  // Escape closes the board, as ▦ does, and so does a click outside it
  // (`clickClosesBoard`). Both ends of a click are read in the capture
  // phase, before what was clicked can take itself out of the page.
  const self = useRef<HTMLElement>(null)
  useEffect(() => {
    const close = () => onIntent({ kind: "board", open: false })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    const side = (at: EventTarget | null): BoardSide =>
      !(at instanceof Element)
        ? "elsewhere"
        : self.current?.contains(at)
          ? "board"
          : at.closest(".board-strip") !== null
            ? "strip"
            : "elsewhere"
    let press: BoardSide | null = null
    const onPress = (e: PointerEvent) => {
      press = side(e.target)
    }
    const onClick = (e: MouseEvent) => {
      if (clickClosesBoard(press, side(e.target))) close()
      press = null
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPress, true)
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPress, true)
      document.removeEventListener("click", onClick, true)
    }
  }, [onIntent])
  const [adding, setAdding] = useState(false)
  // An open column's item is a place to drop before; a closed row is not,
  // since the closed state shows its roots by activity, not by place.
  const item = (t: BoardItem, place: boolean) => (
    <ItemCard
      drop={
        place
          ? rootDropProps({ kind: "state", state: t.state, before: t.root })
          : {}
      }
      item={t}
      key={t.root}
      onIntent={onIntent}
      pip={pip}
      readers={readers}
      thread={thread}
    />
  )
  return (
    <section aria-label="board" className="board" id="board" ref={self}>
      {view.open.map(column => (
        <div
          className="board-column"
          data-state={column.state.id}
          key={column.state.id}
          {...rootGroupProps}
          {...rootDropProps({
            kind: "state",
            state: column.state.id,
            before: null,
          })}
        >
          <div className="board-head">
            <StateName
              name={column.state.name}
              onName={name => onIntent(nameStateIntent(column.state.id, name))}
            />
            <span className="board-count">{column.items.length}</span>
            {column.mark !== null && (
              <StatusMark
                arrived={null}
                level={column.mark}
                title={LEVEL_WORDS[column.mark]}
              />
            )}
            <Menu
              className="state-more"
              label={`more for ${column.state.name}`}
              sections={[
                {
                  key: "state",
                  items: [
                    ...(column.left === null
                      ? []
                      : [moveItem("left", column.left, onIntent)]),
                    ...(column.right === null
                      ? []
                      : [moveItem("right", column.right, onIntent)]),
                    {
                      key: "remove",
                      className: "remove-state",
                      disabled: column.remove.why !== null,
                      title: "remove this state from the board, for everyone",
                      label: (
                        <>
                          Remove
                          {column.remove.why !== null && (
                            <span className="why"> · {column.remove.why}</span>
                          )}
                        </>
                      ),
                      onChoose: () => onIntent(column.remove.intent),
                    },
                  ],
                },
              ]}
              trigger="⋯"
              triggerClassName="state-menu"
            />
          </div>
          <div className="board-items">
            {column.items.map(t => item(t, true))}
          </div>
          <AddButton add={column.add} onIntent={onIntent} />
        </div>
      ))}
      <div className="board-add-state">
        {adding ? (
          <StateName
            editing
            name=""
            onEnd={() => setAdding(false)}
            onName={name => onIntent(nameStateIntent(null, name))}
          />
        ) : (
          <button
            className="add-state"
            onClick={() => setAdding(true)}
            title="add a workflow state to the board, for everyone"
            type="button"
          >
            ＋ state
          </button>
        )}
      </div>
      <div
        className="board-closed"
        data-state={view.closed.state.id}
        {...rootGroupProps}
        {...rootDropProps({
          kind: "state",
          state: view.closed.state.id,
          before: null,
        })}
      >
        <div className="board-head">
          <StateName
            name={view.closed.state.name}
            onName={name =>
              onIntent(nameStateIntent(view.closed.state.id, name))
            }
          />
          <span className="board-count" title={closedWords(view.closed.count)}>
            {view.closed.count}
          </span>
        </div>
        <input
          aria-label={`search ${view.closed.state.name}`}
          className="closed-search"
          onChange={e => onQuery(e.target.value)}
          placeholder={`search ${closedWords(view.closed.count)}…`}
          value={query}
        />
        <label className="closed-mine">
          <input
            checked={mine}
            onChange={e => onMine(e.target.checked)}
            type="checkbox"
          />{" "}
          mine
        </label>
        <div className="board-items">
          {view.closed.rows.map(t => item(t, false))}
        </div>
      </div>
    </section>
  )
}

const moveItem = (
  side: "left" | "right",
  intent: Intent,
  onIntent: (intent: Intent) => void,
): MenuItem => ({
  key: side,
  className: `move-state-${side}`,
  title: `move this state one place ${side}, for everyone`,
  label: side === "left" ? "Move left" : "Move right",
  onChoose: () => onIntent(intent),
})

/** A root on the board: its status, label and pip; its readers; its ⋯. */
function ItemCard({
  item,
  drop,
  onIntent,
  readers,
  thread,
  pip,
}: {
  item: BoardItem
  /** Its drop zone's attributes (`rootDropProps`), or none. */
  drop: Readonly<Record<string, string>>
  onIntent: (intent: Intent) => void
  readers: ReadersProps
  thread: (end: EntryId, root: EntryId) => MenuItem
  pip: React.ReactNode
}) {
  return (
    <div
      className="board-item"
      data-entry={item.entry}
      data-root={item.root}
      {...drop}
    >
      <button
        className="board-open"
        draggable
        onClick={() => onIntent(item.show)}
        onDragStart={startRootDrag({
          root: item.root,
          entry: item.entry,
          state: item.state,
        })}
        title={item.label}
        type="button"
      >
        <RootStatus
          arrived={null}
          done={null}
          nameOf={readers.nameOf}
          status={item.status}
        />
        <span className="board-label">{item.label}</span>
        {item.card && pip}
      </button>
      <span className="board-meta">
        <Writers nameOf={readers.nameOf} writers={item.writers} />
        <ReaderMenus {...readers} root={item.entry} thread={thread} />
      </span>
      <Menu
        className="item-more"
        label="move this thread on the board"
        sections={[
          ...(item.up === null && item.down === null
            ? []
            : [
                {
                  key: "order",
                  items: [
                    ...(item.up === null
                      ? []
                      : [
                          {
                            key: "up",
                            className: "move-up",
                            title: "move it up its state, for everyone",
                            label: "Move up",
                            onChoose: () =>
                              item.up !== null && onIntent(item.up),
                          },
                        ]),
                    ...(item.down === null
                      ? []
                      : [
                          {
                            key: "down",
                            className: "move-down",
                            title: "move it down its state, for everyone",
                            label: "Move down",
                            onChoose: () =>
                              item.down !== null && onIntent(item.down),
                          },
                        ]),
                  ],
                },
              ]),
          {
            key: "moves",
            items: item.moves.map(m => ({
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
                    <span className="why"> · {ROOT_BUSY_REASON[m.busy]}</span>
                  )}
                </>
              ),
              onChoose: () => onIntent(m.intent),
            })),
          },
        ]}
        trigger="⋯"
        triggerClassName="item-menu"
      />
    </div>
  )
}

/** Who wrote in a root, quietly: the first few names. */
function Writers({
  writers,
  nameOf,
}: {
  writers: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
}) {
  if (writers.length === 0) return null
  const names = writers
    .slice(0, 3)
    .map(w => nameOf.get(w) ?? w.split("@")[0] ?? w)
  const more = writers.length > 3 ? ` +${writers.length - 3}` : ""
  return <span className="board-writers">{`${names.join(", ")}${more}`}</span>
}

/**
 * A state's name: text, or a field while it is edited. Enter and leaving the
 * field send a changed name; Escape, or an empty name, keeps the old one.
 */
function StateName({
  name,
  onName,
  editing: startEditing = false,
  onEnd,
}: {
  name: string
  onName: (name: string) => void
  editing?: boolean
  onEnd?: () => void
}) {
  const [editing, setEditing] = useState(startEditing)
  const [text, setText] = useState(name)
  const done = useRef(false)
  if (!editing)
    return (
      <button
        className="state-name"
        onClick={() => {
          done.current = false
          setText(name)
          setEditing(true)
        }}
        title="rename this state, for everyone"
        type="button"
      >
        {name}
      </button>
    )
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const next = text.trim()
    if (save && next !== "" && next !== name) onName(next)
    setEditing(false)
    onEnd?.()
  }
  return (
    <input
      aria-label="the state's name"
      className="state-name-input"
      // biome-ignore lint/a11y/noAutofocus: a field opened by a click is for typing in
      autoFocus
      onBlur={() => finish(true)}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") finish(true)
        else if (e.key === "Escape") {
          e.stopPropagation()
          finish(false)
        }
      }}
      value={text}
    />
  )
}
