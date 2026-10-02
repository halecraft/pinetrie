// client/tabs-view — what the tab bar shows and offers (ADR-0029, ADR-0030),
// decided. PURE: `TabBar` (`tabs.tsx`) draws it, and each click sends the
// intent it names.

import {
  type EntryId,
  type LaneName,
  type MarkRecord,
  rootOf,
  type ThreadName,
  type TreeIndex,
} from "@pineta/core"
import type { CardMarks } from "./card-marks.ts"
import type { Intent } from "./intent.ts"
import { type ActiveTab, type Layout, sameTab, tabBar } from "./layout.ts"
import { NO_TEXT } from "./root-label.ts"

/** What a root tab's ⋯ offers. */
export type TabMenuItem =
  | { readonly kind: "rename" }
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
  readonly selected: boolean
  readonly show: Intent
  /** An unsent card of yours is in it (ADR-0048, `cardMarks`). */
  readonly pip: boolean
}

export type TabView =
  | (TabCommon & { readonly kind: "archive" })
  | (TabCommon & {
      readonly kind: "new"
      readonly key: string
      readonly label: string
      readonly close: Intent
    })
  | (TabCommon & {
      readonly kind: "root"
      readonly root: EntryId
      /** Its title, else its first message's first line (`rootLabels`). */
      readonly label: string
      /** Its first line: the rename field's placeholder. */
      readonly line: string
      /** Its stored title, or null: what the rename field starts with. */
      readonly title: string | null
      readonly running: boolean
      /** Only the tab you are on can be archived and still in the bar. */
      readonly archived: boolean
      /** On every root tab not archived, the one you are on or not. */
      readonly menu: readonly TabMenuItem[]
      readonly close: Intent
    })

export interface TabsView {
  /** Archive, your open roots, then new tabs (`tabBar`). */
  readonly tabs: readonly TabView[]
  /** The add tab: agent work, its main action, and a conversation. */
  readonly add: { readonly agent: Intent; readonly conversation: Intent }
}

export interface TabsViewInput {
  readonly layout: Layout
  readonly active: ActiveTab
  /** Each root's label (`rootLabels`). */
  readonly labels: ReadonlyMap<EntryId, string>
  /** Each root's first line (`firstLines`). */
  readonly lines: ReadonlyMap<EntryId, string>
  readonly marks: ReadonlyMap<EntryId, MarkRecord>
  /** Roots in state `archived`. */
  readonly archived: ReadonlySet<EntryId>
  /** The agent's work in each root (`rootWork`). */
  readonly work: ReadonlyMap<string, "running" | "waiting">
  /** The threads with an open offer, by root (`offeredByRoot`). */
  readonly offered: ReadonlyMap<EntryId, readonly ThreadName[]>
  readonly unsent: CardMarks
}

export function tabsView(input: TabsViewInput): TabsView {
  return {
    tabs: tabBar(input.layout).map(tab => tabView(tab, input)),
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
      // A root holding your card has no tab of its own.
      return { ...common, kind: "archive", pip: input.unsent.elsewhere }
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
      return {
        ...common,
        kind: "root",
        root,
        label: input.labels.get(root) ?? NO_TEXT,
        line: input.lines.get(root) ?? NO_TEXT,
        title: input.marks.get(root)?.title ?? null,
        running: input.work.get(root) === "running",
        archived,
        menu: archived
          ? []
          : [
              { kind: "rename" },
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

/**
 * The threads with an open offer, by their root: what archiving that root
 * withdraws. `offers` are the open offers with a tip (`appView`'s).
 */
export function offeredByRoot(
  index: TreeIndex,
  offers: readonly { readonly lane: LaneName; readonly tip: EntryId }[],
  names: ReadonlyMap<LaneName, ThreadName>,
): ReadonlyMap<EntryId, readonly ThreadName[]> {
  const byRoot = new Map<EntryId, ThreadName[]>()
  for (const { lane, tip } of offers) {
    const root = rootOf(index, tip)
    const name = names.get(lane)
    if (root === null || name === undefined) continue
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
