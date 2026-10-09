// host/migrations/0005-tasks — every root a task (ADR-0116): its record, its
// board place and title re-keyed by it, each of its threads a card on its
// canvas in rail order, every card at a thread naming its thread and no
// root, a fresh or gone card naming its task, each person's sidebar keyed by
// task, and the histories of moves kept by root retired (dropped, not
// migrated). One-time: delete this file, and `OpenDocBeforeTasks`, once
// Duane's store has run it.
//
// Each root's task is `k-` and the root's own uuidv7 (`taskOfRoot`), so the
// three parts (the session's records, the places, every `open:` document)
// agree without reading each other's writes: in one `migrate`, every part
// reads before any writes.

import type { Exchange } from "@kyneta/exchange"
import { batch } from "@kyneta/schema"
import {
  type EntryId,
  isRootId,
  isThreadId,
  MOVES_DOC_PREFIX,
  movesOfDocId,
  type RootId,
  rootDocId,
  SESSION_TARGET,
  type TaskId,
  type ThreadId,
  type ThreadRecord,
  type TreeIndex,
  taskIdFor,
  threadAt,
  type ValueWrite,
  type WriterId,
} from "@pinetrie/core"
import { PLACES_DOC_ID, SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { ownerOfPersonDoc } from "@pinetrie/protocol/writers"
import { readRoots, readThreads, readTreeIndex } from "@pinetrie/reads"
import { MARK, orderKeys, setRecord, TASK } from "@pinetrie/rules"
import {
  applyRecordWrites,
  OpenDoc,
  OpenDocBeforeTasks,
  PlacesDoc,
  RootDoc,
  readNamespace,
  SessionDoc,
  type SessionDocHandle,
} from "@pinetrie/schema"
import type { Migration, RecordMigration } from "./index.ts"

/** A root's task: `k-` and the root's own id, the same in every part. */
export const taskOfRoot = (root: RootId): TaskId =>
  taskIdFor(root.slice("r-".length))

// ── the places ──────────────────────────────────────────────────────────

/** The places schema's hash before rows had `task` and `width`. */
const PLACES_BEFORE = "028859909bb3dead15f16603d3b9e214a3"

/** A stored row, its fields as strings: `task` and `width` absent before. */
type Row = Readonly<Record<string, string>>

/**
 * Each root's threads, in rail order: by where each thread's first entry
 * comes in the tree's depth-first order, oldest child first.
 */
export function railOrder(index: TreeIndex): readonly ThreadId[] {
  const order: EntryId[] = []
  const walk = (id: EntryId) => {
    order.push(id)
    for (const child of index.childrenOf.get(id) ?? []) walk(child)
  }
  for (const root of index.roots) walk(root)
  const at = new Map(order.map((id, i) => [id, i] as const))
  return [...index.firstOf]
    .filter(([, first]) => at.has(first))
    .sort(([, a], [, b]) => (at.get(a) ?? 0) - (at.get(b) ?? 0))
    .map(([thread]) => thread)
}

/** What the places part writes. */
export interface PlacesPlan {
  /** Rows to write whole: every card rewritten, and each thread's new card. */
  readonly rows: Readonly<Record<string, Row>>
  /** Cards at a thread whose thread could not be found: left as they are. */
  readonly lost: readonly string[]
}

/**
 * The places as tasks need them, pure: a card at a thread's end, or queued,
 * names its thread (in `lane`), from the tree when its stored lane is no
 * thread's, and no root, which is its thread's; a fresh card names its
 * root's task; a gone card names its root's task in place of the root; each
 * thread with a record gets its card on its root's task's canvas, in rail
 * order, one column wide; every row gains `task` and `width`. A row that
 * already holds `task` is left: the part ran.
 */
export function planTaskPlaces(input: {
  readonly rows: Readonly<Record<string, Row>>
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  readonly indexes: ReadonlyMap<RootId, TreeIndex>
}): PlacesPlan {
  const rows: Record<string, Row> = {}
  const lost: string[] = []
  for (const [id, row] of Object.entries(input.rows)) {
    if (row.task !== undefined) continue
    const base = { ...row, task: "", width: "" }
    const root = row.root ?? ""
    switch (row.kind) {
      case "drafting":
      case "note":
      case "pinned":
      case "queued": {
        const index = isRootId(root) ? input.indexes.get(root) : undefined
        const lane = row.lane ?? ""
        const thread = isThreadId(lane)
          ? lane
          : index === undefined || (row.at ?? "") === ""
            ? null
            : threadAt(index, row.at as EntryId)
        if (thread === null) lost.push(id)
        rows[id] = thread === null ? base : { ...base, root: "", lane: thread }
        break
      }
      case "fresh":
        rows[id] = isRootId(root) ? { ...base, task: taskOfRoot(root) } : base
        break
      case "discarded":
      case "spun":
        rows[id] = {
          ...base,
          root: "",
          task: isRootId(root) ? taskOfRoot(root) : "",
        }
        break
      default:
        rows[id] = base
    }
  }
  for (const [root, index] of input.indexes) {
    const ordered = railOrder(index).filter(
      t => input.threads.get(t)?.root === root && input.rows[t] === undefined,
    )
    const ranks = orderKeys(ordered.length)
    for (const [i, thread] of ordered.entries()) {
      const by = input.threads.get(thread)?.by ?? ""
      rows[thread] = {
        owner: by,
        kind: "canvas",
        root: "",
        at: "",
        lane: "",
        column: "",
        order: ranks[i] ?? "",
        by: "",
        seen: "",
        command: "",
        fact: "",
        unsent: "",
        placer: by,
        holder: "",
        task: taskOfRoot(root),
        width: "1",
      }
    }
  }
  return { rows, lost }
}

export const tasksInPlaces: Migration = {
  name: "0005-tasks",
  kind: "places",
  from: PLACES_BEFORE,
  async run({ exchange, storedIds, hydrated, log }) {
    const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
    await hydrated(PLACES_DOC_ID)
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const indexes = new Map<RootId, TreeIndex>()
    for (const root of readRoots(session).keys()) {
      if (!storedIds.includes(rootDocId(root))) continue
      const doc = exchange.get(rootDocId(root), RootDoc)
      await hydrated(rootDocId(root))
      indexes.set(root, readTreeIndex(doc))
    }
    const plan = planTaskPlaces({
      rows: places.cards() as Readonly<Record<string, Row>>,
      threads: readThreads(session),
      indexes,
    })
    if (plan.lost.length > 0)
      log(
        `[host] 0005-tasks: ${plan.lost.length} card(s) at a thread whose thread is not found, left as they were`,
      )
    return async () => {
      batch(places, d => {
        for (const [id, row] of Object.entries(plan.rows))
          d.cards.set(id, row as never)
      })
      // Every document of the kind takes the new schema's hash with a write.
      places.rev.set(places.rev() + 1)
    }
  },
}

// ── each person's sidebar ───────────────────────────────────────────────

/** The `open:` schema's hash before the sidebar was keyed by task. */
const OPEN_BEFORE = "021782918f847460bab0eb1a904a686983"

/** A sidebar's order keys, re-keyed from its roots to their tasks. Pure. */
export const planOpenTasks = (
  roots: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(roots).flatMap(([root, key]) =>
      isRootId(root) ? [[taskOfRoot(root), key] as const] : [],
    ),
  )

export const tasksInOpen: Migration = {
  name: "0005-tasks",
  kind: "open",
  from: OPEN_BEFORE,
  async run({ exchange, docIds, hydrated }) {
    const planned = new Map<string, Readonly<Record<string, string>>>()
    for (const id of docIds) {
      if (ownerOfPersonDoc(id)?.kind !== "open") continue
      const old = exchange.get(id, OpenDocBeforeTasks)
      await hydrated(id)
      planned.set(id, planOpenTasks(old.roots()))
    }
    return async () => {
      for (const [id, tasks] of planned) {
        // Made again, so the stored document holds only the new field (S120).
        exchange.destroy(id)
        await exchange.flush()
        const fresh = exchange.get(id, OpenDoc)
        await exchange.whenHydrated(id)
        batch(fresh, d => {
          for (const [task, key] of Object.entries(tasks))
            d.tasks.set(task, key)
        })
      }
    }
  },
}

// ── the session's records ───────────────────────────────────────────────

/** A stored title's contents, as a root's mark held it. */
interface StoredMark {
  readonly title: string
  readonly by: string
  readonly at: number
}

const isMark = (v: unknown): v is StoredMark =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as StoredMark).title === "string" &&
  (v as StoredMark).title !== "" &&
  typeof (v as StoredMark).by === "string" &&
  typeof (v as StoredMark).at === "number"

