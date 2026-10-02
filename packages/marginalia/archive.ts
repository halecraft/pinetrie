// archive — a root put aside for everyone, and what that refuses (ADR-0029).
//
// The record is a host-written `pineta.archive` value keyed by the root's
// entry id. Archiving writes only the record: entries are immutable
// (ADR-0004), so a root is hidden and made read-only, never removed, and
// restoring it keeps the record with its state set back.

import {
  type ArchiveAction,
  type ArchiveRecord,
  ERR,
  entryId,
  type Intent,
  type LaneView,
  type Refusal,
  refused,
  rootOf,
  rootWork,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

/** pi value namespace for archive records. The key is the root's entry id. */
export const ARCHIVE_NAMESPACE = "pineta.archive"

const ArchiveSchema = Type.Object({
  root: Type.String({ minLength: 1 }),
  state: Type.Union([Type.Literal("archived"), Type.Literal("restored")]),
  by: Type.String(),
  at: Type.Number(),
})

/** An archive record -> the plain value stored in pi. */
export const encodeArchive = (r: ArchiveRecord) => ({ ...r })

export const decodeArchive = (value: unknown): ArchiveRecord | undefined =>
  decodeWith(ArchiveSchema, value, r => ({
    ...r,
    root: entryId(r.root),
    by: r.by as WriterId,
  }))

/** Stored `pineta.archive` values -> each root's record. */
export function archiveRecords(
  values: Iterable<{ readonly value: unknown }>,
): ReadonlyMap<string, ArchiveRecord> {
  return new Map(decodeAll(values, decodeArchive).map(r => [r.root, r]))
}

export type ArchivePlan =
  | Refusal
  /** Already in that state: nothing is written, and the outcome is the same. */
  | { readonly kind: "unchanged" }
  | { readonly kind: "write"; readonly record: ArchiveRecord }

/** Why a root cannot be archived now, as the tab's menu and the host both say it. */
export const ROOT_BUSY_REASON = {
  running: "the agent is working here",
  waiting: "messages are queued here",
} as const

/**
 * Decide an archive or restore. A root the agent works in, or where cards are
 * queued, is not archived: stopping the run or holding the queue would do work
 * nobody asked for, so the person chooses (ADR-0029). Restoring is never busy.
 */
export function planArchive(input: {
  readonly action: ArchiveAction
  readonly root: string
  readonly by: WriterId
  readonly now: number
  readonly index: TreeIndex
  readonly lanes: readonly LaneView[]
  readonly archive: ReadonlyMap<string, ArchiveRecord>
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
    record: { root: entryId(root), state, by: input.by, at: input.now },
  }
}

/**
 * The entry a command writes at, or null when it writes in no root: a new
 * thread at the root, a name, a stop, an archive action, a reservation.
 */
export function writesAt(
  intent: Intent,
  lanes: readonly LaneView[],
): string | null {
  switch (intent.kind) {
    case "chat":
      return intent.at.kind === "root" ? null : intent.at.id
    // An offer acts at its lane's tip: an archived root's lanes offer no
    // work out.
    case "offer":
      return lanes.find(l => l.name === intent.lane)?.tip ?? null
    case "mark":
      return intent.entry
    case "name":
    case "stop":
    case "archive":
    case "reserve":
      return null
  }
}

/** The record that makes `at` read-only, or null. */
export function archivedAt(
  index: TreeIndex,
  archive: ReadonlyMap<string, ArchiveRecord>,
  at: string | null,
): ArchiveRecord | null {
  if (at === null) return null
  const root = rootOf(index, at)
  const record = root === null ? undefined : archive.get(root)
  return record?.state === "archived" ? record : null
}
