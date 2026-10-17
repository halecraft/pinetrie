// web/board — the board: everyone's roots, each in its workflow state. Its
// strip sits in the footer and says each state's name, count, the people
// reading in its roots, its highest mark, and how many of its roots the agent
// works in and have changes ready to accept, counts that ask nothing of you; ▦
// opens the board over the columns, moving none of them, and ▦, Escape or a
// click outside it closes it. While the board is open, the strip holds the
// board's search and "mine" in the states' place, and each column's head says
// what the state's button did.
//
// Opened, each open state is a column: drag an item to another column, or
// within one, or use its ⋯'s Move to ▸, to move it for everyone. To the archive
// it is archived. An item with a thread whose work is ready to accept carries
// ⇡, for everyone. Selecting an item opens it in your list; dragged onto the
// sidebar, it opens there. A state's name is edited in place, and its ⋯ moves
// or removes it, or adds one beside it. The archive, marked ✓, shows its count
// and its most recent roots. The search and "mine" filter every state in place;
// a banner at the board's foot names the filter, `/` focuses the search, and
// Escape clears the filter before it closes the board. What it shows is
// `boardView`'s.

import type {
  CanvasId,
  EntryId,
  WorkflowStateId,
  WriterId,
} from "@pinetrie/core"
import {
  addStateIntent,
  type BoardSide,
  type BoardView,
  boardKeyAct,
  CLEAR_FILTER,
  type Count,
  canvasesWords,
  clickClosesBoard,
  dragProps,
  dropProps,
  elsewhereWords,
  filterTitle,
  filterWords,
  type Intent,
  keptWords,
  type Level,
  type MessageCount,
  messageCountTitle,
  nameStateIntent,
  noticeKey,
  noticeWords,
  type Reader,
  rootDropProps,
  rootGroupProps,
  type StateSignals,
  type StripState,
  searchWords,
  signalOfLevel,
  stateWords,
  type ThreadCard,
} from "@pinetrie/interface"
import { CANVAS_BUSY_REASON } from "@pinetrie/rules"
import type { CardNotice } from "@pinetrie/session"
import { type RefObject, useEffect, useRef, useState } from "react"
import { AddButton } from "./add-button.tsx"
import { useFocusClaim } from "./focus-claim.ts"
import { Menu, type MenuItem } from "./menu.tsx"
import { ReaderMenus, Readers, type ReadersProps } from "./root-signals.tsx"
import { SignalMark } from "./signal-mark.tsx"
import { isTextBox } from "./text-box.ts"
import { ThreadHead } from "./thread-card.tsx"

/**
 * The strip: ▦, then, while the board is closed, each state's name, count,
 * readers, mark, ◌ and ⇡; while it is open, the board's search and "mine" in
 * their place. ▦ carries ⌕ while a filter is on and the board is closed, so a
 * filter kept across closing is not missed.
 */
export function BoardStrip({
  view,
  open,
  onIntent,
  count,
  elsewhere,
  pip,
  readers,
  query,
  onQuery,
  mine,
  onMine,
  searchRef,
}: {
  view: BoardView | null
  open: boolean
  onIntent: (intent: Intent) => void
  /** The session's message count: ▦'s title and `data-messages`. */
  count: MessageCount
  /** The highest a root not in the sidebar raises (`markLevel`). */
  elsewhere: Level | null
  /** A root not in the sidebar holds an unsent card of yours. */
  pip: React.ReactNode | null
  readers: ReadersProps
  /** What is typed in the board's search, and its "mine": never stored. */
  query: string
  onQuery: (query: string) => void
  mine: boolean
  onMine: (mine: boolean) => void
  /** The search field, which `Board` focuses on `/`. */
  searchRef: RefObject<HTMLInputElement | null>
}) {
  const shown = view?.shown ?? null
  const filter = shown?.kind === "filtered" ? shown.search : null
  const toggle = () =>
    onIntent(
      open
        ? { kind: "board", open: false }
        : { kind: "board", open: true, focus: true },
    )
  return (
    <div className="board-strip">
      <button
        aria-expanded={open}
        className="board-toggle"
        data-messages={count.total}
        onClick={toggle}
        title={
          filter !== null && !open
            ? `${messageCountTitle(count)} · ${filterTitle(filter)}`
            : messageCountTitle(count)
        }
        type="button"
      >
        <span aria-hidden className="glyph">
          ▦
        </span>{" "}
        Board
        {elsewhere !== null && (
          <SignalMark
            signal={signalOfLevel(elsewhere)}
            title={elsewhereWords(elsewhere)}
          />
        )}
        {filter !== null && !open && (
          <span
            aria-label={filterTitle(filter)}
            className="board-filtered"
            role="img"
          >
            ⌕
          </span>
        )}
        {pip}
      </button>
      {open ? (
        <StripSearch
          filtered={filter !== null}
          mine={mine}
          onMine={onMine}
          onQuery={onQuery}
          placeholder={searchWords(shown?.total ?? 0)}
          query={query}
          searchRef={searchRef}
        />
      ) : (
        view?.strip.map(s => (
          <StripStateButton
            key={s.id}
            onOpen={() => onIntent({ kind: "board", open: true, focus: true })}
            readers={readers}
            state={s}
          />
        ))
      )}
    </div>
  )
}

