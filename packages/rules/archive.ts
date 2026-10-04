// archive — a root put aside for everyone, and what that refuses (ADR-0029).
//
// The record is a host-written `pineta.archive` value keyed by the root's
// entry id. Archiving writes only the record: entries are immutable
// (ADR-0004), so a root is hidden and made read-only, never removed, and
// restoring it keeps the record with its state set back.

import {
  type ArchiveAction,
  type ArchiveRecord,
  type CommitId,
  type EntryId,
  ERR,
  type Intent,
  type LaneName,
  type LaneView,
  nearestRevision,
  type Refusal,
  type RevisionRecord,
  type RootId,
  type RootRecord,
  refused,
  rootOf,
  rootWork,
  type SnapshotId,
  type TreeIndex,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAt, entryKey } from "./decode.ts"
import type { RecordSpec } from "./records.ts"
import { planRetention } from "./work.ts"

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

/**
 * What an archive or restore does off the documents' keeper, after its record
 * is written (ADR-0065): lanes to forget and remove (their containers and
 * disks), their refs in your repo moved (null deletes, archive), and
 * snapshots to delete. Empty on a host without lanes of their own.
 */
export interface ArchiveTeardown {
  readonly forget: readonly LaneName[]
  readonly refs: readonly {
    readonly lane: LaneName
    readonly commit: CommitId | null
  }[]
  readonly snapshots: readonly SnapshotId[]
}

type ArchivePlan =
  | Refusal
  /** Already in that state: nothing is written, and the outcome is the same. */
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "write"
      /** On the documents' keeper: from then on, the archive gate refuses writes into the root. */
      readonly record: ArchiveRecord
      /** Off the keeper, after the record. */
      readonly teardown: ArchiveTeardown
      /** On the keeper again, after the teardown: archive only. */
      readonly unload: boolean
    }

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
  /**
   * The root's lanes of their own, by their records, with each one's tip in
   * the root's document; empty on a host without lanes of their own.
   */
  readonly own: readonly {
    readonly lane: LaneName
    readonly tip: EntryId | null
  }[]
  /** The root's revision records: what its lanes' turns recorded. */
  readonly revisions: ReadonlyMap<EntryId, RevisionRecord>
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
    teardown: planTeardown(action, input),
    unload: action === "archive",
  }
}

/**
 * Archive: every own lane forgotten, its ref deleted, and every snapshot but
 * each lane's newest (`planRetention`). Restore: each lane's ref back at its
 * tip's nearest revision (`nearestRevision`), none for a lane with no tip or
 * no revision yet.
 */
function planTeardown(
  action: ArchiveAction,
  input: Pick<Parameters<typeof planArchive>[0], "index" | "own" | "revisions">,
): ArchiveTeardown {
  const lanes = input.own.map(o => o.lane)
  if (action === "archive") {
    const inRoot = new Set<string>(lanes)
    return {
      forget: lanes,
      refs: lanes.map(lane => ({ lane, commit: null })),
      snapshots: planRetention({
        records: [...input.revisions.values()].filter(r => inRoot.has(r.lane)),
        archived: true,
      }),
    }
  }
  return {
    forget: [],
    refs: input.own.flatMap(({ lane, tip }) => {
      if (tip === null) return []
      const { commit } = nearestRevision(input.index, input.revisions, {
        kind: "entry",
        id: tip,
      })
      return commit === null ? [] : [{ lane, commit }]
    }),
    snapshots: [],
  }
}

/**
 * The roots a command writes in (ADR-0063), none for a new thread at the
 * root, a name, a stop, an archive action, a reservation, a card's command,
 * or a card's move into an inventory, or its removal. An offer acts in its
 * lane's root, and so does a carry-on; a move in each root its cards go to;
 * an undo of moves and a retitle in their root (ADR-0066, ADR-0074).
 */
export function writesIn(
  intent: Intent,
  rootOfLane: (lane: LaneName) => RootId | null,
): readonly RootId[] {
  const only = (root: RootId | null): readonly RootId[] =>
    root === null ? [] : [root]
  switch (intent.kind) {
    case "chat":
      return only(intent.at.kind === "root" ? null : intent.root)
    // An offer acts at its lane's tip: an archived root's lanes offer no
    // work out. A carry-on writes its message there.
    case "offer":
    case "carry-on":
      return only(rootOfLane(intent.lane))
    case "mark":
    case "retitle":
    case "undo-move":
      return [intent.root]
    // A move into a thread or a fresh column writes in its root; an
    // inventory is in none.
    case "move":
      return intent.moves.flatMap(({ to }) =>
        to === null || to.kind === "inventory" ? [] : [to.root],
      )
    case "name":
    case "stop":
    case "archive":
    case "reserve":
    // The line is your repo's, in no root.
    case "line":
    // A command acts only when its card is taken, behind the take's own check.
    case "set-command":
    // Traces are the session's, in no root.
    case "traces-seen":
      return []
  }
}

/** The record that makes one of the `written` roots read-only, or null. */
export function archivedIn(
  written: readonly RootId[],
  roots: ReadonlyMap<RootId, RootRecord>,
  archive: ReadonlyMap<EntryId, ArchiveRecord>,
): ArchiveRecord | null {
  for (const root of written) {
    const entry = roots.get(root)?.entry ?? null
    const record = entry === null ? undefined : archive.get(entry)
    if (record?.state === "archived") return record
  }
  return null
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