/**
 * The session's records for tasks, pure: a task per root that has a thread,
 * opened by its first thread's starter when its first thread began; each
 * root's board place moved to its task's key; and each root's title, the
 * mark on its root entry, its task's.
 */
export function planTaskRecords(input: {
  readonly roots: readonly {
    readonly root: RootId
    readonly entry: EntryId | null
  }[]
  readonly threads: ReadonlyMap<ThreadId, ThreadRecord>
  /** The stored `pinetrie.board` namespace, keyed by root. */
  readonly board: Readonly<Record<string, unknown>>
  /** Each root's stored `pinetrie.mark` namespace, keyed by entry. */
  readonly marks: ReadonlyMap<RootId, Readonly<Record<string, unknown>>>
}): readonly ValueWrite[] {
  const writes: ValueWrite[] = []
  for (const { root, entry } of input.roots) {
    const task = taskOfRoot(root)
    const first = [...input.threads.values()]
      .filter(t => t.root === root)
      .sort((a, b) => a.createdAt - b.createdAt)[0]
    if (first === undefined) continue
    writes.push(
      setRecord(TASK, { task, by: first.by, createdAt: first.createdAt }),
    )
    const place = input.board[root]
    if (place !== undefined)
      writes.push(
        {
          kind: "set",
          target: SESSION_TARGET,
          namespace: "pinetrie.board",
          key: task,
          value: place,
        },
        {
          kind: "delete",
          target: SESSION_TARGET,
          namespace: "pinetrie.board",
          key: root,
        },
      )
    const mark = entry === null ? undefined : input.marks.get(root)?.[entry]
    if (isMark(mark))
      writes.push(
        setRecord(MARK, {
          task,
          title: mark.title,
          by: mark.by as WriterId,
          at: mark.at,
        }),
      )
  }
  return writes
}