/**
 * The board's search in the strip: the field, its × (which clears only what
 * is typed), and "mine".
 */
function StripSearch({
  query,
  onQuery,
  mine,
  onMine,
  filtered,
  placeholder,
  searchRef,
}: {
  query: string
  onQuery: (query: string) => void
  mine: boolean
  onMine: (mine: boolean) => void
  /** A filter is on: the field is outlined in the board's blue. */
  filtered: boolean
  placeholder: string
  searchRef: RefObject<HTMLInputElement | null>
}) {
  const claim = useFocusClaim()
  // Claimed as it mounts: armed when a person opens the board.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the board opens
  useEffect(() => {
    if (claim({ kind: "board" })) searchRef.current?.focus()
  }, [])
  return (
    <>
      <span className="board-search-box">
        <input
          aria-label="search the board"
          className="board-search"
          data-filtered={filtered || undefined}
          onChange={e => onQuery(e.target.value)}
          placeholder={placeholder}
          ref={searchRef}
          value={query}
        />
        {query !== "" && (
          <button
            aria-label="clear the search"
            className="board-search-clear"
            onClick={() => {
              onQuery("")
              searchRef.current?.focus()
            }}
            type="button"
          >
            ×
          </button>
        )}
      </span>
      <label className="board-mine">
        <input
          checked={mine}
          onChange={e => onMine(e.target.checked)}
          type="checkbox"
        />{" "}
        mine
      </label>
    </>
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
      data-archive={state.archive || undefined}
      data-state={state.id}
      onClick={onOpen}
      type="button"
      // A card dropped on an open state becomes a thread there.
      {...(state.archive ? {} : dropProps({ kind: "state", state: state.id }))}
    >
      <span className="strip-name">{state.name}</span>{" "}
      <b className="strip-count">{state.count}</b>
      <StateSignalMarks
        mark={state.mark}
        readers={readers}
        signals={state.signals}
      />
    </button>
  )
}

/**
 * A state's readers' avatars, highest mark, ◌ and ⇡: in the strip over
 * every root in it, in a column's head over the roots shown, with the mark
 * over every root in both.
 */
function StateSignalMarks({
  signals,
  mark,
  readers,
}: {
  signals: StateSignals
  mark: Level | null
  readers: ReadersProps
}) {
  const words = stateWords(signals)
  return (
    <>
      {signals.canvases.length > 0 && (
        <Readers {...readers} canvases={signals.canvases} />
      )}
      {mark !== null && <SignalMark signal={signalOfLevel(mark)} />}
      {signals.working > 0 && (
        <span className="state-working" title={words.working}>
          ◌{signals.working}
        </span>
      )}
      {signals.ready > 0 && (
        <span className="state-ready" title={words.ready}>
          ⇡{signals.ready}
        </span>
      )}
    </>
  )
}

