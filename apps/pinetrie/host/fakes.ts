// host/fakes — test support for the shell's unit tests: ports that record
// their calls, a lane whose run a test finishes, and writers that put entries
// and values in a document as the host would. Production code never imports
// it.

import { createInMemoryStore, Exchange } from "@kyneta/exchange"
import {
  type CanvasId,
  canvasIdFor,
  type EntryId,
  proveRunnable,
  type RootId,
  type RunnableLane,
  rootIdFor,
  type Target,
  type ThreadId,
  threadIdFor,
  type ValueWrite,
  type WorkflowStateId,
  type WriterId,
  workflowStateIdFor,
  writerId,
} from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { RunOutcome, ThreadLaneHandle } from "@pinetrie/pi"
import {
  readLaneRecords,
  readPlaces,
  readReadingCanvases,
  readRootRecord,
  readRoots,
  readWorkflow,
} from "@pinetrie/reads"
import {
  byTarget,
  CARD_HISTORY,
  type Cleared,
  cardsOnCanvas,
  encodeMessage,
  indexCanvases,
  isBoardCard,
  LANE,
  orderAfter,
  type PlaceStep,
  planGate,
  planThreadOpen,
  ROOT,
  setRecord,
  WORKFLOW,
} from "@pinetrie/rules"
import { testWorkflow } from "@pinetrie/rules/fixtures"
import {
  applyRecordWrites,
  type LiveDocHandle,
  type PlacesDocHandle,
  type PresenceDocHandle,
  type RecordsDocHandle,
  type RootDocHandle,
  type SessionDocHandle,
  type StoredEntryRow,
} from "@pinetrie/schema"
import {
  newLiveDoc,
  newPlacesDoc,
  newPresenceDoc,
  newRootDoc,
  newSessionDoc,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import {
  type CardId,
  type CardRecord,
  indexTree,
  makeCard,
  NOBODY,
  type NoteColumnId,
  ROOT_ORIGIN,
  type Send,
  STATE_UNCHANGED,
  UNTICKED,
} from "@pinetrie/threads"
import type { Basics, HostKey } from "./basics.ts"
import type { CardPort } from "./cards.ts"
import type { HostDocuments } from "./docs.ts"
import {
  createPlaces,
  type Gesture,
  type OpenChange,
  type Places,
} from "./places.ts"
import {
  createProvenance,
  type Provenance,
  type ProvenanceHooks,
} from "./provenance.ts"
import { createStepRecords, type Records } from "./records.ts"
import type { RootTrace } from "./root-trace.ts"
import {
  createRoots,
  type Lease,
  type Leases,
  type PeerStates,
  queueUpkeepOn,
  type StepDocs,
} from "./roots.ts"
import type { LaneWork } from "./work/index.ts"

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

/** A run that ran and wrote nothing of its lane's prompt anew. */
export const RAN: RunOutcome = { kind: "ok", promptChanged: [] }

/**
 * A lane whose `run` and `resume` wait for `finish`, so a test sees the run in
 * progress for as long as it needs.
 */
export function fakeLane(
  name: ThreadId,
  impl: Partial<ThreadLaneHandle> = {},
): {
  readonly lane: ThreadLaneHandle
  readonly calls: Call[]
  readonly finish: (outcome: RunOutcome) => void
} {
  const ran = deferred<RunOutcome>()
  const { port, calls } = record<ThreadLaneHandle>({
    name,
    isLeftOpen: async () => false,
    run: async () => ran.promise,
    resume: async () => ran.promise,
    ...impl,
  })
  return { lane: port, calls, finish: ran.resolve }
}

/** The thread a fixture's row is in when its test names none. */
const ROW_THREAD = threadIdFor("row")

/** A stored entry row, as `packages/reads/index.test.ts` writes them. */
export const row = (
  id: string,
  parentId: string | null,
  message: unknown = { role: "user", content: id },
  thread: ThreadId = ROW_THREAD,
): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  thread,
  payload: { message },
})

/**
 * A person's message saying `text`, as the host stores one: by the starter,
 * its send named after its text, unless `more` says.
 */
