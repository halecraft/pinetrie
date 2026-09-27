// client/tabs — the tab bar: Archive, your open roots, new tabs, and the add
// tab (ADR-0029, ADR-0030).
//
// Your tabs are yours: the roots you have opened, in that order. × closes one
// for you and writes nothing; Archive, in its ⋯, hides a root for everyone. A
// root someone else starts opens no tab here.

import type { WriterId } from "@pineta/core"
import { ROOT_BUSY_REASON } from "@pineta/marginalia"
import type { KeyboardEvent } from "react"
import { type ActiveTab, sameTab } from "./layout.ts"
import { Menu } from "./menu.tsx"
import { Avatars } from "./presence.tsx"

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
  onCloseRoot,
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
  /** Others reading in each root (`readersByRoot`). */
  readers: ReadonlyMap<string, readonly WriterId[]>
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  onShow: (tab: ActiveTab) => void
  onCloseNew: (key: string) => void
  /** Close a root's tab for you: nothing is written (ADR-0030). */
  onCloseRoot: (root: string) => void
  onArchive: (root: string) => void
  onAdd: (asksAgent: boolean) => void
}) {
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
              {/* On every root tab: shown on the one you are on, and on
                  another on hover or focus, so any root can be archived. */}
              {!archived.has(root) && (
                <Menu
                  className="tab-more"
                  items={[
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
