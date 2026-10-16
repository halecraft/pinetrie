// interface/sidebar-view — what the sidebar shows and offers, full or folded
// to icons: `Sidebar` (`sidebar.tsx`) draws it, and each click sends the
// intent it names.

import type { MarkRecord, TaskId, ThreadId, ThreadName } from "@pinetrie/core"
import { PRODUCT_NAME } from "@pinetrie/core"
import { threadNameOf } from "@pinetrie/rules"
import type { Moments, Status } from "./attention.ts"
import type { Intent } from "./intent.ts"
import { type Here, type Layout, listOf, sameHere } from "./layout.ts"
import { type PageName, pageWords } from "./page.ts"
import { type ColorSlot, taskSlot } from "./palette.ts"
import { initialsOf, NO_TEXT, type TaskSummary } from "./root-label.ts"
import { newTabButton, type StartButton } from "./start-button.ts"
import type { ThreadCardHead, ThreadMove } from "./thread-card.ts"
import type { IconLookup, ThreadIcon } from "./thread-icon.ts"

/** What a task's ⋯ in the sidebar offers. */
export type ItemMenuItem =
  | { readonly kind: "rename" }
  /** What the task raises is not needed. */
  | { readonly kind: "notNeeded"; readonly intent: Intent }
  /** Ask a model for a title from the task's first thread. */
  | { readonly kind: "retitle"; readonly intent: Intent }
  /**
   * Move the task on the board to another workflow state, its thread card's
   * (`ThreadMove`). Into the archive it is archived: refused while its agent
   * works there (`busy`), and it withdraws the proposed changes of its threads
   * named in `drops`.
   */
  | ({ readonly kind: "moveTo" } & ThreadMove)

/**
 * What an item draws while the sidebar is folded: the icon of the task's
 * earliest thread with one (`taskIcons`), else its initials on a colour
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
  readonly icon: ItemIcon
  readonly selected: boolean
  readonly show: Intent
  /** An unsent card of yours is in it (`unsentSignals`). */
  readonly pip: boolean
  readonly close: Intent
}

export type ItemView = ItemCommon & {
  readonly kind: "task"
  readonly task: TaskId
  /** Its thread card's header, the board's too (`threadCardHead`). */
  readonly head: ThreadCardHead
  /** Its first line: the rename field's placeholder. */
  readonly line: string
  /** Its stored title, or null: what the rename field starts with. */
  readonly title: string | null
  /** What its mark draws (`taskStatus`), or null for none. */
  readonly status: Status | null
  /**
   * When its status last rose to needs you as you watched, or null: the
   * mark pulses as it mounts then, and stays (`moving`).
   */
  readonly arrived: number | null
  /** When its agent last stopped with a run you follow done, or null: a ✓ fades. */
  readonly done: number | null
  /** Only the task you are on can be archived and still in the sidebar. */
  readonly archived: boolean
  /** On every task not archived, the one you are on or not. */
  readonly menu: readonly ItemMenuItem[]
}

export interface SidebarView {
  /** The sidebar (`listOf`). */
  readonly items: readonly ItemView[]
  /** The item you are on, or null when the list lacks it. */
  readonly selected: ItemView | null
  /** ＋: a new tab, agent work its main action. */
  readonly add: StartButton
}

export interface SidebarViewInput {
  readonly layout: Layout
  readonly active: Here
  /** Each task's thread card header (`threadCardHeads`), which the board reads too. */
  readonly heads: ReadonlyMap<TaskId, ThreadCardHead>
  /** Each task's summary (`summariesOf`): the rename field's placeholder. */
  readonly summaries: ReadonlyMap<TaskId, TaskSummary>
  readonly marks: ReadonlyMap<TaskId, MarkRecord>
  /** Tasks in the archive. */
  readonly archived: ReadonlySet<TaskId>
  /** When each task's mark last arrived as you watched (`useAttention`). */
  readonly arrivals: Moments
  /** Each task's icon (`taskIcons`). */
  readonly icons: ReadonlyMap<TaskId, ThreadIcon>
}