export const storedMessage = (
  text: string,
  more: {
    readonly author?: WriterId
    readonly authorName?: string
    readonly sendId?: string
  } = {},
): unknown =>
  encodeMessage(
    {
      author: more.author ?? STARTER,
      authorName: more.authorName ?? "Starter",
      text,
      compels: NOBODY,
      sendId: more.sendId ?? `send-${text}`,
    },
    0,
  )

/** A stored person's message in `thread`, saying its id. */
export const threadRow = (
  id: string,
  parentId: string | null,
  thread: ThreadId,
): StoredEntryRow => row(id, parentId, storedMessage(id), thread)

const STARTER = writerId("starter@example.com")

/** The documents a write may go to: the session's, and the test's root. */
type WriteDocs = Pick<FakeBasics, "session" | "root">

/** The document `target` names, among `docs`. */
const docOf = (docs: WriteDocs, target: Target): RecordsDocHandle =>
  target.kind === "session" ? docs.session : docs.root

/** One host record, in the document its target names, by the real writer. */
export function putValue(
  docs: WriteDocs,
  write: Extract<ValueWrite, { kind: "set" }>,
): void {
  applyRecordWrites(docOf(docs, write.target), [write])
}

/** `writes` applied to the documents they name, as the host's `Records` does. */
export function applyWrites(
  docs: WriteDocs,
  writes: readonly ValueWrite[],
): void {
  for (const [target, group] of byTarget(writes))
    applyRecordWrites(docOf(docs, target), group)
}

/** Every write a port's `writeValues` calls were given, in order. */
export const writtenValues = (calls: readonly Call[]): ValueWrite[] =>
  calls.flatMap(c =>
    c.method === "writeValues" ? (c.args[0] as ValueWrite[]) : [],
  )

/** The root a test's entries are in, unless it opens another. */
export const ROOT_ID: RootId = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

/**
 * The host's documents over `session`, `live` and `places`. A lane with no
 * record is in `ROOT_ID`, so a test that writes a tip there needs no `LANE`
 * record.
 */
function fakeDocuments(input: {
  readonly session: SessionDocHandle
  readonly live: LiveDocHandle
  readonly places: PlacesDocHandle
}): HostDocuments {
  const { session, live, places } = input
  return {
    session,
    live,
    places,
    rootOfLane: lane => readLaneRecords(session).get(lane)?.root ?? ROOT_ID,
    rootOfEntry: entry => {
      for (const r of readRoots(session).values())
        if (r.entry === entry) return r.root
      return null
    },
  }
}

/**
 * A step's documents and the leases over `roots`, every root loaded from the
 * start: a root a test asks for that it did not give is made empty. A lane
 * with no record is in `ROOT_ID`. `destroyed` hears each root destroyed.
 */
export function fakeRoots(input: {
  readonly session: SessionDocHandle
  readonly roots: Map<RootId, RootDocHandle>
  readonly destroyed?: (root: RootId) => void
}): { readonly step: StepDocs; readonly leases: Leases } {
  const { session, roots } = input
  const open = (root: RootId): RootDocHandle => {
    const known = roots.get(root)
    if (known !== undefined) return known
    const made = newRootDoc()
    roots.set(root, made)
    return made
  }
  const rootOfLane = (lane: ThreadId): RootId =>
    readLaneRecords(session).get(lane)?.root ?? ROOT_ID
  const records = createStepRecords({ session, root: async r => open(r) })
  const lease = (root: RootId): Lease => {
    const doc = open(root)
    return {
      root,
      doc,
      ready: Promise.resolve(doc),
      records,
      async [Symbol.asyncDispose]() {},
    }
  }
  return {
    step: {
      root: async root => open(root),
      async lane(lane) {
        const root = rootOfLane(lane)
        return { root, doc: open(root) }
      },
      lease,
      async destroy(root) {
        roots.delete(root)
        input.destroyed?.(root)
      },
      records,
    },
    leases: {
      root: lease,
      lane: lane => lease(rootOfLane(lane)),
    },
  }
}

export type FakeBasics = Basics & {
  /** A step's documents over the test's roots: `ROOT_ID`'s is `root`. */
  readonly roots: StepDocs
  /** Leases over the same roots. */
  readonly leases: Leases
  /** The roots `roots` holds now: a destroyed one is gone. */
  readonly rootsLoaded: () => readonly RootId[]
  /** The document of `ROOT_ID`, where a test's entries and pi's values go. */
  readonly root: RootDocHandle
  readonly lines: string[]
}

