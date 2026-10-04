// client/tabs — the tab bar: Archive, your open roots, new tabs, and the add
// tab (ADR-0029, ADR-0030).
//
// Your tabs are yours: the roots you have opened, in that order. × closes one
// for you and writes nothing. In its ⋯, Rename titles a root for everyone
// (ADR-0045), and Archive hides it for everyone. A root someone else starts
// opens no tab here. A tab holding an unsent card of yours carries a pip, and so
// does Archive when such a root has no tab here (ADR-0048, `cardMarks`).

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
import { CardPip } from "./card-pip.tsx"
import { peopleHere, readersByRoot } from "./here.ts"
import type { Intent } from "./intent.ts"
import { Menu } from "./menu.tsx"
import { Avatars } from "./presence.tsx"
import { planTitle, renameKey } from "./root-label.ts"
import type { SessionClient } from "./session-view.ts"
import { dropsWords, renameIntent, type TabsView } from "./tabs-view.ts"
import { useReadingAt, useReadingRoots } from "./use-presence.ts"

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
  view,
  onIntent,
  session,
  index,
  order,
  nameOf,
  colorOf,
}: {
  /** What the bar shows and offers (`tabsView`). */
  view: TabsView
  onIntent: (intent: Intent) => void
  /** Whose presence a root tab shows: others reading in it. */
  session: SessionClient
  index: TreeIndex
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
}) {
  const pip = <CardPip color={colorOf(session.writer)} />
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
        {view.tabs.map(tab => {
          if (tab.kind === "archive")
            return (
              <button
                aria-selected={tab.selected}
                className="tab tab-archive"
                data-tab="archive"
                key="archive"
                onClick={() => onIntent(tab.show)}
                role="tab"
                tabIndex={tab.selected ? 0 : -1}
                type="button"
              >
                Archive
                {tab.pip && pip}
              </button>
            )
          if (tab.kind === "new")
            return (
              <span className="tab-wrap" key={`new:${tab.key}`}>
                <button
                  aria-selected={tab.selected}
                  className="tab tab-new"
                  data-new={tab.key}
                  onClick={() => onIntent(tab.show)}
                  role="tab"
                  tabIndex={tab.selected ? 0 : -1}
                  type="button"
                >
                  {tab.label}
                  {tab.pip && pip}
                </button>
                <button
                  aria-label="close this new thread; nothing has been written"
                  className="tab-close"
                  onClick={() => onIntent(tab.close)}
                  type="button"
                >
                  ×
                </button>
              </span>
            )
          const { root } = tab
          if (renaming === root)
            return (
              <span className="tab-wrap" key={`root:${root}`}>
                <TitleField
                  onEnd={focusTab => {
                    setRenaming(null)
                    if (focusTab) setRefocus(root)
                  }}
                  onSend={title => onIntent(renameIntent(root, title))}
                  placeholder={tab.line}
                  stored={tab.title}
                />
              </span>
            )
          return (
            <span className="tab-wrap" key={`root:${root}`}>
              <button
                aria-selected={tab.selected}
                className={[
                  "tab",
                  "tab-root",
                  tab.running ? "running" : "",
                  tab.archived ? "archived" : "",
                ]
                  .filter(c => c !== "")
                  .join(" ")}
                data-root={root}
                onClick={() => onIntent(tab.show)}
                role="tab"
                tabIndex={tab.selected ? 0 : -1}
                title={tab.label}
                type="button"
              >
                <span className="tab-label">{tab.label}</span>
                {tab.pip && pip}
                <Readers
                  colorOf={colorOf}
                  index={index}
                  nameOf={nameOf}
                  order={order}
                  root={root}
                  session={session}
                />
              </button>
              {/* Shown on the tab you are on, and on another on hover or
                  focus, so any root can be renamed or archived. */}
              {tab.menu.length > 0 && (
                <Menu
                  className="tab-more"
                  sections={[
                    {
                      key: "root",
                      items: tab.menu.map(item =>
                        item.kind === "rename"
                          ? {
                              key: "rename",
                              className: "rename-root",
                              title: "change this thread's title for everyone",
                              label: "Rename",
                              onChoose: () => setRenaming(root),
                            }
                          : item.kind === "retitle"
                            ? {
                                key: "retitle",
                                className: "retitle-root",
                                title:
                                  "title this thread from what was said in it, for everyone",
                                label: "Auto-update title",
                                onChoose: () => onIntent(item.intent),
                              }
                            : {
                                key: "archive",
                                className: "archive-root",
                                disabled: item.busy !== null,
                                title:
                                  "hide for everyone; restore from Archive",
                                label: (
                                  <>
                                    Archive
                                    {item.busy !== null && (
                                      <span className="why">
                                        {" "}
                                        · {ROOT_BUSY_REASON[item.busy]}
                                      </span>
                                    )}
                                    {item.busy === null &&
                                      dropsWords(item.drops) !== null && (
                                        <span className="why drops">
                                          {" "}
                                          · {dropsWords(item.drops)}
                                        </span>
                                      )}
                                  </>
                                ),
                                onChoose: () => onIntent(item.intent),
                              },
                      ),
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
                onClick={() => onIntent(tab.close)}
                title="close for you; reopen from Archive"
                type="button"
              >
                ×
              </button>
            </span>
          )
        })}
      </div>
      <AddTab add={view.add} onIntent={onIntent} />
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
        const step = renameKey(e.key)
        if (step === null) return
        e.preventDefault()
        finish(step.save, step.refocus)
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
  const reportedRoots = useReadingRoots(p.session.presence)
  const { index, order, root } = p
  const writers = useMemo(
    () =>
      readersByRoot(peopleHere(reading, index, order, reportedRoots)).get(
        root,
      ) ?? [],
    [reading, index, order, root, reportedRoots],
  )
  return <Avatars colorOf={p.colorOf} nameOf={p.nameOf} writers={writers} />
}

/**
 * The add tab: a split button. Agent work is the usual start at the root, so
 * it is the main action; a conversation is in its menu.
 */
function AddTab({
  add,
  onIntent,
}: {
  add: TabsView["add"]
  onIntent: (intent: Intent) => void
}) {
  return (
    <span className="add-tab">
      <button
        className="add-agent"
        onClick={() => onIntent(add.agent)}
        title="a new thread where the agent answers every message that names no one"
        type="button"
      >
        ＋ agent
      </button>
      <Menu
        className="add-more"
        sections={[
          {
            key: "add",
            items: [
              {
                key: "conversation",
                className: "add-conversation",
                title:
                  "a new conversation: the agent answers only when @agent is mentioned",
                label: "conversation",
                onChoose: () => onIntent(add.conversation),
              },
            ],
          },
        ]}
        label="other ways to start"
        trigger="▾"
        triggerClassName="add-menu"
      />
    </span>
  )
}
