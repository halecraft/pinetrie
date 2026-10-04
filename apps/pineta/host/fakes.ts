// host/fakes — test support for the shell's unit tests: ports that record
// their calls, a lane whose run a test finishes, and writers that put entries
// and values in a document as the host would. Production code never imports
// it.

import {
  type EntryId,
  type LaneName,
  type RootId,
  rootIdFor,
  type ValueWrite,
  writerId,
} from "@pineta/core"
import type { ThreadLaneHandle, WriteOutcome } from "@pineta/pi"
import { readLaneRecords, readRootRecord, readRoots } from "@pineta/reads"
import { LANE, ROOT, setRecord } from "@pineta/rules"
import {
  type LiveDocHandle,
  newLiveDoc,
  newPlacesDoc,
  newRootDoc,
  newSessionDoc,
  type PlacesDocHandle,
  physicalKey,
  type RootDocHandle,
  type SessionDocHandle,
  type StorageDocHandle,
  type StoredEntryRow,
  type StoredValueRecord,
  writeLaneTip,
} from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { HostDocuments } from "./docs.ts"

export interface Call {
  readonly method: string
  readonly args: readonly unknown[]
}

/**
 * A port of type `T` built from `impl`, recording every call. A method not in
 * `impl` throws when called, naming itself, so a test fails where a module
 * touches a port it did not declare.
 */
export function record<T extends object>(
  impl: Partial<T> = {},
): { readonly port: T; readonly calls: Call[] } {
  const calls: Call[] = []
  const given = impl as Record<string, unknown>
  const port = new Proxy({} as T, {
    get(_, key) {
      // Awaiting a port, or printing one, reads these: they are not calls.
      if (typeof key === "symbol" || key === "then") return undefined
      const value = given[key]
      if (value === undefined)
        return () => {
          throw new Error(`${key} is not in this port`)
        }
      if (typeof value !== "function") return value
      return (...args: unknown[]) => {
        calls.push({ method: key, args })
        return value(...args)
      }
    },
  })
  return { port, calls }
}

/** The methods called, in order. */
export const methods = (calls: readonly Call[]): string[] =>
  calls.map(c => c.method)

/** A promise and the functions that settle it. */
export function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
} {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A lane whose `run` and `resume` wait for `finish`, so a test sees the run in
 * progress for as long as it needs.
 */
export function fakeLane(
  name: LaneName,
  impl: Partial<ThreadLaneHandle> = {},
): {
  readonly lane: ThreadLaneHandle
  readonly calls: Call[]
  readonly finish: (outcome: WriteOutcome) => void
} {
  const ran = deferred<WriteOutcome>()
  const { port, calls } = record<ThreadLaneHandle>({
    name,
    run: async () => ran.promise,
    resume: async () => ran.promise,
    ...impl,
  })
  return { lane: port, calls, finish: ran.resolve }
}

/** A stored entry row, as `packages/reads/index.test.ts` writes them. */
export const row = (
  id: string,
  parentId: string | null,
  message: unknown = { role: "user", content: id },
): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  payload: { message },
})

/** The documents a write may go to: the session's, and the test's root. */
export type WriteDocs = Pick<FakeBasics, "session" | "root">

/** The document `write`'s target names, among `docs`. */
const docOf = (docs: WriteDocs, write: ValueWrite): StorageDocHandle =>
  write.target.kind === "session" ? docs.session : docs.root

/**
 * One pi value, as pi stores it, in the document its target names: a `set`
 * write, as `setRecord` makes one.
 */
export function putValue(
  docs: WriteDocs,
  write: Extract<ValueWrite, { kind: "set" }>,
): void {
  const { namespace, key, value } = write
  const record: StoredValueRecord = { namespace, key, value }
  docOf(docs, write).values.set(physicalKey(namespace, key), record)
}

/** `writes` applied to the documents they name, as pi's sessions would: a fake `writeValues`. */
export function applyWrites(
  docs: WriteDocs,
  writes: readonly ValueWrite[],
): void {
  for (const w of writes)
    if (w.kind === "set") putValue(docs, w)
    else docOf(docs, w).values.delete(physicalKey(w.namespace, w.key))
}

/** Every write a port's `writeValues` calls were given, in order. */
export const writesOf = (calls: readonly Call[]): ValueWrite[] =>
  calls.flatMap(c =>
    c.method === "writeValues" ? (c.args[0] as ValueWrite[]) : [],
  )

/** The root a test's entries are in, unless it opens another. */
export const ROOT_ID: RootId = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

/**
 * The host's documents over `session`, `live`, `places` and `roots`, held
 * from the start. A lane with no record is in `ROOT_ID`, so a test that
 * writes a tip there needs no `LANE` record; a root a test asks for that it
 * did not give is made empty.
 */
export function fakeDocuments(input: {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly places: PlacesDocHandle
  readonly roots: Map<RootId, RootDocHandle>
}): HostDocuments {
  const { session, live, places, roots } = input
  const rootOfLane = (lane: LaneName): RootId =>
    readLaneRecords(session).get(lane)?.root ?? ROOT_ID
  const open = (root: RootId): RootDocHandle => {
    const known = roots.get(root)
    if (known !== undefined) return known
    const made = newRootDoc()
    roots.set(root, made)
    return made
  }
  return {
    session,
    live,
    places,
    root: async root => open(root),
    view: root => {
      const doc = roots.get(root)
      return doc === undefined ? null : { root, doc, session, live }
    },
    rootOfLane,
    docOfLane: lane => roots.get(rootOfLane(lane)) ?? null,
    laneDoc: async lane => open(rootOfLane(lane)),
    rootOfEntry: entry => {
      for (const r of readRoots(session).values())
        if (r.entry === entry) return r.root
      return null
    },
    unload: async root => {
      roots.delete(root)
    },
    loaded: () => [...roots.keys()],
  }
}

export type FakeBasics = Basics & {
  /** The document of `ROOT_ID`, where a test's entries and pi's values go. */
  readonly root: RootDocHandle
  readonly lines: string[]
}

/**
 * The test's root's directory record, read from its document as the host
 * writes it: what the archive gate and the tabs find a root by (ADR-0063).
 */
export function writeDirectory(b: WriteDocs): void {
  putValue(b, setRecord(ROOT, readRootRecord(ROOT_ID, b.root)))
}

/**
 * A lane as the host creates one (ADR-0063): its record, naming the test's
 * root, and its tip there, as pi writes it.
 */
export function putLane(
  b: WriteDocs,
  lane: LaneName,
  tip: EntryId | null = null,
): void {
  putValue(
    b,
    setRecord(LANE, {
      lane,
      root: ROOT_ID,
      work: null,
      by: NOBODY_WRITER,
      createdAt: 0,
    }),
  )
  writeLaneTip(b.root, lane, tip)
}

const NOBODY_WRITER = writerId("nobody@example.com")

/** Fresh documents, ids from a counter, a fixed clock, and the log's lines. */
export function basics(
  root = newRootDoc(),
  places = newPlacesDoc(),
  live = newLiveDoc(),
  session = newSessionDoc(),
): FakeBasics {
  let n = 0
  const lines: string[] = []
  return {
    session,
    root,
    live,
    docs: fakeDocuments({
      session,
      live,
      places,
      roots: new Map([[ROOT_ID, root]]),
    }),
    places,
    log: m => lines.push(m),
    newId: () => `id-${String(++n).padStart(4, "0")}`,
    now: () => 1_000,
    lines,
  }
}