/**
 * The test's root's directory record, read from its document as the host writes
 * it: what the archive gate and the tabs find a root by.
 */
export function writeDirectory(b: WriteDocs): void {
  putValue(b, setRecord(ROOT, readRootRecord(ROOT_ID, b.root)))
}

/**
 * A lane as the host creates one: its record, naming the test's root, and its
 * tip there, as pi writes it.
 */
export function putLane(
  b: WriteDocs,
  lane: ThreadId,
  tip: EntryId | null = null,
): void {
  putValue(
    b,
    setRecord(LANE, {
      lane,
      root: ROOT_ID,
      history: null,
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
  const rootDocs = new Map([[ROOT_ID, root]])
  const held = fakeRoots({ session, roots: rootDocs })
  return {
    session,
    root,
    live,
    docs: fakeDocuments({ session, live, places }),
    roots: held.step,
    leases: held.leases,
    rootsLoaded: () => [...rootDocs.keys()],
    places,
    log: m => lines.push(m),
    // A uuidv7's shape, as the host's minter gives: a card's id is parsed.
    newId: () =>
      `01a0ffd2-0000-7000-8000-${(++n).toString(16).padStart(12, "0")}`,
    now: () => 1_000,
    lines,
  }
}

/** A host whose queued cards all hold text: none is blank (`blankQueued`). */
export const NO_BLANK_CARDS = {
  blankQueued: async () => new Set<CardId>(),
} as const

/** The canvas the test's root's threads are in, unless it makes another. */
export const CANVAS_ID: CanvasId = canvasIdFor(
  "01a0ffd2-0000-7000-8000-00000000000a",
)

/**
 * A note column on `canvas`'s canvas, after its last card: where a test's notes
 * are.
 */
export function putNoteColumn(
  b: Pick<FakeBasics, "places">,
  column: NoteColumnId,
  canvas: CanvasId = CANVAS_ID,
): void {
  seedPlaces(b.places, [
    {
      kind: "write",
      record: {
        kind: "note-column",
        id: column,
        owner: STARTER,
        placer: STARTER,
        place: {
          kind: "canvas",
          canvas,
          order: orderAfter(cardsOnCanvas(readPlaces(b.places), canvas)),
          width: 1,
        },
        content: UNTICKED,
      },
    },
  ])
}

/**
 * The step that puts `canvas`'s card on the board in `state`, placed by `by`:
 * made, at the end of its state, when there is none; moved, keeping its
 * rank, when it is elsewhere; none when it is there already.
 */
function canvasCardStep(
  cards: readonly CardRecord[],
  canvas: CanvasId,
  state: WorkflowStateId,
  by: WriterId,
): readonly PlaceStep[] {
  const now = cards.find(c => c.id === canvas)
  if (now === undefined)
    return [
      {
        kind: "write",
        record: makeCard(
          "canvas",
          canvas,
          {
            kind: "board",
            state,
            order: orderAfter(cards.filter(isBoardCard)),
          },
          STATE_UNCHANGED,
          by,
        ),
      },
    ]
  if (now.kind !== "canvas" || (isBoardCard(now) && now.place.state === state))
    return []
  const order = isBoardCard(now) ? now.place.order : orderAfter([])
  return [
    {
      kind: "write",
      record: { ...now, place: { kind: "board", state, order }, placer: by },
    },
  ]
}

/**
 * `canvas`'s card on the board in `state`, put there by `by` at `at`, as its
 * card's history says: how a test archives a canvas. A card already there is not
 * written again.
 */
export function placeCanvas(
  b: WriteDocs & Pick<FakeBasics, "places">,
  canvas: CanvasId,
  state: WorkflowStateId,
  by: WriterId,
  at = 1,
): void {
  const steps = canvasCardStep(readPlaces(b.places), canvas, state, by)
  if (steps.length > 0) seedPlaces(b.places, steps)
  putValue(
    b,
    setRecord(CARD_HISTORY, {
      card: canvas,
      events: [
        { kind: "moved", by, from: null, to: { kind: "board", state }, at },
      ],
    }),
  )
}

/** The board state `putCanvas` puts a canvas's card in, by default. */
const CANVAS_STATE = workflowStateIdFor("open")

/** The archive's state in the workflow `archiveCanvas` writes. */
const ARCHIVE_STATE = workflowStateIdFor("done")

/** Who archives a canvas in `archiveCanvas`, unless a test names another. */
const ARCHIVER = writerId("archiver@example.com")

/**
 * `canvas` moved into the archive by `by`: the workflow of `CANVAS_STATE` and
 * `ARCHIVE_STATE` written first when the session has none.
 */
export function archiveCanvas(
  b: WriteDocs & Pick<FakeBasics, "places">,
  canvas: CanvasId = CANVAS_ID,
  by: WriterId = ARCHIVER,
): void {
  if (readWorkflow(b.session) === null)
    putValue(
      b,
      setRecord(
        WORKFLOW,
        testWorkflow([{ id: CANVAS_STATE, name: "Doing" }], {
          id: ARCHIVE_STATE,
          name: "Done",
        }),
      ),
    )
  placeCanvas(b, canvas, ARCHIVE_STATE, by, 2)
}

/**
 * A canvas as a thread's opening makes one (`planThreadOpen`): its card on
 * the board in `state`, the thread's record, and the thread's card on its
 * canvas, in `root`.
 */
export function putCanvas(
  b: WriteDocs & Pick<FakeBasics, "places">,
  thread: ThreadId,
  canvas: CanvasId = CANVAS_ID,
  root: RootId = ROOT_ID,
  state: WorkflowStateId = CANVAS_STATE,
): void {
  const cards = readPlaces(b.places)
  // A canvas already made keeps its place, wherever a test put it.
  const made = cards.some(c => c.id === canvas)
    ? []
    : canvasCardStep(cards, canvas, state, STARTER)
  const opened = planThreadOpen({
    thread,
    origin: ROOT_ORIGIN,
    root,
    by: STARTER,
    now: 0,
    placement: { kind: "after", canvas, parent: null },
    opens: null,
    cards,
  })
  if (opened.kind !== "open") return
  applyWrites(b, opened.records)
  seedPlaces(b.places, [...made, ...opened.steps])
}

/**
 * `lane` as a run may start on it, proven as a host with no tools proves
 * every lane (`proveRunnable`): for tests whose runs never meet a lane of
 * another kind.
 */
export function runnableFor(lane: ThreadId): RunnableLane {
  const proved = proveRunnable(lane, undefined, null)
  if (typeof proved === "object") throw new Error("every lane runs here")
  return proved
}

/** Lane work whose every lane may run (`runnableFor`). */
export const RUNS_ANY: Pick<LaneWork, "runnable"> = {
  runnable: lane => runnableFor(lane),
}

/**
 * `send` cleared through the real gate (`planGate`), over a session with no
 * cards, no archive and no lane records, and an empty tree for the root a
 * branch reads (its own): for tests of what happens after the gate. Throws
 * for a send it refuses.
 */
export function clearedSend(send: Send): Cleared<Send> {
  const plan = planGate(send, {
    canvases: indexCanvases([], new Map()),
    cards: [],
    archived: new Map(),
    lanes: new Map(),
    kind: null,
    roots: new Map([
      [send.root, { index: indexTree({}), revisions: new Map() }],
    ]),
  })
  if (plan.kind !== "cleared")
    throw new Error(`a test's send was not cleared: ${plan.kind}`)
  return plan.command
}

/** Hooks that read no records and record nothing: a test's setup. */
const NO_HOOKS: ProvenanceHooks = {
  gather: () => ({ histories: new Map(), traces: [], reading: [] }),
  write: async () => {},
  changed: () => {},
  taken: async () => {},
}

/**
 * Write `steps` as a test's setup does: through the real writer, at once
 * (a change's body runs synchronously), recording no history and destroying
 * no text.
 */
export function seedPlaces(
  places: PlacesDocHandle,
  steps: readonly PlaceStep[],
  gesture?: Gesture,
): void {
  void createPlaces({
    basics: {
      places,
      session: newSessionDoc(),
      now: () => 0,
      newId: () => "seed",
      log: () => {},
    },
    readingCanvases: () => [],
    provenance: NO_HOOKS,
    texts: { destroy: async () => {} },
  }).change({ kind: "host" }, open => open.apply(steps, gesture))
}

/**
 * The real writer of the places over `b`, with its provenance: records
 * written into `b`'s documents unless `records` is given, presence empty
 * unless given, and texts destroyed by `texts` (none, by default).
 */
export function placesFor(
  b: FakeBasics,
  input: {
    readonly presence?: PresenceDocHandle
    readonly records?: Pick<Records, "writeValues">
    readonly texts?: Pick<CardPort, "destroy">
  } = {},
): { readonly placesWriter: Places; readonly provenance: Provenance } {
  const { provenance, hooks } = createProvenance({
    basics: b,
    presence: input.presence ?? newPresenceDoc(),
    records: input.records ?? { writeValues: async w => applyWrites(b, w) },
  })
  const placesWriter = createPlaces({
    basics: b,
    readingCanvases: () =>
      readReadingCanvases(input.presence ?? newPresenceDoc()).values(),
    provenance: hooks,
    texts: input.texts ?? { destroy: async () => {} },
  })
  return { placesWriter, provenance }
}

/** An open change's `apply` that writes as `seedPlaces` does: a test's pop. */
export const seedChange = (
  places: PlacesDocHandle,
): Pick<OpenChange, "apply"> => ({
  apply: (steps, gesture) => {
    seedPlaces(places, steps, gesture)
    return places.rev()
  },
})

/**
 * A documents' keeper whose every step is handed `b.roots`, read when the
 * step opens, and `over` over it: a test records a step's writes so.
 */
export const stepKeeper = (
  b: Pick<FakeBasics, "roots">,
  over: Partial<StepDocs> = {},
) =>
  createKeeper<HostKey, StepDocs>({
    context: { open: () => ({ ...b.roots, ...over }), close: () => {} },
  })

/** The roots' store over an in-memory Exchange, with the keeper its upkeep runs on. */
export function hostRoots(
  input: {
    readonly session?: ReturnType<typeof basics>["session"]
    readonly peers?: PeerStates
    readonly failed?: (error: unknown) => void
    readonly keepLastRead?: boolean
    readonly trace?: RootTrace
    readonly sizes?: Parameters<typeof createRoots>[0]["sizes"]
    readonly running?: () => ReadonlySet<RootId>
  } = {},
) {
  const exchange = new Exchange({
    principal: "pinetrie-host",
    store: createInMemoryStore(),
  })
  // Each compaction, by document id, in order.
  const compacted: string[] = []
  const compact = exchange.compact.bind(exchange)
  exchange.compact = async id => {
    compacted.push(id)
    await compact(id)
  }
  const session = input.session ?? basics().session
  const roots = createRoots({
    exchange,
    session,
    queueUpkeep: () =>
      void queueUpkeepOn(keeper, async step => {
        await roots.upkeep(step)
      }),
    ...(input.peers === undefined ? {} : { peers: input.peers }),
    ...(input.failed === undefined ? {} : { failed: input.failed }),
    ...(input.keepLastRead === undefined
      ? {}
      : { keepLastRead: input.keepLastRead }),
    ...(input.trace === undefined ? {} : { trace: input.trace }),
    ...(input.sizes === undefined ? {} : { sizes: input.sizes }),
    ...(input.running === undefined ? {} : { running: input.running }),
  })
  const keeper = createKeeper<HostKey, StepDocs>({ context: roots.context })
  return {
    exchange,
    roots,
    keeper,
    session,
    compacted,
  }
}

/** Whether a tab holds each root, set by hand: no tab for a root it names nothing for. */
export function handPeers(): PeerStates & {
  set(doc: RootDocHandle, held: boolean): void
} {
  const held = new Set<RootDocHandle>()
  const watchers = new Map<RootDocHandle, Set<() => void>>()
  return {
    held: doc => held.has(doc),
    watch(doc, changed) {
      const set = watchers.get(doc) ?? new Set()
      set.add(changed)
      watchers.set(doc, set)
      return () => set.delete(changed)
    },
    set(doc, now) {
      if (now) held.add(doc)
      else held.delete(doc)
      for (const changed of watchers.get(doc) ?? []) changed()
    },
  }
}