export function sidebarView(input: SidebarViewInput): SidebarView {
  const all = listOf(input.layout)
  const items = all.map(here => itemView(here, input))
  return {
    items,
    selected: items.find(t => t.selected) ?? null,
    add: newTabButton(null),
  }
}

function itemView(
  here: Extract<Here, { kind: "task" }>,
  input: SidebarViewInput,
): ItemView {
  const { task } = here
  const archived = input.archived.has(task)
  const head = input.heads.get(task) ?? noHead(task)
  return {
    selected: sameHere(here, input.active),
    show: { kind: "show", here },
    close: { kind: "close", here },
    kind: "task",
    task,
    head,
    label: head.label,
    icon: itemIcon(head, input),
    line: input.summaries.get(task)?.line ?? NO_TEXT,
    title: input.marks.get(task)?.title ?? null,
    status: head.status,
    arrived: input.arrivals.arrived.get(task) ?? null,
    done: input.arrivals.done.get(task) ?? null,
    archived,
    menu: archived ? [] : menuOf(task, head),
    pip: head.pip,
  }
}

/** A task the heads lack: drawn with no signals, as a task not yet in the session. */
const noHead = (task: TaskId): ThreadCardHead => ({
  task,
  label: NO_TEXT,
  status: null,
  ready: [],
  pip: false,
  state: null,
  moves: [],
})

function itemIcon(head: ThreadCardHead, input: SidebarViewInput): ItemIcon {
  const icon = input.icons.get(head.task)
  if (icon !== undefined) return { kind: "icon", icon }
  return {
    kind: "initials",
    letters: initialsOf(head.label),
    slot: taskSlot(head.task),
  }
}

/**
 * Each task's icon: that of its earliest thread with one (`threadIcon`). A
 * thread's id is `t-` and a uuidv7, so ids sort by creation.
 */
export function taskIcons(
  threadsOf: ReadonlyMap<TaskId, readonly ThreadId[]>,
  iconFor: IconLookup,
): ReadonlyMap<TaskId, ThreadIcon> {
  const icons = new Map<TaskId, ThreadIcon>()
  for (const [task, threads] of threadsOf)
    for (const thread of [...threads].sort()) {
      const icon = iconFor(thread)
      if (icon === null) continue
      icons.set(task, icon)
      break
    }
  return icons
}

function menuOf(task: TaskId, head: ThreadCardHead): readonly ItemMenuItem[] {
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
    { kind: "retitle", intent: { kind: "retitle", task } },
    ...head.moves.map(m => ({ kind: "moveTo", ...m }) as const),
  ]
}

/** An item's key in the sidebar: its React key, and what the list scrolls to. */
export const listKey = (item: ItemView): string => `task:${item.task}`

/**
 * The window's title: what needs you (`inboxCount`, your inbox's badge), then
 * the page over the stage, else the task you are on. `here` is null on nothing,
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
 * The threads with open proposed changes, by their task, each as people read it
 * (`threadNameOf`), named or not: what archiving that task withdraws, and what
 * a thread card's ⇡ names. `openProposed` are the open proposed changes
 * (`appView`'s); one whose thread is in no task is left out.
 */
export function openProposedByTask(
  openProposed: readonly { readonly lane: ThreadId }[],
  names: ReadonlyMap<ThreadId, ThreadName>,
  taskOfThread: ReadonlyMap<ThreadId, TaskId>,
): ReadonlyMap<TaskId, readonly string[]> {
  const byTask = new Map<TaskId, string[]>()
  for (const { lane } of openProposed) {
    const task = taskOfThread.get(lane)
    if (task !== undefined)
      byTask.set(task, [...(byTask.get(task) ?? []), threadNameOf(names, lane)])
  }
  return byTask
}

/** What archiving a task does to its threads' proposed changes, beside its item. */
export const dropsWords = (drops: readonly string[]): string | null =>
  drops.length === 0 ? null : `work not accepted goes: ${drops.join(", ")}`

/** What a task's rename field sends, once planned (`planTitle`). */
export const renameIntent = (task: TaskId, title: string | null): Intent => ({
  kind: "rename",
  of: { kind: "task", task },
  title,
})