/** The stored histories of moves kept by root, from before tasks: those no task names. Pure. */
export const historiesByRoot = (ids: readonly string[]): readonly string[] =>
  ids.filter(
    id => id.startsWith(MOVES_DOC_PREFIX) && movesOfDocId(id) === undefined,
  )

export const tasksInRecords: RecordMigration = {
  name: "0005-tasks",
  async run({ exchange, docIds, hydrated }) {
    const spent = historiesByRoot(docIds)
    const writes = docIds.includes(SESSION_DOC_ID)
      ? await recordWrites(exchange, docIds, hydrated)
      : null
    if (spent.length === 0 && writes === null) return null
    return async () => {
      if (writes !== null) applyRecordWrites(writes.session, writes.writes)
      for (const id of spent) await exchange.destroy(id)
    }
  },
}

/** The session's writes for tasks; null once a task is recorded: this ran, or the store began after it. */
async function recordWrites(
  exchange: Exchange,
  docIds: readonly string[],
  hydrated: (docId: string) => Promise<void>,
): Promise<{
  readonly session: SessionDocHandle
  readonly writes: readonly ValueWrite[]
} | null> {
  const session = exchange.get(SESSION_DOC_ID, SessionDoc)
  await hydrated(SESSION_DOC_ID)
  if (Object.keys(readNamespace(session, TASK.namespace)).length > 0)
    return null
  const roots = [...readRoots(session).values()]
  if (roots.length === 0) return null
  const marks = new Map<RootId, Readonly<Record<string, unknown>>>()
  for (const { root } of roots) {
    if (!docIds.includes(rootDocId(root))) continue
    const doc = exchange.get(rootDocId(root), RootDoc)
    await hydrated(rootDocId(root))
    marks.set(root, readNamespace(doc, MARK.namespace))
  }
  return {
    session,
    writes: planTaskRecords({
      roots,
      threads: readThreads(session),
      board: readNamespace(session, "pinetrie.board"),
      marks,
    }),
  }
}
