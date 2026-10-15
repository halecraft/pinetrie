// core/fixtures — test support: entries and trees, their ids minted with
// `entryId`, and a count of a function's collection steps. Core's tests use
// it, and other packages' tests as `@pinetrie/core/fixtures`; production code
// never imports it.

import { makeCard, NO_CONTENT, type TaskCard } from "./cards.ts"
import {
  type EntryId,
  entryId,
  type TaskId,
  type TextCardId,
  type ThreadId,
  textCardId,
  threadIdFor,
  type WorkflowStateId,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "./index.ts"
import type { AgentMessageLike, EntryLike } from "./tree.ts"

/**
 * A text card's id for a test, a uuidv7 that `parseCardId` takes, from a
 * name of up to 6 characters, hex-encoded into its last group: the same
 * name always gives the same id.
 */
export function cardIdFor(name: string): TextCardId {
  const hex = [...name].map(c => c.charCodeAt(0).toString(16).padStart(2, "0"))
  const tail = hex.join("").padStart(12, "0")
  if (name.length > 6 || tail.length !== 12)
    throw new Error(`a test card's name is at most 6 ASCII characters: ${name}`)
  return textCardId(`01a0ffd2-0000-7000-8000-${tail}`)
}

/** The board state a fixture's task is in when its test names none. */
export const FIXTURE_STATE = workflowStateIdFor("fixture")

/**
 * A task's card on the board, at `order` in `state`, made by `by`: what makes a
 * task one the session holds.
 */
export const taskCard = (
  task: TaskId,
  order = "a",
  state: WorkflowStateId = FIXTURE_STATE,
  by: WriterId = writerId("ada@x.io"),
): TaskCard =>
  makeCard("task", task, { kind: "board", state, order }, NO_CONTENT, by)

/** The thread a fixture's entry is in when its test names none. */
export const FIXTURE_THREAD = threadIdFor("fixture")

/**
 * One entry: a message when `message` is given, else of `more.type`; in
 * `more.thread`, else `FIXTURE_THREAD`.
 */
export const entry = (
  id: string,
  parentId: string | null,
  message?: AgentMessageLike,
  more: {
    readonly type?: string
    readonly timestamp?: number
    readonly thread?: ThreadId
  } = {},
): EntryLike => ({
  id: entryId(id),
  parentId: parentId === null ? null : entryId(parentId),
  type: more.type ?? "message",
  thread: more.thread ?? FIXTURE_THREAD,
  ...(message === undefined ? {} : { message }),
  ...(more.timestamp === undefined ? {} : { timestamp: more.timestamp }),
})

/** Entries keyed by their own ids, as the reads key them. */
export const entriesOf = (
  list: Iterable<EntryLike>,
): Record<EntryId, EntryLike> => {
  const out: Record<EntryId, EntryLike> = {}
  for (const e of list) out[e.id] = e
  return out
}

/**
 * Entries from `child: parent` pairs, each a message `message` makes from its
 * id: a user's message whose text is its id, unless given; in threads as
 * a branch writes them (`withThreads`).
 */
export const fromParents = (
  parents: Record<string, string | null>,
  message: (id: string) => AgentMessageLike = id => ({
    role: "user",
    content: id,
  }),
): Record<EntryId, EntryLike> =>
  withThreads(
    entriesOf(
      Object.entries(parents).map(([id, parentId]) =>
        entry(id, parentId, message(id)),
      ),
    ),
  )

/** The thread a fixture's entry `id` starts, when it starts one (`withThreads`). */
export const threadOfEntry = (id: string): ThreadId => threadIdFor(id)

/**
 * `entries` relabelled into threads, as a branch writes them: every entry with
 * no parent, and every child with a message but its parent's oldest, starts the
 * thread `threadOfEntry(its id)`; every other entry is in its parent's. Every
 * entry is relabelled: a test that chooses its threads gives them to `entry`
 * instead.
 */
export const withThreads = (
  entries: Record<EntryId, EntryLike>,
): Record<EntryId, EntryLike> => {
  const list = Object.values(entries)
  const children = new Map<string, EntryId[]>()
  for (const e of list)
    if (e.parentId !== null && entries[e.parentId] !== undefined)
      children.set(e.parentId, [...(children.get(e.parentId) ?? []), e.id])
  const continues = new Set<EntryId>()
  for (const ids of children.values()) {
    const oldest = ids.toSorted()[0]
    if (oldest !== undefined) continues.add(oldest)
  }
  const thread = new Map<EntryId, ThreadId>()
  // A parentId cycle has no first entry: the entry it is met at starts one.
  const visiting = new Set<EntryId>()
  const threadOf = (e: EntryLike): ThreadId => {
    const known = thread.get(e.id)
    if (known !== undefined) return known
    const parent = e.parentId === null ? undefined : entries[e.parentId]
    visiting.add(e.id)
    const own =
      parent === undefined ||
      visiting.has(parent.id) ||
      (!continues.has(e.id) && e.message !== undefined)
        ? threadOfEntry(e.id)
        : threadOf(parent)
    visiting.delete(e.id)
    thread.set(e.id, own)
    return own
  }
  return entriesOf(list.map(e => ({ ...e, thread: threadOf(e) })))
}

type Patched = Record<PropertyKey, unknown>

/**
 * `f`'s result, and how many steps every Map and Set iteration took while it
 * ran: spread, `for … of`, `keys`, `values`, `entries`, `forEach`, and
 * `new Set(iterable)`. A linear fold takes a few per item; one that scans a
 * collection per item takes its square.
 *
 * It wraps both prototypes' iterators until `f` returns, so `f` must be
 * synchronous: nothing else may run while they are wrapped, and a test that
 * counts must not be `test.concurrent`. Lookups (`get`, `has`, `set`,
 * `delete`) are not counted.
 */
export function collectionSteps<T>(f: () => T): {
  readonly result: T
  readonly steps: number
} {
  let steps = 0
  const saved: (readonly [Patched, PropertyKey, unknown])[] = []
  for (const proto of [Map.prototype, Set.prototype] as unknown as Patched[]) {
    for (const key of ["keys", "values", "entries", Symbol.iterator]) {
      const own = proto[key] as (this: unknown) => Iterator<unknown>
      saved.push([proto, key, own])
      proto[key] = function* (this: unknown) {
        for (const v of { [Symbol.iterator]: () => own.call(this) }) {
          steps++
          yield v
        }
      }
    }
    const forEach = proto.forEach as (
      this: unknown,
      each: (...a: unknown[]) => void,
      self?: unknown,
    ) => void
    saved.push([proto, "forEach", forEach])
    proto.forEach = function (
      this: unknown,
      each: (...a: unknown[]) => void,
      self?: unknown,
    ) {
      forEach.call(this, (...a: unknown[]) => {
        steps++
        each.apply(self, a)
      })
    }
  }
  try {
    const result = f()
    return { result, steps }
  } finally {
    for (const [proto, key, own] of saved) proto[key] = own
  }
}
