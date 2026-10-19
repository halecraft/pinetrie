// web/sidebar — the sidebar, down the left edge: the roots you have open, in
// your order, then ＋; full, or folded to an icon per item (`FoldedItem`).
//
// The sidebar is yours, on every device: × closes a root for you and writes
// nothing shared. Drag an item to reorder; a root dragged here from the board
// opens there. In its ⋯, Rename titles a root for everyone, and Move to ▸ moves
// it on the board for everyone: to the archive, it is archived. A root someone
// else starts is not added here. An item holding an unsent card of yours
// carries a pip (`unsentSignals`), and before its label, its status.

import type { CanvasId, ThreadId, TreeIndex, WriterId } from "@pinetrie/core"
import {
  dragProps,
  dropProps,
  dropsWords,
  type Intent,
  type ItemIcon,
  type ItemMenuItem,
  type ListWidth,
  listFoldWords,
  listKey,
  moveTitle,
  NOT_NEEDED,
  type RootDrag,
  renameIntent,
  rootDropProps,
  rootGroupProps,
  SIDEBAR_WORDS,
  type SidebarView,
} from "@pinetrie/interface"
import { CANVAS_BUSY_REASON } from "@pinetrie/rules"
import type { SessionClient } from "@pinetrie/session"
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { AddButton } from "./add-button.tsx"
import { slotColor } from "./colors.ts"
import { Menu, type MenuItem } from "./menu.tsx"
import { Readers, type ReadersProps, RootStatus } from "./root-signals.tsx"
import { SignalMark } from "./signal-mark.tsx"
import { ThreadHead } from "./thread-card.tsx"
import { ThreadIconImage } from "./thread-icon-image.tsx"
import { TitleField } from "./title-field.tsx"

