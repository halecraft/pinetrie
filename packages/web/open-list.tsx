// web/open-list — your list, down the left edge: the roots you have open,
// in your order, then new tabs, then ＋ (ADR-0030, ADR-0112); full, or folded
// to an icon per item (ADR-0088, `FoldedItem`).
//
// Your list is yours, on every device: × closes a root for you and writes
// nothing shared. Drag an item to reorder; a root dragged here from the
// board opens there. In its ⋯, Rename titles a root for everyone (ADR-0045),
// and Move to ▸ moves it on the board for everyone: to the closed state, it
// is archived. A root someone else
// starts is not added here. An item holding an unsent card of yours carries a
// pip (ADR-0048, `cardMarks`), and before its label, its status (ADR-0077).

import { MAX_TITLE, type TreeIndex, type WriterId } from "@pinetrie/core"
import {
  dropsWords,
  type Intent,
  type ItemIcon,
  type ItemMenuItem,
  type ListWidth,
  listFoldWords,
  listKey,
  type OpenListView,
  planTitle,
  type RootDrag,
  renameIntent,
  renameKey,
  rootDropProps,
  rootGroupProps,
} from "@pinetrie/interface"
import { ROOT_BUSY_REASON } from "@pinetrie/rules"
import type { SessionClient } from "@pinetrie/session"
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { CardPip } from "./card-pip.tsx"
import { slotColor } from "./colors.ts"
import { Menu, type MenuItem } from "./menu.tsx"
import { Readers, type ReadersProps, RootStatus } from "./root-signals.tsx"
import { startRootDrag } from "./use-root-drag.ts"

/** Up and Down move focus between items. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>(".open-root, .open-new"),
  ]
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  const next =
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]
  next?.focus()
}

export function OpenList({
  view,
  width,
  onIntent,
  session,
  index,
  order,
  nameOf,
  colorOf,
  dragOf,
}: {
  /** What the list shows and offers (`openListView`). */
  view: OpenListView
  /** Full, or folded to icons (ADR-0088). */
  width: ListWidth
  onIntent: (intent: Intent) => void
  /** Whose presence an item shows: others reading in its root. */
  session: SessionClient
  index: TreeIndex
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  /** A root's drag, by its root entry, or null when it has no id yet. */
  dragOf: (root: string) => RootDrag | null
}) {
  const pip = <CardPip color={colorOf(session.writer)} />
  // The root whose item is a title field now. Never stored.
  const [renaming, setRenaming] = useState<string | null>(null)
  // The root whose item takes focus once its field has gone.
  const [refocus, setRefocus] = useState<string | null>(null)
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    if (refocus === null) return
    nav.current
      ?.querySelector<HTMLElement>(
        `.open-root[data-root="${CSS.escape(refocus)}"]`,
      )
      ?.focus()
    setRefocus(null)
  }, [refocus])
  // The item you are on, scrolled into the list's view as you choose it.
  const here = view.selected === null ? null : listKey(view.selected)
  useEffect(() => {
    if (here === null) return
    nav.current
      ?.querySelector(".open-item[data-selected]")
      ?.scrollIntoView({ block: "nearest" })
  }, [here])
  const readers = { session, index, order, nameOf, colorOf }
  return (
    <nav aria-label="your threads" id="open-list" ref={nav}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Up and Down move focus between the buttons inside */}
      <div className="open-items" onKeyDown={moveFocus} {...rootGroupProps}>
        {view.items.map(item => {
          const key = listKey(item)
          if (width === "icons")
            return (
              <FoldedItem
                item={item}
                key={key}
                nameOf={nameOf}
                onIntent={onIntent}
                onRename={root => setRenaming(root)}
                pip={pip}
                readers={readers}
                rename={
                  item.kind === "root" && renaming === item.root
                    ? {
                        onEnd: focusItem => {
                          setRenaming(null)
                          if (focusItem) setRefocus(item.root)
                        },
                        onSend: title =>
                          onIntent(renameIntent(item.root, title)),
                      }
                    : null
                }
                startDrag={
                  item.kind === "root"
                    ? startRootDrag(dragOf(item.root))
                    : undefined
                }
              />
            )
          if (item.kind === "new")
            return (
              <span
                className="open-item"
                data-selected={item.selected || undefined}
                key={key}
              >
                <button
                  aria-current={item.selected || undefined}
                  className="open-new"
                  data-new={item.key}
                  onClick={() => onIntent(item.show)}
                  type="button"
                >
                  <span className="open-label">{item.label}</span>
                  {item.pip && pip}
                </button>
                <button
                  aria-label="close this new thread; nothing has been written"
                  className="open-close"
                  onClick={() => onIntent(item.close)}
                  type="button"
                >
                  ×
                </button>
              </span>
            )
          const { root } = item
          if (renaming === root)
            return (
              <span
                className="open-item"
                data-selected={item.selected || undefined}
                key={key}
              >
                <TitleField
                  onEnd={focusItem => {
                    setRenaming(null)
                    if (focusItem) setRefocus(root)
                  }}
                  onSend={title => onIntent(renameIntent(root, title))}
                  placeholder={item.line}
                  stored={item.title}
                />
              </span>
            )
          return (
            <span
              className="open-item"
              data-selected={item.selected || undefined}
              key={key}
              {...rootDropProps({ kind: "list", before: root })}
            >
              <button
                aria-current={item.selected || undefined}
                className={["open-root", item.archived ? "archived" : ""]
                  .filter(c => c !== "")
                  .join(" ")}
                data-root={root}
                draggable
                onDragStart={startRootDrag(dragOf(root))}
                onClick={() => onIntent(item.show)}
                title={item.label}
                type="button"
              >
                <RootStatus
                  arrived={item.arrived}
                  done={item.done}
                  nameOf={nameOf}
                  status={item.status}
                />
                <span className="open-label">{item.label}</span>
                {item.pip && pip}
                <Readers {...readers} roots={[root]} />
              </button>
              {item.menu.length > 0 && (
                <Menu
                  className="open-more"
                  sections={[
                    {
                      key: "root",
                      items: item.menu.map(m =>
                        menuItem(m, () => setRenaming(root), onIntent),
                      ),
                    },
                  ]}
                  label="more for this thread"
                  trigger="⋯"
                  triggerClassName="open-menu"
                />
              )}
              <button
                aria-label="close this thread for you; nothing is written"
                className="open-close"
                onClick={() => onIntent(item.close)}
                title="close for you; open it again from the board"
                type="button"
              >
                ×
              </button>
            </span>
          )
        })}
        <span
          className="open-end"
          {...rootDropProps({ kind: "list", before: null })}
        />
      </div>
      <AddButton
        add={view.add}
        folded={width === "icons"}
        onIntent={onIntent}
      />
      <FoldControl onIntent={onIntent} width={width} />
    </nav>
  )
}

