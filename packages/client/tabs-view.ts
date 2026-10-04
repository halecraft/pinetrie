// client/tabs-view — what the tab bar shows and offers (ADR-0029, ADR-0030),
// decided. PURE: `TabBar` (`tabs.tsx`) draws it, and each click sends the
// intent it names.

import type { EntryId, LaneName, MarkRecord, ThreadName } from "@pineta/core"
import type { Level, Moments, Status } from "./attention.ts"
import type { CardMarks } from "./card-marks.ts"
import type { Intent } from "./intent.ts"
import { type ActiveTab, type Layout, sameTab, tabBar } from "./layout.ts"
import { type MessageCount, NO_TEXT } from "./root-label.ts"

/** The Archive tab's label. */
export const ARCHIVE_LABEL = "Archive"

/** What a root tab's ⋯ offers. */
export type TabMenuItem =
  | { readonly kind: "rename" }
  /** What the tab raises is not needed (ADR-0077). */
  | { readonly kind: "notNeeded"; readonly intent: Intent }
  /** Ask a model for a title from the root's messages (ADR-0074). */
  | { readonly kind: "retitle"; readonly intent: Intent }
  /**
   * Archive, refused while the agent works in the root (`rootWork`). It
   * withdraws the offers of its threads named in `drops` (ADR-0061).
   */
  | {
      readonly kind: "archive"
      readonly busy: "running" | "waiting" | null
      readonly drops: readonly ThreadName[]
      readonly intent: Intent
    }

interface TabCommon {
  /** What the tab says, and what the window's title names (`pageTitle`). */
  readonly label: string
  readonly selected: boolean
  readonly show: Intent
  /** An unsent card of yours is in it (ADR-0048, `cardMarks`). */
  readonly pip: boolean
}

export type TabView =
  | (TabCommon & {
      readonly kind: "archive"
      /** The highest a root with no tab of its own raises (`untabbed`). */
      readonly status: Level | null
      /** The session's message count: its tooltip, and `data-messages`. */
      readonly messages: MessageCount
    })
  | (TabCommon & {
      readonly kind: "new"
      readonly key: string
      readonly close: Intent
    })
  | (TabCommon & {
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
      /** Only the tab you are on can be archived and still in the bar. */
      readonly archived: boolean
      /** On every root tab not archived, the one you are on or not. */
      readonly menu: readonly TabMenuItem[]
      readonly close: Intent
    })

export interface TabsView {
  /** Archive, your open roots, then new tabs (`tabBar`). */
  readonly tabs: readonly TabView[]
  /** The tab you are on, or null when the bar lacks it. */
  readonly selected: TabView | null
  /** The add tab: agent work, its main action, and a conversation. */
  readonly add: { readonly agent: Intent; readonly conversation: Intent }
}

export interface TabsViewInput {
  readonly layout: Layout
  readonly active: ActiveTab
  /** Each root's label (`labelsOf`). */
  readonly labels: ReadonlyMap<EntryId, string>
  /** Each root's first line (`firstLinesOf`). */
  readonly lines: ReadonlyMap<EntryId, string>
  readonly marks: ReadonlyMap<EntryId, MarkRecord>
  /** Roots in state `archived`. */
  readonly archived: ReadonlySet<EntryId>
  /** The agent's work in each root (`rootWork`). */
  readonly work: ReadonlyMap<string, "running" | "waiting">
  /** The threads with an open offer, by root (`offeredByRoot`). */
  readonly offered: ReadonlyMap<EntryId, readonly ThreadName[]>
  readonly unsent: CardMarks
  /** Each root's status (`rootStatus`, ADR-0077). */
  readonly status: ReadonlyMap<EntryId, Status>
  /** The highest status of roots with no tab (`untabbed`): the Archive tab's. */
  readonly elsewhere: Level | null
  /** When each root's mark last arrived as you watched (`useAttention`). */
  readonly arrivals: Moments
  /** The session's message count (`messageCount`), shown on the Archive tab. */
  readonly count: MessageCount
}

export function tabsView(input: TabsViewInput): TabsView {
  const tabs = tabBar(input.layout).map(tab => tabView(tab, input))
  return {
    tabs,
    selected: tabs.find(t => t.selected) ?? null,
    add: {
      agent: { kind: "newTab", asksAgent: true },
      conversation: { kind: "newTab", asksAgent: false },
    },
  }
}

function tabView(tab: ActiveTab, input: TabsViewInput): TabView {
  const common = {
    selected: sameTab(tab, input.active),
    show: { kind: "show", tab } as const,
  }
  switch (tab.kind) {
    case "archive":
      // A root holding your card, or raising something, has no tab of its own.
      return {
        ...common,
        kind: "archive",
        label: ARCHIVE_LABEL,
        pip: input.unsent.elsewhere,
        status: input.elsewhere,
        messages: input.count,
      }
    case "new":
      return {
        ...common,
        kind: "new",
        key: tab.key,
        label:
          input.layout.newTabs.find(c => c.key === tab.key)?.asksAgent === true
            ? "new agent"
            : "new conversation",
        pip: input.unsent.newTabs.has(tab.key),
        close: { kind: "closeTab", tab },
      }
    case "root": {
      const { root } = tab
      const archived = input.archived.has(root)
      const status = input.status.get(root) ?? null
      return {
        ...common,
        kind: "root",
        root,
        label: input.labels.get(root) ?? NO_TEXT,
        line: input.lines.get(root) ?? NO_TEXT,
        title: input.marks.get(root)?.title ?? null,
        status,
        arrived: input.arrivals.arrived.get(root) ?? null,
        done: input.arrivals.done.get(root) ?? null,
        archived,
        menu: archived
          ? []
          : [
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
              {
                kind: "archive",
                busy: input.work.get(root) ?? null,
                drops: input.offered.get(root) ?? [],
                intent: { kind: "archive", root },
              },
            ],
        pip: input.unsent.roots.has(root),
        close: { kind: "closeTab", tab },
      }
    }
  }
}

/** A tab's key among the tabs: its React key, and what the bar scrolls to. */
export const tabKey = (tab: TabView): string => {
  switch (tab.kind) {
    case "archive":
      return "archive"
    case "new":
      return `new:${tab.key}`
    case "root":
      return `root:${tab.root}`
  }
}

/**
 * The window's title: what needs you (`needsYouCount` plus unseen
 * mentions), then the tab you are on. `here` is null before a tab is chosen.
 */
export const pageTitle = (count: number, here: TabView | null): string => {
  const place = here === null ? "Pineta" : `${here.label} · Pineta`
  return count === 0 ? place : `(${count}) ${place}`
}

/**
 * The threads with an open offer, by their root: what archiving that root
 * withdraws. `offers` are the open offers (`appView`'s).
 */
export function offeredByRoot(
  offers: readonly { readonly lane: LaneName; readonly root: EntryId }[],
  names: ReadonlyMap<LaneName, ThreadName>,
): ReadonlyMap<EntryId, readonly ThreadName[]> {
  const byRoot = new Map<EntryId, ThreadName[]>()
  for (const { lane, root } of offers) {
    const name = names.get(lane)
    if (name === undefined) continue
    byRoot.set(root, [...(byRoot.get(root) ?? []), name])
  }
  return byRoot
}

/** What archiving a root does to its threads' offers, beside its button. */
export const dropsWords = (drops: readonly ThreadName[]): string | null =>
  drops.length === 0
    ? null
    : `work not added to the project goes: ${drops.join(", ")}`

/** What a root tab's rename field sends, once planned (`planTitle`). */
export const renameIntent = (root: EntryId, title: string | null): Intent => ({
  kind: "rename",
  root,
  title,
})
