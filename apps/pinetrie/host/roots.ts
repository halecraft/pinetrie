// host/roots — every root's document the host holds, and the one way to reach
// one.
//
// A root is reached only through a step's documents (`StepDocs`), which the
// documents' keeper hands each step (`context`) and revokes as it ends, or
// through a `Lease`: taken in a step, or outside one by work that runs off the
// keeper (`leases`), and disposed when done. pi's port (`pi`) answers only for
// a root one of them holds, and its scratch document with it. One upkeep step
// (`upkeep`, the keeper's `later`) compacts what runs changed and is due, lets
// go of every loaded root that no lease and no tab holds, and destroys each
// empty scratch document in a root no lane runs in. Nothing else unloads a
// root. So, by construction:
//
// - L1. A root a step loaded stays loaded until the step ends: only the
//   upkeep step unloads, and it is a step of the same keeper.
// - L2. A leased root stays loaded while its lease lives: a lease is counted
//   the moment it is taken, the upkeep step leaves leased roots, and it
//   decides each unload again, synchronously, after its last await.
// - L3. With the keeper idle, no lease held and no tab holding one, no root is
//   loaded: every load and every release queues the upkeep step, which runs
//   after every step queued before it.
//
// A tab holding a root keeps it loaded: let go, the tab asks for it again,
// and the host loads it again, with no end. A tab that lets a root go
// destroys its copy, which the host hears, and the upkeep runs again.