/** At the list's foot: fold it to icons, or show its titles again. */
function FoldControl({
  width,
  onIntent,
}: {
  width: ListWidth
  onIntent: (intent: Intent) => void
}) {
  const words = listFoldWords(width)
  return (
    <button
      aria-label={words.label}
      className="list-fold"
      onClick={() => onIntent({ kind: "foldList" })}
      title={words.title}
      type="button"
    >
      {words.glyph}
    </button>
  )
}

/** An item's picture while the list is folded (`ItemIcon`). */
function IconFace({ icon }: { icon: ItemIcon }) {
  switch (icon.kind) {
    case "sprite":
      return <img alt="" className="open-sprite" src={icon.src} />
    case "initials":
      return (
        <span
          className="open-initials"
          style={{ background: slotColor(icon.slot) }}
        >
          {icon.letters}
        </span>
      )
    case "fresh":
      return <span className="open-fresh" />
  }
}

/**
 * An item of the folded list (ADR-0088): its icon, carrying its status and
 * pip, and a menu a right-click, Shift+F10 or the Menu key opens, which
 * holds ⋯'s items and Close. Hover and focus show its label and who reads
 * there; a rename's field opens beside it. The tooltip and the field are
 * fixed to the window, since the list scrolls and would clip them.
 */
function FoldedItem({
  item,
  onIntent,
  onRename,
  rename,
  startDrag,
  pip,
  readers,
  nameOf,
}: {
  item: OpenListView["items"][number]
  onIntent: (intent: Intent) => void
  onRename: (root: string) => void
  /** While this root is renamed, what its field does; else null. */
  rename: {
    readonly onSend: (title: string | null) => void
    readonly onEnd: (focusItem: boolean) => void
  } | null
  startDrag: ((e: DragEvent<HTMLElement>) => void) | undefined
  pip: ReactNode
  readers: ReadersProps
  nameOf: ReadonlyMap<WriterId, string>
}) {
  const wrap = useRef<HTMLSpanElement>(null)
  // Where the tooltip or the rename field goes: beside the item, measured as
  // either opens.
  const [at, setAt] = useState<DOMRect | null>(null)
  const [tip, setTip] = useState(false)
  const showTip = () => {
    setAt(wrap.current?.getBoundingClientRect() ?? null)
    setTip(true)
  }
  const renaming = rename !== null
  useLayoutEffect(() => {
    if (renaming) setAt(wrap.current?.getBoundingClientRect() ?? null)
  }, [renaming])
  const close: MenuItem = {
    key: "close",
    className: "open-close-item",
    title:
      item.kind === "root"
        ? "close for you; open it again from the board"
        : "close this new thread; nothing has been written",
    label: "Close",
    onChoose: () => onIntent(item.close),
  }
  const items =
    item.kind === "root"
      ? [
          ...item.menu.map(m =>
            menuItem(m, () => onRename(item.root), onIntent),
          ),
          close,
        ]
      : [close]
  const root = item.kind === "root" ? item.root : undefined
  return (
    <span
      className="open-item"
      data-selected={item.selected || undefined}
      ref={wrap}
      {...(root === undefined
        ? {}
        : rootDropProps({ kind: "list", before: root }))}
    >
      <Menu
        className="open-icon-menu"
        label={item.label}
        opensOn="contextmenu"
        sections={[{ key: "item", items }]}
        trigger={
          <span className="open-icon">
            <IconFace icon={item.icon} />
            {item.kind === "root" && (
              <RootStatus
                arrived={item.arrived}
                done={item.done}
                nameOf={nameOf}
                status={item.status}
              />
            )}
            {item.pip && pip}
          </span>
        }
        triggerClassName={
          item.kind === "new"
            ? "open-new"
            : item.archived
              ? "open-root archived"
              : "open-root"
        }
        triggerProps={{
          "aria-current": item.selected || undefined,
          ...(item.kind === "new"
            ? { "data-new": item.key }
            : {
                "data-root": item.root,
                draggable: true,
                onDragStart: startDrag,
              }),
          onBlur: () => setTip(false),
          onClick: () => onIntent(item.show),
          onFocus: showTip,
          onMouseEnter: showTip,
          onMouseLeave: () => setTip(false),
        }}
      />
      {at !== null && tip && rename === null && (
        <span
          className="open-tip"
          role="tooltip"
          style={{ left: at.right + 6, top: at.top }}
        >
          <span className="open-tip-label">{item.label}</span>
          {root !== undefined && <Readers {...readers} roots={[root]} />}
        </span>
      )}
      {at !== null && rename !== null && item.kind === "root" && (
        <span
          className="open-rename"
          style={{ left: at.right + 6, top: at.top }}
        >
          <TitleField
            onEnd={rename.onEnd}
            onSend={rename.onSend}
            placeholder={item.line}
            stored={item.title}
          />
        </span>
      )}
    </span>
  )
}

