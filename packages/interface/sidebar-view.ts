// interface/sidebar-view — what the sidebar shows and offers (ADR-0030,
// ADR-0122), full or folded to icons (ADR-0088), decided. PURE: `Sidebar`
// (`sidebar.tsx`) draws it, and each click sends the intent it names.

import type {
  BannerRecord,
  MarkRecord,
  Sha256,
  TaskId,
  ThreadId,
  ThreadName,
} from "@pinetrie/core"
import { blobUrl, PRODUCT_NAME } from "@pinetrie/core"
import { threadNameOf } from "@pinetrie/rules"
import type { Moments, Status } from "./attention.ts"
import type { Intent } from "./intent.ts"
import { type Here, type Layout, listOf, sameHere } from "./layout.ts"
import { type PageName, pageWords } from "./page.ts"
import { type ColorSlot, taskSlot } from "./palette.ts"
import { initialsOf, NO_TEXT, type TaskSummary } from "./root-label.ts"
import type { ThreadCardHead, ThreadMove } from "./thread-card.ts"

/** What a task's ⋯ in the sidebar offers. */
export type ItemMenuItem =
  | { readonly kind: "rename" }
  /** What the task raises is not needed (ADR-0077). */
  | { readonly kind: "notNeeded"; readonly intent: Intent }
  /** Ask a model for a title from the task's first thread (ADR-0074). */
  | { readonly kind: "retitle"; readonly intent: Intent }
  /**
   * Move the task on the board to another workflow state (ADR-0122), its
   * thread card's (`ThreadMove`). Into the archive it is archived:
   * refused while its agent works there (`busy`), and it withdraws the
   * offers of its threads named in `drops` (ADR-0061).
   */
  | ({ readonly kind: "moveTo" } & ThreadMove)

/**
 * What an item draws while the sidebar is folded (ADR-0088): the sprite of the
 * task's earliest thread with one (`taskSprites`), else its initials on a
 * colour seeded by its id (ADR-0089).
 */
export type ItemIcon =
  | { readonly kind: "sprite"; readonly src: string }
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
  /** An unsent card of yours is in it (ADR-0048, `unsentSignals`). */
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
  /** ＋: agent work, its main action, and a conversation. */
  readonly add: { readonly agent: Intent; readonly conversation: Intent }
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
  /** Each task's sprite (`taskSprites`). */
  readonly sprites: ReadonlyMap<TaskId, Sha256>
}

export function sidebarView(input: SidebarViewInput): SidebarView {
  const all = listOf(input.layout)
  const items = all.map(here => itemView(here, input))
  return {
    items,
    selected: items.find(t => t.selected) ?? null,
    add: {
      agent: { kind: "newTab", asksAgent: true },
      conversation: { kind: "newTab", asksAgent: false },
    },
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
    icon: iconOf(head, input),
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

function iconOf(head: ThreadCardHead, input: SidebarViewInput): ItemIcon {
  const sprite = input.sprites.get(head.task)
  if (sprite !== undefined) return { kind: "sprite", src: blobUrl(sprite) }
  return {
    kind: "initials",
    letters: initialsOf(head.label),
    slot: taskSlot(head.task),
  }
}

/**
 * Each task's sprite (ADR-0053, ADR-0116): the banner of its earliest
 * thread that has one. A thread's id is `t-` and a uuidv7, so ids sort by
 * creation. Pure.
 */
export function taskSprites(
  threadsOf: ReadonlyMap<TaskId, readonly ThreadId[]>,
  banners: ReadonlyMap<ThreadId, BannerRecord>,
): ReadonlyMap<TaskId, Sha256> {
  const sprites = new Map<TaskId, Sha256>()
  for (const [task, threads] of threadsOf) {
    const earliest = [...threads].sort().find(thread => banners.has(thread))
    const banner = earliest === undefined ? undefined : banners.get(earliest)
    if (banner !== undefined) sprites.set(task, banner.sha)
  }
  return sprites
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
 * The window's title: what needs you (`inboxCount`, your inbox's badge),
 * then the page over the stage (ADR-0098), else the task you are on.
 * `here` is null on nothing, and before anything is chosen.
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
 * The threads with an open offer, by their task (ADR-0116), each as people
 * read it (`threadNameOf`), named or not: what archiving that task
 * withdraws, and what a thread card's ⇡ names (ADR-0091). `offers` are the
 * open offers (`appView`'s); one whose thread is in no task is left out.
 */
export function offeredByTask(
  offers: readonly { readonly lane: ThreadId }[],
  names: ReadonlyMap<ThreadId, ThreadName>,
  taskOfThread: ReadonlyMap<ThreadId, TaskId>,
): ReadonlyMap<TaskId, readonly string[]> {
  const byTask = new Map<TaskId, string[]>()
  for (const { lane } of offers) {
    const task = taskOfThread.get(lane)
    if (task !== undefined)
      byTask.set(task, [...(byTask.get(task) ?? []), threadNameOf(names, lane)])
  }
  return byTask
}

/** What archiving a task does to its threads' offers, beside its item. */
export const dropsWords = (drops: readonly string[]): string | null =>
  drops.length === 0 ? null : `work not accepted goes: ${drops.join(", ")}`

/** What a task's rename field sends, once planned (`planTitle`). */
export const renameIntent = (task: TaskId, title: string | null): Intent => ({
  kind: "rename",
  of: { kind: "task", task },
  title,
})
