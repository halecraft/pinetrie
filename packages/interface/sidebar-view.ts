// interface/sidebar-view — what the sidebar shows and offers, full or folded
// to icons: `Sidebar` (`sidebar.tsx`) draws it, and each click sends the
// intent it names.

import type { CanvasId, ThreadId, ThreadName } from "@pinetrie/core"
import { PRODUCT_NAME } from "@pinetrie/core"
import {
  type MarkRecord,
  readableThreadName,
  type Workflow,
} from "@pinetrie/rules"
import type { Moments, Status } from "./attention.ts"
import {
  boardPlaceWords,
  type PlaceOnBoard,
  placeOnBoard,
} from "./canvas-column-view.ts"
import type { Intent } from "./intent.ts"
import { type Here, type Layout, sameHere, sidebarList } from "./layout.ts"
import { type PageName, pageWords } from "./page.ts"
import { type ColorSlot, canvasSlot } from "./palette.ts"
import { type CanvasSummary, labelInitials, NO_TEXT } from "./root-label.ts"
import { newCanvasButton, type StartButton } from "./start-button.ts"
import type { ThreadCardHead, ThreadMove } from "./thread-card.ts"
import type { IconLookup, ThreadIcon } from "./thread-icon.ts"

/** What a canvas's ⋯ in the sidebar offers. */
export type ItemMenuItem =
  | { readonly kind: "rename" }
  /** What the canvas raises is not needed. */
  | { readonly kind: "notNeeded"; readonly intent: Intent }
  /** Ask a model for a title from the canvas's first thread. */
  | { readonly kind: "retitle"; readonly intent: Intent }
  /**
   * Move the canvas on the board to another workflow state, its thread card's
   * (`ThreadMove`). Into the archive it is archived: refused while its agent
   * works there (`busy`), and it withdraws the proposed changes of its threads
   * named in `drops`.
   */
  | ({ readonly kind: "moveTo" } & ThreadMove)

/**
 * What an item draws while the sidebar is folded: the icon of the canvas's
 * earliest thread with one (`canvasIcons`), else its initials on a colour
 * seeded by its id.
 */
export type ItemIcon =
  | { readonly kind: "icon"; readonly icon: ThreadIcon }
  | {
      readonly kind: "initials"
      readonly letters: string
      readonly slot: ColorSlot
    }

interface ItemCommon {
  /** What the item says, and what the window's title names (`pageTitle`). */
  readonly label: string
  /** Its hover's words: its label, and where it is on the board. */
  readonly hover: string
  readonly icon: ItemIcon
  readonly selected: boolean
  readonly show: Intent
  /** An unsent card of yours is in it (`unsentSignals`). */
  readonly pip: boolean
  readonly close: Intent
}

export type ItemView = ItemCommon & {
  readonly kind: "canvas"
  readonly canvas: CanvasId
  /** Its thread card's header, the board's too (`threadCardHead`). */
  readonly head: ThreadCardHead
  /** Its first line: the rename field's placeholder. */
  readonly line: string
  /** Its stored title, or null: what the rename field starts with. */
  readonly title: string | null
  /** What its mark draws (`canvasStatus`), or null for none. */
  readonly status: Status | null
  /**
   * When its status last rose to needs you as you watched, or null: the
   * mark pulses as it mounts then, and stays (`moving`).
   */
  readonly arrived: number | null
  /** When its agent last stopped with a run you follow done, or null: a ✓ fades. */
  readonly done: number | null
  /** Only the canvas you are on can be archived and still in the sidebar. */
  readonly archived: boolean
  /** On every canvas not archived, the one you are on or not. */
  readonly menu: readonly ItemMenuItem[]
}

export interface SidebarView {
  /** The sidebar (`sidebarList`). */
  readonly items: readonly ItemView[]
  /** The item you are on, or null when the list lacks it. */
  readonly selected: ItemView | null
  /** ＋ canvas: a new canvas, with no ▾. */
  readonly add: StartButton
}

export interface SidebarViewInput {
  readonly layout: Layout
  readonly active: Here
  /** Each canvas's thread card header (`threadCardHeads`), which the board reads too. */
  readonly heads: ReadonlyMap<CanvasId, ThreadCardHead>
  /** Each canvas's summary (`taskSummaries`): the rename field's placeholder. */
  readonly summaries: ReadonlyMap<CanvasId, CanvasSummary>
  readonly marks: ReadonlyMap<CanvasId, MarkRecord>
  /** Canvases in the archive. */
  readonly archived: ReadonlySet<CanvasId>
  /** When each canvas's mark last arrived as you watched (`useAttention`). */
  readonly arrivals: Moments
  /** Each canvas's icon (`canvasIcons`). */
  readonly icons: ReadonlyMap<CanvasId, ThreadIcon>
  /** The board's states, where ＋ lands a new canvas; null before they arrive. */
  readonly workflow: Workflow | null
}

export function sidebarView(input: SidebarViewInput): SidebarView {
  const all = sidebarList(input.layout)
  const items = all.map(here => itemView(here, input))
  return {
    items,
    selected: items.find(t => t.selected) ?? null,
    add: newCanvasButton({
      from: "sidebar",
      landsIn: input.workflow?.open[0] ?? null,
    }),
  }
}