import { type Exchange, sync } from "@kyneta/exchange"
import {
  type RootId,
  rootDocId,
  rootOfDocId,
  scratchDocId,
  type ThreadId,
} from "@pinetrie/core"
import type { StepContext } from "@pinetrie/keeper"
import type { AgentDocuments } from "@pinetrie/pi"
import {
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import { readLaneRecords, readRoots } from "@pinetrie/reads"
import {
  RootDoc,
  type RootDocHandle,
  ScratchDoc,
  type ScratchDocHandle,
  type SessionDocHandle,
} from "@pinetrie/schema"
import type { HostKeeper } from "./basics.ts"
import { createStepRecords, type StepRecords } from "./records.ts"
import { callerNow, type RootTrace } from "./root-trace.ts"
import type { StoredSize } from "./store.ts"

/** A call through a step's documents after the step ended. */
export class StepEnded extends Error {
  constructor() {
    super("a step's documents were used after the step ended")
    this.name = "StepEnded"
  }
}

/** pi asked for a root no step and no lease holds. */
export class NotHeld extends Error {
  constructor(root: RootId) {
    super(`${root} is held by no step and no lease`)
    this.name = "NotHeld"
  }
}

/** A root kept loaded until the lease is disposed. */
export interface Lease extends AsyncDisposable {
  readonly root: RootId
  /** The root's document: hydrated once `ready` settles. */
  readonly doc: RootDocHandle
  readonly ready: Promise<RootDocHandle>
  /** The session's records and this root's; a write to another root throws. */
  readonly records: StepRecords
}

/**
 * Leases for work off the documents' keeper, which must not wait on a step:
 * a lane's queue that a step awaits, a turn's records that a fork awaits.
 */
export interface Leases {
  root(root: RootId): Lease
  /** The lane's root, leased; null for a lane with no `LANE` record. */
  lane(lane: ThreadId): Lease | null
}

/** What a step reaches the roots through, until it ends. */
export interface StepDocs {
  /** The root's document, loaded. */
  root(root: RootId): Promise<RootDocHandle>
  /** The lane's root, loaded; null for a lane with no `LANE` record. */
  lane(
    lane: ThreadId,
  ): Promise<{ readonly root: RootId; readonly doc: RootDocHandle } | null>
  /** Hold the root past this step, loading it if it is not. */
  lease(root: RootId): Lease
  /** Destroy the root's document, in memory and in the store; refused for a leased root. */
  destroy(root: RootId): Promise<void>
  /** Every record's writer: a root's through `root`. */
  readonly records: StepRecords
}

/**
 * Queue the upkeep on the documents' keeper: its `later`, so it starts only
 * once no command, drain or refresh waits, and compacts records that hold
 * every change queued before it. Merged by key: one waiting covers every
 * caller.
 */
export const queueUpkeepOn = (
  keeper: Pick<HostKeeper, "later">,
  body: (step: StepDocs) => Promise<void>,
): Promise<void> => keeper.later("upkeep", body)

/** What one upkeep does: compact, let go, and watch the roots a tab holds. */
export interface UpkeepPlan {
  /** Document ids, in order. */
  readonly compact: readonly string[]
  readonly unload: readonly RootId[]
  readonly watch: readonly RootId[]
}

/** The session's documents, compacted after a settle when due. */
const SESSION_DOCUMENTS = [SESSION_DOC_ID, PLACES_DOC_ID, LIVE_DOC_ID] as const

/** The most records a document keeps beyond its whole one before it is compacted. */
const MOST_AFTER_WHOLE = 1000

/**
 * Whether compacting a document is worth what it costs: once what it stores
 * beyond its whole record outweighs that record, or counts more than
 * `MOST_AFTER_WHOLE` records. A compaction reads and rewrites the whole
 * document, and costs with the number of records it reads; what it saves is
 * the records a load replays.
 */
export const isCompactionDue = (size: StoredSize): boolean =>
  size.after.bytes > size.whole || size.after.count > MOST_AFTER_WHOLE

/**
 * One upkeep: the loaded roots runs changed and every root it lets go are
 * its candidates for compaction, then the session's documents when a settle
 * asked; every loaded root no lease and no tab holds is let go; each root a
 * tab holds, not watched yet, is watched. Which candidates are compacted is
 * `dueCompactions`'. The candidates are built from roots' ids and the
 * session's three alone, so a scratch document is never one.
 */
export function planUpkeep(input: {
  /** The roots runs changed since the last upkeep, when a settle asked for one; else null. */
  readonly settled: ReadonlySet<RootId> | null
  readonly loaded: readonly RootId[]
  readonly leased: ReadonlySet<RootId>
  /** The loaded roots a tab holds, or is taking. */
  readonly shown: ReadonlySet<RootId>
  readonly watching: ReadonlySet<RootId>
}): UpkeepPlan {
  const unload = input.loaded
    .filter(r => !input.leased.has(r) && !input.shown.has(r))
    .sort()
  const loaded = new Set(input.loaded)
  const changed =
    input.settled === null ? [] : [...input.settled].filter(r => loaded.has(r))
  const roots = [...new Set([...changed, ...unload])].sort()
  return {
    compact: [
      ...roots.map(rootDocId),
      ...(input.settled === null ? [] : SESSION_DOCUMENTS),
    ],
    unload,
    watch: input.loaded
      .filter(r => input.shown.has(r) && !input.watching.has(r))
      .sort(),
  }
}

/**
 * The candidates whose compaction is due (`isCompactionDue`), in order; with
 * no sizes (a store that cannot say), every one.
 */
export const dueCompactions = (
  candidates: readonly string[],
  sizes: ReadonlyMap<string, StoredSize> | null,
): readonly string[] =>
  sizes === null
    ? candidates
    : candidates.filter(id => {
        const size = sizes.get(id)
        return size !== undefined && isCompactionDue(size)
      })

/**
 * The roots whose scratch document the upkeep destroys: each one empty, in a
 * root no lane runs in. One that holds something (a run a crash ended)
 * stays for the next run there to recover.
 */
export function planScratchDestroys(input: {
  /** Each loaded root with a scratch document, and whether it is empty. */
  readonly scratch: ReadonlyMap<RootId, { readonly empty: boolean }>
  readonly running: ReadonlySet<RootId>
}): readonly RootId[] {
  return [...input.scratch]
    .filter(([root, { empty }]) => empty && !input.running.has(root))
    .map(([root]) => root)
    .sort()
}

/** Whether a scratch document holds nothing: pi's cleanup has deleted every pending value and list. */
const isEmptyScratch = (doc: ScratchDocHandle): boolean =>
  doc.values.keys().length === 0 &&
  doc.lists.keys().length === 0 &&
  doc.checkpointText.keys().length === 0

/** Whether a tab holds a root, taking it or having it, and a way to hear that change. */
export interface PeerStates {
  held(doc: RootDocHandle): boolean
  /** Call `changed` at each change of the root's peers; returns the stop. */
  watch(doc: RootDocHandle, changed: () => void): () => void
}

/** Kyneta's peers: a tab is `pending` while it takes a root, `synced` once it has it. */
const kynetaPeers: PeerStates = {
  held: doc =>
    sync(doc).peerStates.some(
      s => s.state === "pending" || s.state === "synced",
    ),
  watch: (doc, changed) => sync(doc).onPeerSyncChange(() => changed()),
}

/** A loaded root. */
interface Loaded {
  readonly doc: RootDocHandle
  /**
   * Resolves once the root and its scratch document, when the store holds
   * one, have both arrived. pi is handed a root only through it, so
   * recovery after a crash always reads the scratch document.
   */
  readonly ready: Promise<RootDocHandle>
  /** Its scratch document: the one stored, or one a pending write made; none between runs. */
  scratch: ScratchDocHandle | undefined
  /**
   * Loaded for a tab's ask and not yet seen held by one: kept as shown
   * before Kyneta lists the tab, or it would go before the tab has it.
   */
  asked: boolean
  /** Its `onOpened` listeners have heard it. */
  heard: boolean
}

export interface Roots {
  /** The documents' keeper's step context: each step's `StepDocs`. */
  readonly context: StepContext<StepDocs>
  /** pi's port: only a root a step or a lease holds. */
  readonly pi: Pick<
    AgentDocuments,
    "root" | "rootOfLane" | "scratch" | "makeScratch" | "stored"
  >
  /** Leases taken off the keeper. */
  readonly leases: Leases
  /**
   * Call `listener` for every root loaded now, then for each as it loads (a
   * root let go and loaded again is heard again), once it is hydrated.
   */
  onOpened(listener: (root: RootId, doc: RootDocHandle) => void): void
  /**
   * Call `listener` as a root is about to be let go (`unload`, in the upkeep)
   * or destroyed, in the order listeners joined: whatever holds it lets go,
   * so nothing writes to a closed document.
   */
  onReleasing(
    listener: (root: RootId, why: "unload" | "destroy") => Promise<void>,
  ): void
  /** Call `listener` the first time each root loads in this host's life. */
  onFirstLoad(listener: (root: RootId) => void): void
  /** Roots runs changed: the next upkeep compacts them, and the session's documents. */
  settled(roots: Iterable<RootId>): void
  /**
   * The upkeep step's body, run only as the keeper's `later("upkeep")`: its
   * argument is the step's documents, which only a step has. Says whether a
   * settle asked for it.
   */
  upkeep(step: StepDocs): Promise<{ readonly settled: boolean }>
  /** The roots loaded now, by id. */
  loaded(): readonly RootId[]
  /**
   * With `keepLastRead`, each root loaded in this host's life, by id, with
   * its newest handle: a handle Kyneta has let go reads its last value, and
   * only the host writes a root, only while it is loaded, so that value is
   * the stored one. For the suites' synchronous reads; empty without it,
   * since a handle kept keeps the root's last value in memory. A destroyed
   * root is not among them.
   */
  lastRead(): ReadonlyMap<RootId, RootDocHandle>
  /** Stop following the documents Kyneta loads. */
  close(): void
}

/** One compaction the upkeep ran. */
export interface Compaction {
  readonly docId: string
  /** The records it read, and their bytes, as the store said before it. */
  readonly records: number
  readonly bytes: number
  readonly ms: number
}

export function createRoots(input: {
  readonly exchange: Exchange
  readonly session: SessionDocHandle
  /** Queue the keeper's `later("upkeep")`, bound once the keeper exists. */
  readonly queueUpkeep: () => void
  /**
   * Hears a compaction that failed. The upkeep goes on: a root whose
   * compaction failed is let go all the same, since Kyneta unloads it only
   * once the store holds every write.
   */
  readonly failed?: (error: unknown) => void
  /** What each document stores beside its whole record; null for a store that cannot say, whose candidates are each compacted. */
  readonly sizes?:
    | ((docIds: readonly string[]) => ReadonlyMap<string, StoredSize>)
    | null
  /** The roots a lane runs in now: their scratch documents are kept. */
  readonly running?: () => ReadonlySet<RootId>
  /** Hears each compaction the upkeep ran: its document, the records and bytes it read, and how long it took. */
  readonly compacted?: (compaction: Compaction) => void
  readonly peers?: PeerStates
  /** Keep each root's newest handle for `lastRead`: a suite's, never a host's in use. */
  readonly keepLastRead?: boolean
  /** Hears each use of a root, each lease's end and each upkeep's plan. */
  readonly trace?: RootTrace
}): Roots {
  const { exchange, session } = input
  const peers = input.peers ?? kynetaPeers
  const loaded = new Map<RootId, Loaded>()
  const leases = new Map<RootId, number>()
  /** The roots the running step loaded. */
  let stepping = new Set<RootId>()
  const everLoaded = new Set<RootId>()
  const newest = new Map<RootId, RootDocHandle>()
  const watching = new Map<RootId, () => void>()
  let settledRoots: Set<RootId> | null = null
  const opened: ((root: RootId, doc: RootDocHandle) => void)[] = []
  const releasing: ((
    root: RootId,
    why: "unload" | "destroy",
  ) => Promise<void>)[] = []
  const firstLoad: ((root: RootId) => void)[] = []

  /** Load `root` if it is not, and queue the upkeep that may let it go. */
  function load(root: RootId, asked: boolean): Loaded {
    const known = loaded.get(root)
    if (known !== undefined) return known
    const id = rootDocId(root)
    const doc = exchange.get(id, RootDoc)
    if (input.keepLastRead === true) newest.set(root, doc)
    // `open` never makes a scratch document: one is made by a pending write.
    const stored = exchange.open(scratchDocId(root), ScratchDoc)
    const entry: Loaded = {
      doc,
      ready: Promise.all([exchange.whenHydrated(id), stored]).then(([, s]) => {
        if (loaded.get(root) === entry) {
          if (s !== undefined) entry.scratch ??= s
          entry.heard = true
          for (const listener of opened) listener(root, doc)
          if (!everLoaded.has(root)) {
            everLoaded.add(root)
            for (const listener of firstLoad) listener(root)
          }
        }
        return doc
      }),
      scratch: undefined,
      asked,
      heard: false,
    }
    loaded.set(root, entry)
    input.queueUpkeep()
    return entry
  }

  /** `load`, told to the trace as a use of `root` through `via`. */
  function use(root: RootId, via: "step" | "lease" | "tab"): Loaded {
    const fresh = !loaded.has(root)
    const entry = load(root, via === "tab")
    input.trace?.({
      kind: "use",
      root,
      via,
      loaded: fresh,
      caller: callerNow(),
    })
    return entry
  }

  /** Run the release listeners. */
  async function release(
    root: RootId,
    why: "unload" | "destroy",
  ): Promise<void> {
    for (const listener of releasing) await listener(root, why)
  }

  // A root Kyneta loads for a tab's ask, the host's authority policy
  // answering it, is followed as any other. Taken a microtask later: Kyneta
  // announces the change from inside its own step.
  const stopFollowing = exchange.documents.subscribe(changeset => {
    for (const change of changeset.changes) {
      if (change.type !== "doc-promoted" && change.type !== "doc-created")
        continue
      const root = rootOfDocId(change.docId)
      if (root === undefined) continue
      queueMicrotask(() => {
        // Only a root the directory names: a tab announces the root it
        // mints before its first send, and loading that one would make the
        // directory record it, so its send would find its id in use.
        if (loaded.has(root) || !readRoots(session).has(root)) return
        if (exchange.documents.get(change.docId)?.mode !== "interpret") return
        use(root, "tab")
      })
    }
  })

  /** Count a lease on `root` at once, then load it if it is not. */
  function lease(r: RootId): Lease {
    const entry = use(r, "lease")
    leases.set(r, (leases.get(r) ?? 0) + 1)
    let held = true
    return {
      root: r,
      doc: entry.doc,
      ready: entry.ready,
      records: createStepRecords({
        session,
        root: async other => {
          if (other !== r)
            throw new Error(`a lease on ${r} wrote into ${other}`)
          return entry.ready
        },
      }),
      async [Symbol.asyncDispose]() {
        if (!held) return
        held = false
        input.trace?.({ kind: "release", root: r })
        const n = (leases.get(r) ?? 1) - 1
        if (n > 0) leases.set(r, n)
        else leases.delete(r)
        input.queueUpkeep()
      },
    }
  }

  function stepDocs(): { readonly docs: StepDocs; end(): void } {
    let live = true
    const ensure = () => {
      if (!live) throw new StepEnded()
    }
    const root = async (r: RootId): Promise<RootDocHandle> => {
      ensure()
      stepping.add(r)
      return use(r, "step").ready
    }
    const docs: StepDocs = {
      root,
      async lane(lane) {
        ensure()
        const r = readLaneRecords(session).get(lane)?.root
        return r === undefined ? null : { root: r, doc: await root(r) }
      },
      lease(r) {
        ensure()
        stepping.add(r)
        return lease(r)
      },
      async destroy(r) {
        ensure()
        if ((leases.get(r) ?? 0) > 0)
          throw new Error(`${r} is leased: it cannot be destroyed`)
        newest.delete(r)
        if (loaded.delete(r)) await release(r, "destroy")
        watching.get(r)?.()
        watching.delete(r)
        exchange.destroy(rootDocId(r))
        exchange.destroy(scratchDocId(r))
      },
      records: createStepRecords({ session, root }),
    }
    return {
      docs,
      end() {
        live = false
      },
    }
  }
  const ends = new WeakMap<StepDocs, () => void>()

  /** `root`'s entry, if a step or a lease holds it; else pi is refused it. */
  function held(root: RootId): Loaded {
    const entry = loaded.get(root)
    if (
      entry === undefined ||
      (!stepping.has(root) && (leases.get(root) ?? 0) === 0)
    )
      throw new NotHeld(root)
    return entry
  }

  return {
    context: {
      open() {
        stepping = new Set()
        const made = stepDocs()
        ends.set(made.docs, made.end)
        return made.docs
      },
      close(docs) {
        ends.get(docs)?.()
        stepping = new Set()
      },
    },
    pi: {
      async root(root) {
        return held(root).ready
      },
      scratch: root => held(root).scratch,
      async makeScratch(root) {
        const entry = held(root)
        if (entry.scratch !== undefined) return entry.scratch
        const id = scratchDocId(root)
        const made = exchange.get(id, ScratchDoc)
        // Kyneta refuses a write until the document has hydrated, even one
        // the store has never held.
        await exchange.whenHydrated(id)
        entry.scratch ??= made
        return entry.scratch
      },
      stored: () => exchange.flush(),
      rootOfLane: lane => readLaneRecords(session).get(lane)?.root ?? null,
    },
    leases: {
      root: lease,
      lane(l) {
        const r = readLaneRecords(session).get(l)?.root
        return r === undefined ? null : lease(r)
      },
    },
    onOpened(listener) {
      // A root heard already is heard now; one still loading, as it
      // finishes, by the listeners its load calls.
      for (const [root, entry] of loaded)
        if (entry.heard) listener(root, entry.doc)
      opened.push(listener)
    },
    onReleasing(listener) {
      releasing.push(listener)
    },
    onFirstLoad(listener) {
      firstLoad.push(listener)
    },
    settled(roots) {
      settledRoots ??= new Set()
      for (const root of roots) settledRoots.add(root)
      input.queueUpkeep()
    },
    async upkeep() {
      // gather: a root still hydrating is held as shown, so it is not let
      // go before its listeners hear it.
      const hydrated = new Map<RootId, Loaded>()
      for (const [root, entry] of loaded)
        if (exchange.hydrated(rootDocId(root))) hydrated.set(root, entry)
      const shown = new Set<RootId>()
      for (const [root, entry] of loaded) {
        if (!hydrated.has(root)) {
          shown.add(root)
          continue
        }
        const held = peers.held(entry.doc)
        if (held) entry.asked = false
        if (held || entry.asked) shown.add(root)
      }
      const settled = settledRoots
      settledRoots = null
      // plan, then what is due of its candidates, by their sizes
      const plan = planUpkeep({
        settled,
        loaded: [...loaded.keys()],
        leased: new Set(leases.keys()),
        shown,
        watching: new Set(watching.keys()),
      })
      const sizes = input.sizes?.(plan.compact) ?? null
      const compact = dueCompactions(plan.compact, sizes)
      if (compact.length > 0 || plan.unload.length > 0)
        input.trace?.({
          kind: "upkeep",
          loaded: loaded.size,
          leased: leases.size,
          shown: [...shown].sort(),
          compact,
          unload: plan.unload,
        })
      // execute: each root released first, so what its holders write as
      // they let go is in a compaction that is due; then the compactions
      const going = new Map<RootId, Loaded>()
      for (const root of plan.unload) {
        const entry = loaded.get(root)
        if (entry !== undefined) going.set(root, entry)
        loaded.delete(root)
        watching.get(root)?.()
        watching.delete(root)
        await release(root, "unload")
      }
      for (const id of compact) {
        const size = sizes?.get(id)
        const started = performance.now()
        const done = await exchange.compact(id).then(
          () => true,
          (error: unknown) => {
            input.failed?.(error)
            return false
          },
        )
        if (done)
          input.compacted?.({
            docId: id,
            records: (size?.after.count ?? 0) + (size?.whole === 0 ? 0 : 1),
            bytes: (size?.after.bytes ?? 0) + (size?.whole ?? 0),
            ms: performance.now() - started,
          })
      }
      // After the last await, with none until it ends: what is let go, and
      // which scratch documents are empty in a root no lane runs in, is
      // read, decided and acted on at once, so what was decided is still
      // true when it acts. A root a lease took off the keeper meanwhile
      // loaded again is kept.
      const leaving = [...going].filter(([root]) => !loaded.has(root))
      const scratch = new Map<RootId, { readonly empty: boolean }>()
      for (const [root, entry] of [...loaded, ...leaving])
        if (entry.scratch !== undefined)
          scratch.set(root, { empty: isEmptyScratch(entry.scratch) })
      const destroyed = new Set(
        planScratchDestroys({
          scratch,
          running: input.running?.() ?? new Set(),
        }),
      )
      for (const root of destroyed) {
        const entry = loaded.get(root)
        if (entry !== undefined) entry.scratch = undefined
        exchange.destroy(scratchDocId(root))
      }
      for (const [root, entry] of leaving) {
        exchange.unload(rootDocId(root))
        if (entry.scratch !== undefined && !destroyed.has(root))
          exchange.unload(scratchDocId(root))
      }
      for (const root of plan.watch) {
        const entry = loaded.get(root)
        if (entry === undefined) continue
        watching.set(
          root,
          peers.watch(entry.doc, () => input.queueUpkeep()),
        )
      }
      return { settled: settled !== null }
    },
    loaded: () => [...loaded.keys()],
    lastRead: () => newest,
    close() {
      stopFollowing()
      for (const stop of watching.values()) stop()
      watching.clear()
    },
  }
}
