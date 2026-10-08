// interface/open-list-view — what your list shows and offers (ADR-0030,
// ADR-0112), full or folded to icons (ADR-0088), decided. PURE: `OpenList`
// (`open-list.tsx`) draws it, and each click sends the intent it names.

import type {
  BannerRecord,
  EntryId,
  LaneName,
  LaneView,
  MarkRecord,
  RootId,
  Sha256,
  ThreadName,
  TreeIndex,
  Workflow,
  WorkflowStateId,
} from "@pinetrie/core"
import { blobUrl, PRODUCT_NAME, rootOf } from "@pinetrie/core"
import { threadNameOf } from "@pinetrie/rules"
import type { Moments, Status } from "./attention.ts"
import type { CardMarks } from "./card-marks.ts"
import type { Intent } from "./intent.ts"
import { type Here, type Layout, listOf, sameHere } from "./layout.ts"
import { type PageName, pageWords } from "./page.ts"
import { type ColorSlot, rootSlot } from "./palette.ts"
import { initialsOf, NO_TEXT } from "./root-label.ts"

/** What a root's ⋯ in your list offers. */
export type ItemMenuItem =
  | { readonly kind: "rename" }
  /** What the root raises is not needed (ADR-0077). */
  | { readonly kind: "notNeeded"; readonly intent: Intent }
  /** Ask a model for a title from the root's messages (ADR-0074). */
  | { readonly kind: "retitle"; readonly intent: Intent }
  /**
   * Move the root on the board to another workflow state (ADR-0112). Into
   * the closed state it is archived: refused while its agent works there
   * (`busy`), and it withdraws the offers of its threads named in `drops`
   * (ADR-0061).
   */
  | {
      readonly kind: "moveTo"
      readonly name: string
      readonly closes: boolean
      readonly busy: "running" | "waiting" | null
      readonly drops: readonly string[]
      readonly intent: Intent
    }

/**
 * What an item draws while your list is folded (ADR-0088): the sprite of the
 * root's earliest thread with one (`rootSprites`), else its initials on its
 * colour (ADR-0089). A new tab has neither yet: a hollow tile, as its rail
 * has a hollow dot where its first message will be.
 */
export type ItemIcon =
  | { readonly kind: "sprite"; readonly src: string }
  | {
      readonly kind: "initials"
      readonly letters: string
      readonly slot: ColorSlot
    }
  | { readonly kind: "fresh" }

interface ItemCommon {
  /** What the item says, and what the window's title names (`pageTitle`). */
  readonly label: string
  readonly icon: ItemIcon
  readonly selected: boolean
  readonly show: Intent
  /** An unsent card of yours is in it (ADR-0048, `cardMarks`). */
  readonly pip: boolean
  readonly close: Intent
}

export type ItemView =
  | (ItemCommon & { readonly kind: "new"; readonly key: string })
  | (ItemCommon & {
      readonly kind: "root"
      readonly root: EntryId
      /** Its first line: the rename field's placeholder. */
      readonly line: string
      /** Its stored title, or null: what the rename field starts with. */
      readonly title: string | null
      /** What its mark draws (`rootStatus`), or null for none. */
      readonly status: Status | null
      /**
       * When its status last rose to needs you as you watched, or null: the
       * mark pulses as it mounts then, and stays (`moving`).
       */
      readonly arrived: number | null
      /** When its agent last stopped with a run you follow done, or null: a ✓ fades. */
      readonly done: number | null
      /** Only the root you are on can be archived and still in your list. */
      readonly archived: boolean
      /** On every root not archived, the one you are on or not. */
      readonly menu: readonly ItemMenuItem[]
    })

export interface OpenListView {
  /** Your list, then new tabs (`listOf`). */
  readonly items: readonly ItemView[]
  /** The item you are on, or null when the list lacks it. */
  readonly selected: ItemView | null
  /** ＋: agent work, its main action, and a conversation. */
  readonly add: { readonly agent: Intent; readonly conversation: Intent }
}

export interface OpenListViewInput {
  readonly layout: Layout
  readonly active: Here
  /** Each root's label (`labelsOf`). */
  readonly labels: ReadonlyMap<EntryId, string>
  /** Each root's first line (`firstLinesOf`). */
  readonly lines: ReadonlyMap<EntryId, string>
  readonly marks: ReadonlyMap<EntryId, MarkRecord>
  /** Roots in the closed state, by root entry. */
  readonly archived: ReadonlySet<EntryId>
  /** The agent's work in each root, held or not (`workAnywhere`). */
  readonly work: ReadonlyMap<string, "running" | "waiting">
  /** The threads with an open offer, by root (`offeredByRoot`). */
  readonly offered: ReadonlyMap<EntryId, readonly string[]>
  readonly unsent: CardMarks
  /** Each root's status (`rootStatus`, ADR-0077). */
  readonly status: ReadonlyMap<EntryId, Status>
  /** When each root's mark last arrived as you watched (`useAttention`). */
  readonly arrivals: Moments
  /** The board's states, or null before the host wrote them. */
  readonly workflow: Workflow | null
  /** Each root's state on the board, by root entry (`boardOf`). */
  readonly stateOf: ReadonlyMap<EntryId, WorkflowStateId>
  /** Each root's id, by root entry. */
  readonly rootIds: ReadonlyMap<EntryId, RootId>
  /** Each root's sprite, by root entry (`rootSprites`). */
  readonly sprites: ReadonlyMap<EntryId, Sha256>
}

