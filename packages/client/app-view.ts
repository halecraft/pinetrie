// client/app-view — what the page shows, decided. PURE.
//
// `appView` decides; it does not project. The projections (`projectColumns`,
// `pathIds`, `branchColors`, `cardMarks`) stay in `App`'s own `useMemo`s and
// their results come in: one tree rebuilt each render would give every
// memoised child new props (S54, S59).

import {
  type ArchiveRecord,
  type EntryId,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type OfferRecord,
  PENDING_TRACK,
  projectRail,
  type RailRow,
  type RootId,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { displayName, offerStatus } from "@pineta/rules"
import type { Column } from "./columns.ts"
import type { Intent } from "./intent.ts"
import type { ActiveTab } from "./layout.ts"

/**
 * A column nothing may be written in (ADR-0029): its composer stays mounted,
 * disabled, so what was typed survives, and shows `label` and `action` in
 * place of its buttons.
 */
export interface ReadOnly {
  readonly label: string
  readonly action: { readonly title: string; readonly intent: Intent }
}

/** One column of the tab you are on, as the strip draws it. */
export interface ColumnSlot {
  readonly key: string
  readonly position: number
  /**
   * Whether × shows: not on a root tab's only column, which the root would
   * give back at once (`columnsOf`). A new tab's one column closes the tab.
   */
  readonly closable: boolean
  readonly track: number
}

export type Workspace =
  /** Before the first `prune`: no tab is chosen yet. */
  | { readonly kind: "connecting" }
  | { readonly kind: "archive" }
  | {
      readonly kind: "root"
      readonly root: EntryId
      readonly readOnly: ReadOnly | null
      readonly slots: readonly ColumnSlot[]
    }
  /** A new tab: an empty rail, and its one fresh column. */
  | {
      readonly kind: "new"
      readonly key: string
      readonly slots: readonly ColumnSlot[]
    }

/** Facts `App` already holds; nothing here is projected again. */
export interface AppViewInput {
  readonly active: ActiveTab | null
  /** The tab's columns: `columnsOf`, or the new tab's one. */
  readonly columns: readonly Column[]
  /** `branchColors(rail, views).track`, memoised by `App`. */
  readonly tracks: readonly number[]
  readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly offers: ReadonlyMap<LaneName, OfferRecord>
  /** The lanes of the roots this tab holds. */
  readonly lanes: readonly LaneView[]
  /** Every lane's root entry (`laneRootsOf`), held or not. */
  readonly laneRoots: ReadonlyMap<LaneName, EntryId>
}

/** Every lane's root entry: its `LaneRecord`'s root, through `rootEntries` (ADR-0063). */
export const laneRootsOf = (
  records: ReadonlyMap<LaneName, LaneRecord>,
  rootEntries: ReadonlyMap<RootId, EntryId>,
): ReadonlyMap<LaneName, EntryId> =>
  new Map(
    [...records.values()].flatMap(r => {
      const entry = rootEntries.get(r.root)
      return entry === undefined ? [] : [[r.lane, entry] as const]
    }),
  )

/**
 * An open offer (`offerStatus`), for the header and the tab's Archive item:
 * its lane, its root entry, and where it opens: its lane's tip, or its root
 * entry in a root this tab does not hold.
 */
export interface OpenOffer {
  readonly lane: LaneName
  readonly root: EntryId
  readonly end: EntryId
  /**
   * The lane tip it holds (`ledger.source`): "not needed" holds until new
   * work moves it (ADR-0077). Null for an offer whose message carries none.
   */
  readonly source: string | null
}

export function appView(input: AppViewInput): {
  readonly workspace: Workspace
  /** Open offers whose lane has a tip, for the header. */
  readonly offers: readonly OpenOffer[]
} {
  return { workspace: workspaceOf(input), offers: openOffers(input) }
}

function workspaceOf(input: AppViewInput): Workspace {
  const { active, columns, tracks } = input
  if (active === null) return { kind: "connecting" }
  const slots = (closable: boolean): readonly ColumnSlot[] =>
    columns.map((c, position) => ({
      key: c.key,
      position,
      closable,
      track: tracks[position] ?? PENDING_TRACK,
    }))
  switch (active.kind) {
    case "archive":
      return { kind: "archive" }
    case "new":
      return { kind: "new", key: active.key, slots: slots(true) }
    case "root": {
      const record = input.archive.get(active.root)
      return {
        kind: "root",
        root: active.root,
        readOnly:
          record?.state === "archived"
            ? readOnlyWords(active.root, record, input.nameOf)
            : null,
        slots: slots(columns.length > 1),
      }
    }
  }
}

/**
 * The offers with work to add (`offerStatus`'s `open`; not one taken, nor
 * one the line already holds), each in a root with an entry. A lane this
 * tab holds opens at its tip, and one with none yet is left out; any other
 * lane opens at its root entry (ADR-0063).
 */
const openOffers = (input: AppViewInput): readonly OpenOffer[] =>
  [...input.offers.values()].flatMap(o => {
    const root = input.laneRoots.get(o.lane)
    if (offerStatus(o).kind !== "open" || root === undefined) return []
    const source = o.ledger?.source ?? null
    const held = input.lanes.find(l => l.name === o.lane)
    if (held === undefined) return [{ lane: o.lane, root, end: root, source }]
    return held.tip === null
      ? []
      : [{ lane: o.lane, root, end: held.tip, source }]
  })

/** The rows the tab's rail draws: its own root's only, and none off a root. */
export const tabRail = (
  index: TreeIndex,
  active: ActiveTab | null,
): readonly RailRow[] =>
  active?.kind === "root" ? projectRail(index, active.root) : []

/**
 * What a read-only column says and offers: Restore for an archived root, Open
 * for an open one (the Archive tab's preview).
 */
export function readOnlyWords(
  root: EntryId,
  record: ArchiveRecord | undefined,
  nameOf: ReadonlyMap<WriterId, string>,
): ReadOnly {
  return record?.state === "archived"
    ? {
        label: `archived by ${displayName(record.by, nameOf.get(record.by))}`,
        action: { title: "Restore", intent: { kind: "restore", root } },
      }
    : {
        label: "open",
        action: {
          title: "Open",
          intent: { kind: "show", tab: { kind: "root", root } },
        },
      }
}
