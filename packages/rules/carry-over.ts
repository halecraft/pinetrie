// carry-over — a store from before the board, carried over once (ADR-0085).
//
// Before the board, a root was archived by a `pinetrie.archive` record keyed
// by its root entry. A starting host with no workflow writes the default one,
// puts each root with an `archived` record in the closed state and every
// other root in Doing, and deletes the old records. Delete this module, its
// tests and its call in the host's startup once it has run on Duane's store,
// as ADR-0066's carry-over was.

import type {
  BoardPlace,
  EntryId,
  RootId,
  RootRecord,
  ValueWrite,
  Workflow,
  WriterId,
} from "@pinetrie/core"
import { Type } from "typebox"
import { BOARD, defaultWorkflow, WORKFLOW } from "./board.ts"
import { decodeAt, entryKey } from "./decode.ts"
import { orderKeys } from "./order.ts"
import { deleteRecord, type RecordSpec, setRecord } from "./records.ts"

/** A root's archive record, as stored before the board. */
export interface OldArchiveRecord {
  readonly root: EntryId
  readonly state: "archived" | "restored"
  readonly by: WriterId
  readonly at: number
}

const ArchiveSchema = Type.Object({
  state: Type.Union([Type.Literal("archived"), Type.Literal("restored")]),
  by: Type.String(),
  at: Type.Number(),
})

/** Each root's archive record before the board, at the root's entry id. */
export const ARCHIVE: RecordSpec<OldArchiveRecord, EntryId, "session"> = {
  namespace: "pinetrie.archive",
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

/** What carrying a store over writes: the workflow, every root's place, and the old records to delete. */
export interface CarryOver {
  readonly workflow: Workflow
  readonly places: readonly BoardPlace[]
  readonly old: readonly EntryId[]
}

/**
 * How to carry a store over: null when it has a workflow already; else the
 * default workflow, a place for every root in the directory, and the old
 * archive records to delete. A root archived before is in the closed state,
 * by who archived it, when; every other root is in Doing, by whoever wrote
 * in it first, now. A starting host reads which roots are archived from this
 * before it opens them, and writes it once the agent is made. Pure.
 */
export function planCarryOver(input: {
  readonly workflow: Workflow | null
  readonly roots: ReadonlyMap<RootId, RootRecord>
  readonly archive: ReadonlyMap<EntryId, OldArchiveRecord>
  readonly host: WriterId
  readonly now: number
  readonly newId: () => string
}): CarryOver | null {
  if (input.workflow !== null) return null
  const workflow = defaultWorkflow(input.newId)
  const doing = workflow.open[1] ?? workflow.closed
  const closed: BoardPlace[] = []
  const open: BoardPlace[] = []
  for (const r of input.roots.values()) {
    const old = r.entry === null ? undefined : input.archive.get(r.entry)
    if (old?.state === "archived")
      closed.push({
        root: r.root,
        state: workflow.closed.id,
        rank: "",
        by: old.by,
        at: old.at,
      })
    else
      open.push({
        root: r.root,
        state: doing.id,
        rank: "",
        by: r.writers[0] ?? input.host,
        at: input.now,
      })
  }
  const ranked = (places: readonly BoardPlace[]) => {
    const keys = orderKeys(places.length)
    return places.map((p, i) => ({ ...p, rank: keys[i] ?? "" }))
  }
  return {
    workflow,
    places: [...ranked(closed), ...ranked(open)],
    old: [...input.archive.keys()],
  }
}

/** A carry-over's writes, in one batch. */
export const carryOverWrites = (plan: CarryOver): readonly ValueWrite[] => [
  setRecord(WORKFLOW, plan.workflow),
  ...plan.places.map(p => setRecord(BOARD, p)),
  ...plan.old.map(k => deleteRecord(ARCHIVE, k)),
]
