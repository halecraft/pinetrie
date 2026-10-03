// archive — a root put aside for everyone, and what that refuses (ADR-0029).
//
// The record is a host-written `pineta.archive` value keyed by the root's
// entry id. Archiving writes only the record: entries are immutable
// (ADR-0004), so a root is hidden and made read-only, never removed, and
// restoring it keeps the record with its state set back.

import {
  type ArchiveAction,
  type ArchiveRecord,
  type EntryId,
  ERR,
  type Intent,
  type LaneName,
  type LaneView,
  type Refusal,
  type RootId,
  type RootRecord,
  refused,
  rootOf,
  rootWork,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAt, entryKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"

const ArchiveSchema = Type.Object({
  state: Type.Union([Type.Literal("archived"), Type.Literal("restored")]),
  by: Type.String(),
  at: Type.Number(),
})

/** Each root's archive record, at the root's entry id. */
export const ARCHIVE: RecordSpec<ArchiveRecord, EntryId, "session"> = {
  namespace: "pineta.archive",
  home: "session",
  keyOf: r => r.root,
  encode: ({ root, ...contents }) => contents,
  decode: (contents, key) =>
    decodeAt(ArchiveSchema, contents, entryKey(key), (r, root) => ({
      root,
      state: r.state,
      by: r.by as WriterId,
      at: r.at,
    })),
}

export type ArchivePlan =
  | Refusal
  /** Already in that state: nothing is written, and the outcome is the same. */
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly record: ArchiveRecord }

/** Why a root cannot be archived now, as the tab's menu and the host both say it. */
export const ROOT_BUSY_REASON = {
  running: "the agent is working here",
  waiting: "cards are queued here",
} as const

/**
 * Decide an archive or restore. A root the agent works in, or where cards are
 * queued, is not archived: stopping the run or holding the queue would do work
 * nobody asked for, so the person chooses (ADR-0029). Restoring is never busy.
 */
export function planArchive(input: {
  readonly action: ArchiveAction
  readonly root: EntryId
  readonly by: WriterId
  readonly now: number
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly archive: ReadonlyMap<EntryId, ArchiveRecord>
}): ArchivePlan {
  const { action, root, index } = input
  // A root is always a message (S30), so being a root is enough.
  if (rootOf(index, root) !== root)
    return refused(ERR.UNKNOWN_TARGET, "no such root")
  const state = action === "archive" ? "archived" : "restored"
  const busy = rootWork(index, input.lanes).get(root)
  if (action === "archive" && busy !== undefined)
    return refused(ERR.ROOT_BUSY, ROOT_BUSY_REASON[busy])
  const current = input.archive.get(root)?.state ?? "restored"
  if (current === state) return { kind: "unchanged" }
  return {
    kind: "write",
    record: { root, state, by: input.by, at: input.now },
  }
}

/**
 * The root a command writes in (ADR-0063), or null when it writes in none:
 * a new thread at the root, a name, a stop, an archive action, a
 * reservation, a card's command, or a card's move into a fresh column or an
 * inventory, or its removal. An offer acts in its lane's root.
 */
export function writesIn(
  intent: Intent,
  rootOfLane: (lane: LaneName) => RootId | null,
): RootId | null {
  switch (intent.kind) {
    case "chat":
      return intent.at.kind === "root" ? null : intent.root
    // An offer acts at its lane's tip: an archived root's lanes offer no
    // work out.
    case "offer":
      return rootOfLane(intent.lane)
    case "mark":
      return intent.root
    // A move into a thread writes in its root; a fresh column has no root
    // yet, and an inventory is in none.
    case "move": {
      const to = intent.move.to
      return to === null || to.kind === "fresh" || to.kind === "inventory"
        ? null
        : to.root
    }
    case "name":
    case "stop":
    case "archive":
    case "reserve":
    // The line is your repo's, in no root.
    case "line":
    // A command acts only when its card is taken, behind the take's own check.
    case "set-command":
      return null
  }
}

/** The record that makes `root` read-only, or null. */
export function archivedIn(
  root: RootId | null,
  roots: ReadonlyMap<RootId, RootRecord>,
  archive: ReadonlyMap<EntryId, ArchiveRecord>,
): ArchiveRecord | null {
  const entry = root === null ? null : (roots.get(root)?.entry ?? null)
  const record = entry === null ? undefined : archive.get(entry)
  return record?.state === "archived" ? record : null
}

/** The record that makes `at` read-only, or null. */
export function archivedAt(
  index: TreeIndex,
  archive: ReadonlyMap<EntryId, ArchiveRecord>,
  at: EntryId | null,
): ArchiveRecord | null {
  if (at === null) return null
  const root = rootOf(index, at)
  const record = root === null ? undefined : archive.get(root)
  return record?.state === "archived" ? record : null
}
