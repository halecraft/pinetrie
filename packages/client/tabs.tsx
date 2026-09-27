// client/tabs — the tab bar: Archive, a tab per open root, new tabs, and the
// add tab (ADR-0029).
//
// Which roots have tabs is the same for everyone (every root not archived);
// which tab you are on is yours. A root someone else starts appears here and
// does not take you to it.

import type { WriterId } from "@pineta/core"
import { ROOT_BUSY_REASON } from "@pineta/marginalia"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import type { ActiveTab } from "./layout.ts"
import { Avatars } from "./presence.tsx"

const sameTab = (a: ActiveTab, b: ActiveTab): boolean =>
  a.kind === b.kind &&
  (a.kind !== "root" || b.kind !== "root" || a.root === b.root) &&
  (a.kind !== "new" || b.kind !== "new" || a.key === b.key)

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
  readers,
  nameOf,
  colorOf,
  onShow,
  onCloseNew,
  onArchive,
  onAdd,
}: {
  tabs: readonly ActiveTab[]
  active: ActiveTab
  /** A root tab's label: its first message's text. */
  labelOf: (root: string) => string
  /** A new tab's label, by its key. */
  newLabel: (key: string) => string
  /** Roots in state `archived`. In the bar, only the tab you are on can be one. */
  archived: ReadonlySet<string>
  /** The agent's work in each root (`rootWork`). */
  work: ReadonlyMap<string, "running" | "waiting">
  /** Others reading in each root (`rootReaders`). */
  readers: ReadonlyMap<string, readonly WriterId[]>
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  onShow: (tab: ActiveTab) => void
  onCloseNew: (key: string) => void
  onArchive: (root: string) => void
  onAdd: (asksAgent: boolean) => void
}) {
  const [menu, setMenu] = useState(false)
  // A menu opened on one tab closes when another is shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every change of tab
  useEffect(() => setMenu(false), [active])
  return (
    <nav aria-label="threads" id="tabs">
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
                <Avatars
                  colorOf={colorOf}
                  nameOf={nameOf}
                  writers={readers.get(root) ?? []}
                />
              </button>
              {selected && !archived.has(root) && (
                <span className="tab-more">
                  <button
                    aria-expanded={menu}
                    aria-haspopup="menu"
                    aria-label="more for this thread"
                    className="tab-menu"
                    onClick={() => setMenu(!menu)}
                    type="button"
                  >
                    ⋯
                  </button>
                  {menu && (
                    <div className="menu" role="menu">
                      <button
                        className="archive-root"
                        disabled={busy !== undefined}
                        onClick={() => {
                          setMenu(false)
                          onArchive(root)
                        }}
                        role="menuitem"
                        title="hide for everyone; restore from Archive"
                        type="button"
                      >
                        Archive
                        {busy !== undefined && (
                          <span className="why">
                            {" "}
                            · {ROOT_BUSY_REASON[busy]}
                          </span>
                        )}
                      </button>
                    </div>
                  )}
                </span>
              )}
            </span>
          )
        })}
      </div>
      <AddTab onAdd={onAdd} />
    </nav>
  )
}

/**
 * The add tab: a split button. Agent work is the usual start at the root, so
 * it is the main action; a conversation is in its menu.
 */
function AddTab({ onAdd }: { onAdd: (asksAgent: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) first.current?.focus()
  }, [open])
  const close = () => {
    setOpen(false)
    toggle.current?.focus()
  }
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
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="other ways to start"
        className="add-menu"
        onClick={() => setOpen(!open)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setOpen(true)
          }
        }}
        ref={toggle}
        type="button"
      >
        ▾
      </button>
      {open && (
        <div
          className="menu"
          id={menuId}
          onKeyDown={e => {
            if (e.key === "Escape") {
              e.preventDefault()
              close()
            }
          }}
          role="menu"
        >
          <button
            className="add-conversation"
            onClick={() => {
              setOpen(false)
              onAdd(false)
            }}
            ref={first}
            role="menuitem"
            title="a new conversation: the agent answers only when @agent is mentioned"
            type="button"
          >
            conversation
          </button>
        </div>
      )}
    </span>
  )
}