function itemView(
  here: Extract<Here, { kind: "canvas" }>,
  input: SidebarViewInput,
): ItemView {
  const { canvas } = here
  const archived = input.archived.has(canvas)
  const head = input.heads.get(canvas) ?? noHead(canvas)
  return {
    selected: sameHere(here, input.active),
    show: { kind: "show", here },
    close: { kind: "close", here },
    kind: "canvas",
    canvas,
    head,
    label: head.label,
    hover: hoverWords(head.label, placeOnBoard(input.workflow, head.state)),
    icon: itemIcon(head, input),
    line: input.summaries.get(canvas)?.line ?? NO_TEXT,
    title: input.marks.get(canvas)?.title ?? null,
    status: head.status,
    arrived: input.arrivals.arrived.get(canvas) ?? null,
    done: input.arrivals.done.get(canvas) ?? null,
    archived,
    menu: archived ? [] : menuOf(canvas, head),
    pip: head.pip,
  }
}

/** An item's hover: its label, then where it is on the board, when it is on it. */
const hoverWords = (label: string, place: PlaceOnBoard | null): string =>
  place === null ? label : `${label} · ${boardPlaceWords(place).line}`

/** A canvas the heads lack: drawn with no signals, as a canvas not yet in the session. */
const noHead = (canvas: CanvasId): ThreadCardHead => ({
  canvas,
  label: NO_TEXT,
  status: null,
  ready: [],
  pip: false,
  state: null,
  moves: [],
})

function itemIcon(head: ThreadCardHead, input: SidebarViewInput): ItemIcon {
  const icon = input.icons.get(head.canvas)
  if (icon !== undefined) return { kind: "icon", icon }
  return {
    kind: "initials",
    letters: labelInitials(head.label),
    slot: canvasSlot(head.canvas),
  }
}

/**
 * Each canvas's icon: that of its earliest thread with one (`threadIcon`). A
 * thread's id is `t-` and a uuidv7, so ids sort by creation.
 */
export function canvasIcons(
  threadsOf: ReadonlyMap<CanvasId, readonly ThreadId[]>,
  iconFor: IconLookup,
): ReadonlyMap<CanvasId, ThreadIcon> {
  const icons = new Map<CanvasId, ThreadIcon>()
  for (const [canvas, threads] of threadsOf)
    for (const thread of [...threads].sort()) {
      const icon = iconFor(thread)
      if (icon === null) continue
      icons.set(canvas, icon)
      break
    }
  return icons
}

function menuOf(
  canvas: CanvasId,
  head: ThreadCardHead,
): readonly ItemMenuItem[] {
  const { status } = head
  return [
    ...(status === null || status.kind === "working"
      ? []
      : [
          {
            kind: "notNeeded",
            intent: {
              kind: "notNeeded",
              lane: status.item.lane,
              raised: status.item.raised,
            },
          } as const,
        ]),
    { kind: "rename" },
    { kind: "retitle", intent: { kind: "retitle", canvas } },
    ...head.moves.map(m => ({ kind: "moveTo", ...m }) as const),
  ]
}

/** An item's key in the sidebar: its React key, and what the list scrolls to. */
export const listKey = (item: ItemView): string => `canvas:${item.canvas}`

/**
 * The window's title: what needs you (`inboxCount`, your inbox's badge), then
 * the page over the stage, else the canvas you are on. `here` is null on nothing,
 * and before anything is chosen.
 */
export const pageTitle = (
  count: number,
  here: ItemView | null,
  page: PageName | null,
): string => {
  const shown =
    page !== null ? pageWords(page).title : here === null ? null : here.label
  const place = shown === null ? PRODUCT_NAME : `${shown} · ${PRODUCT_NAME}`
  return count === 0 ? place : `(${count}) ${place}`
}

/**
 * The threads with open proposed changes, by their canvas, each as people read it
 * (`readableThreadName`), named or not: what archiving that canvas withdraws, and what
 * a thread card's ⇡ names. `openProposed` are the open proposed changes
 * (`appView`'s); one whose thread is in no canvas is left out.
 */
export function openProposedByCanvas(
  openProposed: readonly { readonly lane: ThreadId }[],
  names: ReadonlyMap<ThreadId, ThreadName>,
  canvasOfThread: ReadonlyMap<ThreadId, CanvasId>,
): ReadonlyMap<CanvasId, readonly string[]> {
  const byCanvas = new Map<CanvasId, string[]>()
  for (const { lane } of openProposed) {
    const canvas = canvasOfThread.get(lane)
    if (canvas !== undefined)
      byCanvas.set(canvas, [
        ...(byCanvas.get(canvas) ?? []),
        readableThreadName(names, lane),
      ])
  }
  return byCanvas
}

/** The sidebar's own words: its list, and each canvas item's buttons and ⋯. */
export const SIDEBAR_WORDS = {
  list: "your canvases",
  menu: "more for this canvas",
  close: "close this canvas for you; nothing is written",
  closeTitle: "close for you; open it again from the board",
  closeNew: "close this new canvas; nothing has been written",
  closeLabel: "Close",
  rename: {
    label: "Rename",
    title: "change this canvas's title for everyone",
  },
  retitle: {
    label: "Retitle from the conversation",
    title: "title this canvas from what was said in it, for everyone",
  },
  titleField: "title for this canvas",
} as const

/** What archiving a canvas does to its threads' proposed changes, beside its item. */
export const dropsWords = (drops: readonly string[]): string | null =>
  drops.length === 0
    ? null
    : `unfinished changes will be dropped: ${drops.join(", ")}`

/** What a canvas's rename field sends, once planned (`planTitle`). */
export const renameIntent = (
  canvas: CanvasId,
  title: string | null,
): Intent => ({
  kind: "rename",
  of: { kind: "canvas", canvas },
  title,
})