/** Up and Down move focus between items. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(".open-root")]
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  e.preventDefault()
  const next =
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]
  next?.focus()
}

export function Sidebar({
  view,
  width,
  onIntent,
  session,
  index,
  canvasOfThread,
  order,
  nameOf,
  colorOf,
  dragOf,
}: {
  /** What the list shows and offers (`sidebarView`). */
  view: SidebarView
  /** Full, or folded to icons. */
  width: ListWidth
  onIntent: (intent: Intent) => void
  /** Whose presence an item shows: others reading in its canvas. */
  session: SessionClient
  index: TreeIndex
  canvasOfThread: ReadonlyMap<ThreadId, CanvasId>
  /** Everyone, in the order every window agrees on (`writerOrder`). */
  order: readonly WriterId[]
  nameOf: ReadonlyMap<WriterId, string>
  colorOf: (writer: WriterId) => string
  /** A canvas's drag. */
  dragOf: (canvas: CanvasId) => RootDrag
}) {
  const pip = <SignalMark color={colorOf(session.writer)} signal="unsent" />
  // The canvas whose item is a title field now. Never stored.
  const [renaming, setRenaming] = useState<CanvasId | null>(null)
  // The canvas whose item takes focus once its field has gone.
  const [refocus, setRefocus] = useState<CanvasId | null>(null)
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    if (refocus === null) return
    nav.current
      ?.querySelector<HTMLElement>(
        `.open-root[data-canvas="${CSS.escape(refocus)}"]`,
      )
      ?.focus()
    setRefocus(null)
  }, [refocus])
  // The item you are on, scrolled into the list's view as you choose it.
  const here = view.selected === null ? null : listKey(view.selected)
  useEffect(() => {
    if (here === null) return
    nav.current
      ?.querySelector(".sidebar-item[data-selected]")
      ?.scrollIntoView({ block: "nearest" })
  }, [here])
  const readers = { session, index, canvasOfThread, order, nameOf, colorOf }
  return (
    <nav aria-label={SIDEBAR_WORDS.list} id="sidebar" ref={nav}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Up and Down move focus between the buttons inside */}
      <div className="sidebar-items" onKeyDown={moveFocus} {...rootGroupProps}>
        {view.items.map(item => {
          const key = listKey(item)
          if (width === "icons")
            return (
              <FoldedItem
                item={item}
                key={key}
                nameOf={nameOf}
                onIntent={onIntent}
                onRename={canvas => setRenaming(canvas)}
                pip={pip}
                readers={readers}
                rename={
                  renaming === item.canvas
                    ? {
                        onEnd: focusItem => {
                          setRenaming(null)
                          if (focusItem) setRefocus(item.canvas)
                        },
                        onSend: title =>
                          onIntent(renameIntent(item.canvas, title)),
                      }
                    : null
                }
                drag={dragProps({ kind: "canvas", drag: dragOf(item.canvas) })}
              />
            )
          const { canvas } = item
          if (renaming === canvas)
            return (
              <span
                className="sidebar-item"
                data-selected={item.selected || undefined}
                key={key}
              >
                <TitleField
                  onEnd={focusItem => {
                    setRenaming(null)
                    if (focusItem) setRefocus(canvas)
                  }}
                  onSend={title => onIntent(renameIntent(canvas, title))}
                  placeholder={item.line}
                  stored={item.title}
                />
              </span>
            )
          return (
            <span
              className="sidebar-item"
              data-selected={item.selected || undefined}
              key={key}
              {...rootDropProps({ kind: "list", before: canvas })}
              {...dropProps({ kind: "sidebar", before: canvas })}
            >
              <button
                aria-current={item.selected || undefined}
                className={["open-root", item.archived ? "archived" : ""]
                  .filter(c => c !== "")
                  .join(" ")}
                data-canvas={canvas}
                {...dragProps({ kind: "canvas", drag: dragOf(canvas) })}
                onClick={() => onIntent(item.show)}
                title={item.hover}
                type="button"
              >
                <ThreadHead
                  arrived={item.arrived}
                  done={item.done}
                  head={item.head}
                  labelClass="open-label"
                  nameOf={nameOf}
                  pip={pip}
                />
                <Readers {...readers} canvases={[item.canvas]} />
              </button>
              {item.menu.length > 0 && (
                <Menu
                  className="open-more"
                  sections={[
                    {
                      key: "root",
                      items: item.menu.map(m =>
                        menuItem(m, () => setRenaming(canvas), onIntent),
                      ),
                    },
                  ]}
                  label={SIDEBAR_WORDS.menu}
                  trigger="⋯"
                  triggerClassName="open-menu"
                />
              )}
              <button
                aria-label={SIDEBAR_WORDS.close}
                className="open-close"
                onClick={() => onIntent(item.close)}
                title={SIDEBAR_WORDS.closeTitle}
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
          {...dropProps({ kind: "sidebar", before: null })}
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
      onClick={() => onIntent({ kind: "fold-list" })}
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
    case "icon":
      return <ThreadIconImage className="open-sprite" icon={icon.icon} />
    case "initials":
      return (
        <span
          className="open-initials"
          style={{ background: slotColor(icon.slot) }}
        >
          {icon.letters}
        </span>
      )
  }
}

/**
 * An item of the folded list: its icon, carrying its status and pip, and a menu
 * a right-click, Shift+F10 or the Menu key opens, which holds ⋯'s items and
 * Close. Hover and focus show its label and who reads there; a rename's field
 * opens beside it. The tooltip and the field are fixed to the window, since the
 * list scrolls and would clip them.
 */
function FoldedItem({
  item,
  onIntent,
  onRename,
  rename,
  drag,
  pip,
  readers,
  nameOf,
}: {
  item: SidebarView["items"][number]
  onIntent: (intent: Intent) => void
  onRename: (canvas: CanvasId) => void
  /** While this root is renamed, what its field does; else null. */
  rename: {
    readonly onSend: (title: string | null) => void
    readonly onEnd: (focusItem: boolean) => void
  } | null
  /** Its drag handle's attributes (`dragProps`). */
  drag: Readonly<Record<string, string>>
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
      item.kind === "canvas"
        ? SIDEBAR_WORDS.closeTitle
        : SIDEBAR_WORDS.closeNew,
    label: SIDEBAR_WORDS.closeLabel,
    onChoose: () => onIntent(item.close),
  }
  const items =
    item.kind === "canvas"
      ? [
          ...item.menu.map(m =>
            menuItem(m, () => onRename(item.canvas), onIntent),
          ),
          close,
        ]
      : [close]
  const canvas = item.kind === "canvas" ? item.canvas : undefined
  return (
    <span
      className="sidebar-item"
      data-selected={item.selected || undefined}
      ref={wrap}
      {...(canvas === undefined
        ? {}
        : {
            ...rootDropProps({ kind: "list", before: canvas }),
            ...dropProps({ kind: "sidebar", before: canvas }),
          })}
    >
      <Menu
        className="open-icon-menu"
        label={item.label}
        opensOn="contextmenu"
        sections={[{ key: "item", items }]}
        trigger={
          <span className="open-icon">
            <IconFace icon={item.icon} />
            {item.kind === "canvas" && (
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
        triggerClassName={item.archived ? "open-root archived" : "open-root"}
        triggerProps={{
          "aria-current": item.selected || undefined,
          "data-canvas": item.canvas,
          ...drag,
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
          {canvas !== undefined && <Readers {...readers} canvases={[canvas]} />}
        </span>
      )}
      {at !== null && rename !== null && item.kind === "canvas" && (
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
    case "not-needed":
      return {
        key: "not-needed",
        className: "not-needed",
        title: NOT_NEEDED.canvasTitle,
        label: NOT_NEEDED.label,
        onChoose: () => onIntent(item.intent),
      }
    case "rename":
      return {
        key: "rename",
        className: "rename-root",
        title: SIDEBAR_WORDS.rename.title,
        label: SIDEBAR_WORDS.rename.label,
        onChoose: rename,
      }
    case "retitle":
      return {
        key: "retitle",
        className: "retitle-root",
        title: SIDEBAR_WORDS.retitle.title,
        label: SIDEBAR_WORDS.retitle.label,
        onChoose: () => onIntent(item.intent),
      }
    case "move-to": {
      const drops = item.busy === null ? dropsWords(item.drops) : null
      return {
        key: `move-to:${item.name}`,
        className: item.closes ? "move-to closes" : "move-to",
        disabled: item.busy !== null,
        title: moveTitle(item),
        label: (
          <>
            Move to {item.name}
            {item.busy !== null && (
              <span className="why"> · {CANVAS_BUSY_REASON[item.busy]}</span>
            )}
            {drops !== null && <span className="why drops"> · {drops}</span>}
          </>
        ),
        onChoose: () => onIntent(item.intent),
      }
    }
  }
}