/** The board, open over the columns. */
export function Board({
  view,
  onIntent,
  onClearFilter,
  searchRef,
  readers,
  thread,
  pip,
  notices,
  reader,
}: {
  view: BoardView
  onIntent: (intent: Intent) => void
  /** Lift the whole filter: its words and "mine". */
  onClearFilter: () => void
  /** The search field in the strip, which `/` focuses. */
  searchRef: RefObject<HTMLInputElement | null>
  readers: ReadersProps
  /** A thread as a row of a reader's menu, which opens it. */
  thread: (end: EntryId, canvas: CanvasId) => MenuItem | null
  pip: React.ReactNode
  /** Your refused moves on the board, said above its states. */
  notices: readonly CardNotice[]
  reader: Reader
}) {
  // The board's keys are `boardKeyAct`'s: Escape closes the board, as ▦
  // does, once a menu open on it (`Popover`) and then a filter have taken
  // theirs. A click outside it closes it too (`clickClosesBoard`). Both ends
  // of a click are read in the capture phase, before what was clicked can
  // take itself out of the page.
  const self = useRef<HTMLElement>(null)
  const filtered = view.shown.kind === "filtered"
  useEffect(() => {
    const close = () => onIntent({ kind: "board", open: false })
    const onKey = (e: KeyboardEvent) => {
      const act = boardKeyAct(e, {
        menuOpen: self.current?.querySelector(".open") != null,
        filtered,
        inText: isTextBox(document.activeElement),
      })
      if (act === "focusSearch") {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (act === "clearFilter") onClearFilter()
      else if (act === "close") close()
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
  }, [onIntent, onClearFilter, filtered, searchRef])
  // A state being added: its name field stands where it will go.
  const [adding, setAdding] = useState<{
    before: WorkflowStateId | null
  } | null>(null)
  const newState = (before: WorkflowStateId | null) =>
    adding !== null && adding.before === before ? (
      <div className="board-column board-new-state" key="new-state">
        <div className="board-head">
          <StateName
            editing
            name=""
            onEnd={() => setAdding(null)}
            onName={name => onIntent(addStateIntent(before, name))}
          />
        </div>
      </div>
    ) : null
  // An open column's item is a place to drop before; an archive row is not,
  // since the archive shows its canvases by activity, not by place.
  const item = (t: ThreadCard, place: boolean) => (
    <ItemCard
      drop={
        place
          ? rootDropProps({ kind: "state", state: t.state, before: t.canvas })
          : {}
      }
      item={t}
      key={t.canvas}
      onIntent={onIntent}
      pip={pip}
      readers={readers}
      thread={thread}
    />
  )
  const stateCount = (count: Count) => (
    <span
      className="board-count"
      data-kept={count.kind === "kept" || undefined}
      title={canvasesWords(count.total)}
    >
      {keptWords(count)}
    </span>
  )
  return (
    <section aria-label="board" className="board" id="board" ref={self}>
      {notices.map(r => (
        <div className="refused-move" key={noticeKey(r)}>
          {noticeWords(r, reader)}
        </div>
      ))}
      <div className="board-states">
        {view.open.map(column => [
          newState(column.state.id),
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
            {...dropProps({ kind: "state", state: column.state.id })}
          >
            <div className="board-head">
              <StateName
                name={column.state.name}
                onName={name =>
                  onIntent(nameStateIntent(column.state.id, name))
                }
              />
              {stateCount(column.count)}
              <StateSignalMarks
                mark={column.mark}
                readers={readers}
                signals={column.signals}
              />
              <Menu
                className="state-more"
                label={`more for ${column.state.name}`}
                sections={[
                  {
                    key: "add",
                    items: [
                      addItem("left", column.addBefore.left, setAdding),
                      addItem("right", column.addBefore.right, setAdding),
                    ],
                  },
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
                              <span className="why">
                                {" "}
                                · {column.remove.why}
                              </span>
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
            <div className="board-cards">
              {column.items.map(t => item(t, true))}
            </div>
            <AddButton add={column.add} onIntent={onIntent} />
          </div>,
        ])}
        {newState(null)}
        <div
          className="board-archive"
          data-state={view.archive.state.id}
          {...rootGroupProps}
          {...rootDropProps({
            kind: "state",
            state: view.archive.state.id,
            before: null,
          })}
        >
          <div className="board-head">
            <span aria-hidden className="archive-mark">
              ✓
            </span>
            <StateName
              name={view.archive.state.name}
              onName={name =>
                onIntent(nameStateIntent(view.archive.state.id, name))
              }
            />
            {stateCount(view.archive.count)}
          </div>
          <div className="board-cards">
            {view.archive.rows.map(t => item(t, false))}
          </div>
        </div>
      </div>
      {view.shown.kind === "filtered" && (
        // At the board's foot: the board grows up from the footer, so its
        // foot holds still as a filter shrinks it.
        <div className="board-filter" role="status">
          <span className="board-filter-words">{filterWords(view.shown)}</span>
          <button
            className="board-filter-clear"
            onClick={onClearFilter}
            type="button"
          >
            {CLEAR_FILTER}
          </button>
        </div>
      )}
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

const addItem = (
  side: "left" | "right",
  before: WorkflowStateId | null,
  setAdding: (adding: { before: WorkflowStateId | null }) => void,
): MenuItem => ({
  key: `add-${side}`,
  className: `add-state-${side}`,
  title: `add a workflow state ${side} of this one, for everyone`,
  label: side === "left" ? "Add state left" : "Add state right",
  onChoose: () => setAdding({ before }),
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
  item: ThreadCard
  /** Its drop zone's attributes (`rootDropProps`), or none. */
  drop: Readonly<Record<string, string>>
  onIntent: (intent: Intent) => void
  readers: ReadersProps
  thread: (end: EntryId, canvas: CanvasId) => MenuItem | null
  pip: React.ReactNode
}) {
  return (
    <div className="thread-card" data-canvas={item.canvas} {...drop}>
      <button
        className="board-open"
        {...dragProps({
          kind: "canvas",
          drag: { canvas: item.canvas, state: item.state },
        })}
        onClick={() => onIntent(item.show)}
        title={item.label}
        type="button"
      >
        <ThreadHead
          head={item.head}
          labelClass="board-label"
          nameOf={readers.nameOf}
          pip={pip}
        />
      </button>
      {item.body !== null && <span className="board-body">{item.body}</span>}
      <span className="board-meta">
        <Writers nameOf={readers.nameOf} writers={item.writers} />
        <ReaderMenus {...readers} canvas={item.canvas} thread={thread} />
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
                    <span className="why"> · {CANVAS_BUSY_REASON[m.busy]}</span>
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