export function openListView(input: OpenListViewInput): OpenListView {
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

function itemView(here: Here, input: OpenListViewInput): ItemView {
  const common = {
    selected: sameHere(here, input.active),
    show: { kind: "show", here } as const,
    close: { kind: "close", here } as const,
  }
  switch (here.kind) {
    case "nothing":
    case "new":
      return {
        ...common,
        kind: "new",
        key: here.kind === "new" ? here.key : "",
        label:
          input.layout.newTabs.find(
            c => here.kind === "new" && c.key === here.key,
          )?.asksAgent === true
            ? "new agent"
            : "new conversation",
        pip: here.kind === "new" && input.unsent.newTabs.has(here.key),
        icon: { kind: "fresh" },
      }
    case "root": {
      const { root } = here
      const archived = input.archived.has(root)
      const status = input.status.get(root) ?? null
      const label = input.labels.get(root) ?? NO_TEXT
      return {
        ...common,
        kind: "root",
        root,
        label,
        icon: iconOf(root, label, input),
        line: input.lines.get(root) ?? NO_TEXT,
        title: input.marks.get(root)?.title ?? null,
        status,
        arrived: input.arrivals.arrived.get(root) ?? null,
        done: input.arrivals.done.get(root) ?? null,
        archived,
        menu: archived ? [] : menuOf(root, status, input),
        pip: input.unsent.roots.has(root),
      }
    }
  }
}

function iconOf(
  root: EntryId,
  label: string,
  input: OpenListViewInput,
): ItemIcon {
  const sprite = input.sprites.get(root)
  if (sprite !== undefined) return { kind: "sprite", src: blobUrl(sprite) }
  const id = input.rootIds.get(root)
  return {
    kind: "initials",
    letters: initialsOf(label),
    slot: id === undefined ? "pending" : rootSlot(id),
  }
}

/**
 * Each root's sprite (ADR-0053): the banner of its earliest thread that has
 * one. A lane's name is `t-` and a uuidv7, so names sort by creation; a lane
 * belongs to the root its tip is in, as `rootWork` finds it. A root this tab
 * does not hold has no tips here, and so no sprite. Pure.
 */
export function rootSprites(
  index: TreeIndex,
  lanes: readonly LaneView[],
  banners: ReadonlyMap<LaneName, BannerRecord>,
): ReadonlyMap<EntryId, Sha256> {
  const sprites = new Map<EntryId, Sha256>()
  const byName = [...lanes].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
  for (const lane of byName) {
    const banner = banners.get(lane.name)
    if (banner === undefined || lane.tip === null) continue
    const root = rootOf(index, lane.tip)
    if (root !== null && !sprites.has(root)) sprites.set(root, banner.sha)
  }
  return sprites
}

function menuOf(
  root: EntryId,
  status: Status | null,
  input: OpenListViewInput,
): readonly ItemMenuItem[] {
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
    { kind: "retitle", intent: { kind: "retitle", root } },
    ...movesOf(root, input),
  ]
}

/** "Move to ▸" each state but the one the root is in. */
function movesOf(
  root: EntryId,
  input: OpenListViewInput,
): readonly ItemMenuItem[] {
  const { workflow } = input
  const id = input.rootIds.get(root)
  const from = input.stateOf.get(root)
  if (workflow === null || id === undefined || from === undefined) return []
  return [...workflow.open, workflow.closed].flatMap(state => {
    if (state.id === from) return []
    const closes = state.id === workflow.closed.id
    return [
      {
        kind: "moveTo",
        name: state.name,
        closes,
        busy: closes ? (input.work.get(root) ?? null) : null,
        drops: closes ? (input.offered.get(root) ?? []) : [],
        intent: {
          kind: "moveRoot",
          root: id,
          from,
          to: state.id,
          before: null,
          closes,
        },
      } as const,
    ]
  })
}

/** An item's key in your list: its React key, and what the list scrolls to. */
export const listKey = (item: ItemView): string =>
  item.kind === "new" ? `new:${item.key}` : `root:${item.root}`

/**
 * The window's title: what needs you (`inboxCount`, your inbox's badge),
 * then the page over the workspace (ADR-0098), else the root you are on.
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
 * The threads with an open offer, by their root, each as people read it
 * (`threadNameOf`), named or not: what archiving that root withdraws, and
 * what a board item's ⇡ names (ADR-0091). `offers` are the open offers
 * (`appView`'s).
 */
export function offeredByRoot(
  offers: readonly { readonly lane: LaneName; readonly root: EntryId }[],
  names: ReadonlyMap<LaneName, ThreadName>,
): ReadonlyMap<EntryId, readonly string[]> {
  const byRoot = new Map<EntryId, string[]>()
  for (const { lane, root } of offers)
    byRoot.set(root, [...(byRoot.get(root) ?? []), threadNameOf(names, lane)])
  return byRoot
}

/** What archiving a root does to its threads' offers, beside its item. */
export const dropsWords = (drops: readonly string[]): string | null =>
  drops.length === 0 ? null : `work not accepted goes: ${drops.join(", ")}`

/** What a root's rename field sends, once planned (`planTitle`). */
export const renameIntent = (root: EntryId, title: string | null): Intent => ({
  kind: "rename",
  root,
  title,
})