/** A root's ⋯ item, as the menu draws it. */
function menuItem(
  item: ItemMenuItem,
  rename: () => void,
  onIntent: (intent: Intent) => void,
): MenuItem {
  switch (item.kind) {
    case "notNeeded":
      return {
        key: "not-needed",
        className: "not-needed",
        title: "clear this thread's mark, on every device of yours",
        label: "Not needed",
        onChoose: () => onIntent(item.intent),
      }
    case "rename":
      return {
        key: "rename",
        className: "rename-root",
        title: "change this thread's title for everyone",
        label: "Rename",
        onChoose: rename,
      }
    case "retitle":
      return {
        key: "retitle",
        className: "retitle-root",
        title: "title this thread from what was said in it, for everyone",
        label: "Auto-update title",
        onChoose: () => onIntent(item.intent),
      }
    case "moveTo": {
      const drops = item.busy === null ? dropsWords(item.drops) : null
      return {
        key: `move-to:${item.name}`,
        className: item.closes ? "move-to closes" : "move-to",
        disabled: item.busy !== null,
        title: item.closes
          ? "archive: read-only for everyone until moved out"
          : "move it on the board, for everyone",
        label: (
          <>
            Move to {item.name}
            {item.busy !== null && (
              <span className="why"> · {ROOT_BUSY_REASON[item.busy]}</span>
            )}
            {drops !== null && <span className="why drops"> · {drops}</span>}
          </>
        ),
        onChoose: () => onIntent(item.intent),
      }
    }
  }
}

/**
 * A root's item while it is renamed: a field holding its title. Enter and
 * leaving the field save, and Escape cancels.
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
  /** The field is done; `focusItem` when the keyboard ended it. */
  onEnd: (focusItem: boolean) => void
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
  const finish = (save: boolean, focusItem: boolean) => {
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
    onEnd(focusItem)
  }
  return (
    <input
      aria-invalid={invalid}
      aria-label="title for this thread"
      className="open-title-input"
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
 * ＋: a split button. Agent work is the usual start at the root, so it is
 * the main action; a conversation is in its menu. A board column has its
 * own, which lands the root in that state.
 */
export function AddButton({
  add,
  folded = false,
  onIntent,
}: {
  add: OpenListView["add"]
  /** In a folded list (ADR-0088): ＋ alone, its ▾ under it. */
  folded?: boolean
  onIntent: (intent: Intent) => void
}) {
  return (
    <span className={folded ? "add-root folded" : "add-root"}>
      <button
        aria-label={folded ? "new agent thread" : undefined}
        className="add-agent"
        onClick={() => onIntent(add.agent)}
        title="a new thread where the agent answers every message that names no one"
        type="button"
      >
        {folded ? "＋" : "＋ agent"}
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
