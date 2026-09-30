// client/tabs — the tab bar: Archive, your open roots, new tabs, and the add
// tab (ADR-0029, ADR-0030).
//
// Your tabs are yours: the roots you have opened, in that order. × closes one
// for you and writes nothing. In its ⋯, Rename titles a root for everyone
// (ADR-0045), and Archive hides it for everyone. A root someone else starts
// opens no tab here.

import { MAX_TITLE, type TreeIndex, type WriterId } from "@pineta/core"
import { ROOT_BUSY_REASON } from "@pineta/marginalia"
import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { peopleHere, readersByRoot } from "./here.ts"
import { type ActiveTab, sameTab } from "./layout.ts"
import { Menu } from "./menu.tsx"
import { Avatars } from "./presence.tsx"
import { planTitle } from "./root-label.ts"
import type { SessionClient } from "./session-view.ts"
import { useReadingAt } from "./use-presence.ts"

/** Left and Right move focus between tabs. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
  const tabs = [
    ...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  ]
  const at = tabs.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  const next =
    tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
  next?.focus()
}

export function TabBar({
  tabs,
  active,
  labelOf,
  newLabel,
  archived,
  work,
  session,
  index,
  order,
  nameOf,
  colorOf,
  onShow,
  onCloseNew,
  onCloseRoot,
  onArchive,
  lineOf,
  titleOf,
  onRename,
  onAdd,
}: {
  tabs: readonly ActiveTab[]
  active: ActiveTab
  /** A root tab's label: its title, else its first message's first line. */
  labelOf: (root: string) => string
  /** A new tab's label, by its key. */
  newLabel: (key: string) => string
  /** Roots in state `archived`. In the bar, only the tab you are on can be one. */
  archived: ReadonlySet<string>
  /** The agent's work in each root (`rootWork`). */
  work: ReadonlyMap<string, "running" | "waiting">
  /** Whose presence a root tab shows: others reading in it. */
  session: SessionClient
  index: TreeIndex
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  onShow: (tab: ActiveTab) => void
  onCloseNew: (key: string) => void
  /** Close a root's tab for you: nothing is written (ADR-0030). */
  onCloseRoot: (root: string) => void
  onArchive: (root: string) => void
  /** A root's first line: its label with no title, and the rename field's placeholder. */
  lineOf: (root: string) => string
  /** A root's stored title, or null when it has none. */
  titleOf: (root: string) => string | null
  /** Set a root's title for everyone, or clear it with null (ADR-0045). */
  onRename: (root: string, title: string | null) => void
  onAdd: (asksAgent: boolean) => void
}) {
  // The root whose tab is a title field now. Never stored.
  const [renaming, setRenaming] = useState<string | null>(null)
  // The root whose tab takes focus once its field has gone.
  const [refocus, setRefocus] = useState<string | null>(null)
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    if (refocus === null) return
    nav.current
      ?.querySelector<HTMLElement>(`.tab[data-root="${CSS.escape(refocus)}"]`)
      ?.focus()
    setRefocus(null)
  }, [refocus])
  return (
    <nav aria-label="threads" id="tabs" ref={nav}>
      <div
        aria-label="threads"
        className="tab-list"
        onKeyDown={moveFocus}
        role="tablist"
      >
        {tabs.map(tab => {
          const selected = sameTab(tab, active)
          if (tab.kind === "archive")
            return (
              <button
                aria-selected={selected}
                className="tab tab-archive"
                data-tab="archive"
                key="archive"
                onClick={() => onShow(tab)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                Archive
              </button>
            )
          if (tab.kind === "new")
            return (
              <span className="tab-wrap" key={`new:${tab.key}`}>
                <button
                  aria-selected={selected}
                  className="tab tab-new"
                  data-new={tab.key}
                  onClick={() => onShow(tab)}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {newLabel(tab.key)}
                </button>
                <button
                  aria-label="close this new thread; nothing has been written"
                  className="tab-close"
                  onClick={() => onCloseNew(tab.key)}
                  type="button"
                >
                  ×
                </button>
              </span>
            )
          const { root } = tab
          const busy = work.get(root)
          if (renaming === root)
            return (
              <span className="tab-wrap" key={`root:${root}`}>
                <TitleField
                  onEnd={focusTab => {
                    setRenaming(null)
                    if (focusTab) setRefocus(root)
                  }}
                  onSend={title => onRename(root, title)}
                  placeholder={lineOf(root)}
                  stored={titleOf(root)}
                />
              </span>
            )
          return (
            <span className="tab-wrap" key={`root:${root}`}>
              <button
                aria-selected={selected}
                className={[
                  "tab",
                  "tab-root",
                  busy === "running" ? "running" : "",
                  archived.has(root) ? "archived" : "",
                ]
                  .filter(c => c !== "")
                  .join(" ")}
                data-root={root}
                onClick={() => onShow(tab)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                title={labelOf(root)}
                type="button"
              >
                <span className="tab-label">{labelOf(root)}</span>
                <Readers
                  colorOf={colorOf}
                  index={index}
                  nameOf={nameOf}
                  order={order}
                  root={root}
                  session={session}
                />
              </button>
              {/* On every root tab: shown on the one you are on, and on
                  another on hover or focus, so any root can be renamed or
                  archived. */}
              {!archived.has(root) && (
                <Menu
                  className="tab-more"
                  items={[
                    {
                      key: "rename",
                      className: "rename-root",
                      title: "change this thread's title for everyone",
                      label: "Rename",
                      onChoose: () => setRenaming(root),
                    },
                    {
                      key: "archive",
                      className: "archive-root",
                      disabled: busy !== undefined,
                      title: "hide for everyone; restore from Archive",
                      label: (
                        <>
                          Archive
                          {busy !== undefined && (
                            <span className="why">
                              {" "}
                              · {ROOT_BUSY_REASON[busy]}
                            </span>
                          )}
                        </>
                      ),
                      onChoose: () => onArchive(root),
                    },
                  ]}
                  label="more for this thread"
                  trigger="⋯"
                  triggerClassName="tab-menu"
                />
              )}
              <button
                aria-label="close this thread for you; nothing is written"
                className="tab-close"
                onClick={() => onCloseRoot(root)}
                title="close for you; reopen from Archive"
                type="button"
              >
                ×
              </button>
            </span>
          )
        })}
      </div>
      <AddTab onAdd={onAdd} />
    </nav>
  )
}

/**
 * A root tab while it is renamed: a field holding its title. Enter and leaving
 * the field save, and Escape cancels.
 */
function TitleField({
  stored,
  placeholder,
  onSend,
  onEnd,
}: {
  stored: string | null
  placeholder: string
  onSend: (title: string | null) => void
  /** The field is done; `focusTab` when the keyboard ended it. */
  onEnd: (focusTab: boolean) => void
}) {
  const [text, setText] = useState(stored ?? "")
  const [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // Every way out comes here once. Removing a focused field can fire a blur
  // after Enter or Escape, which must not save again, or save a cancel.
  const done = useRef(false)
  useLayoutEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const finish = (save: boolean, focusTab: boolean) => {
    if (done.current) return
    if (save) {
      const plan = planTitle(text, stored)
      if (plan.kind === "refuse") {
        setInvalid(true)
        return
      }
      if (plan.kind === "send") onSend(plan.title)
    }
    done.current = true
    onEnd(focusTab)
  }
  return (
    <input
      aria-invalid={invalid}
      aria-label="title for this thread"
      className="tab-title-input"
      maxLength={MAX_TITLE}
      onBlur={() => finish(true, false)}
      onChange={e => {
        setText(e.target.value)
        setInvalid(false)
      }}
      onKeyDown={e => {
        if (e.key === "Enter") {
          e.preventDefault()
          finish(true, true)
        } else if (e.key === "Escape") {
          e.preventDefault()
          finish(false, true)
        }
      }}
      placeholder={placeholder}
      ref={input}
      value={text}
    />
  )
}

/**
 * Others reading in `root`, on its tab. It reads presence itself, so a
 * presence write redraws this and not the tab bar.
 */
function Readers(p: {
  session: SessionClient
  index: TreeIndex
  order: readonly WriterId[]
  root: string
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}) {
  const reading = useReadingAt(p.session.presence, p.session.writer)
  const { index, order, root } = p
  const writers = useMemo(
    () => readersByRoot(peopleHere(reading, index, order)).get(root) ?? [],
    [reading, index, order, root],
  )
  return <Avatars colorOf={p.colorOf} nameOf={p.nameOf} writers={writers} />
}

/**
 * The add tab: a split button. Agent work is the usual start at the root, so
 * it is the main action; a conversation is in its menu.
 */
function AddTab({ onAdd }: { onAdd: (asksAgent: boolean) => void }) {
  return (
    <span className="add-tab">
      <button
        className="add-agent"
        onClick={() => onAdd(true)}
        title="a new thread where the agent answers every message that names no one"
        type="button"
      >
        ＋ agent
      </button>
      <Menu
        className="add-more"
        items={[
          {
            key: "conversation",
            className: "add-conversation",
            title:
              "a new conversation: the agent answers only when @agent is mentioned",
            label: "conversation",
            onChoose: () => onAdd(false),
          },
        ]}
        label="other ways to start"
        trigger="▾"
        triggerClassName="add-menu"
      />
    </span>
  )
}
