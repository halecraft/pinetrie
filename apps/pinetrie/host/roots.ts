// host/roots — every root's document the host holds, and the one way to reach
// one.
//
// A root is reached only through a step's documents (`StepDocs`), which the
// documents' keeper hands each step (`context`) and revokes as it ends, or
// through a `Lease`: taken in a step, or outside one by work that runs off the
// keeper (`leases`), and disposed when done. pi's port (`pi`) answers only for
// a root one of them holds. One upkeep step (`upkeep`, the keeper's `later`)
// compacts what runs changed and lets go of every loaded root that no lease
// and no tab holds. Nothing else unloads a root. So, by construction:
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
  type SessionDocHandle,
} from "@pinetrie/schema"
import type { HostKeeper } from "./basics.ts"
import { createStepRecords, type StepRecords } from "./records.ts"

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

/**
 * One upkeep: the loaded roots runs changed and every root it lets go are
 * compacted, then the session's documents when a settle asked; every loaded
 * root no lease and no tab holds is let go; each root a tab holds, not
 * watched yet, is watched. A root let go earlier was compacted as it went.
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
      ...(input.settled === null
        ? []
        : [SESSION_DOC_ID, PLACES_DOC_ID, LIVE_DOC_ID]),
    ],
    unload,
    watch: input.loaded
      .filter(r => input.shown.has(r) && !input.watching.has(r))
      .sort(),
  }
}

/**
 * Where the tabs holding a root are: one still taking it (`pending`), else
 * one holding it (`synced`), else none.
 */
export type PeerState = "pending" | "synced" | "none"

/** The tabs' states for a root, and a way to hear them change. */
export interface PeerStates {
  state(doc: RootDocHandle): PeerState
  /** Call `changed` at each change of the root's peers; returns the stop. */
  watch(doc: RootDocHandle, changed: () => void): () => void
}

/** Kyneta's peer states. */
export const kynetaPeers: PeerStates = {
  state(doc) {
    const states = sync(doc).peerStates
    if (states.some(s => s.state === "pending")) return "pending"
    return states.some(s => s.state === "synced") ? "synced" : "none"
  },
  watch: (doc, changed) => sync(doc).onPeerSyncChange(() => changed()),
}

/** A loaded root. */
interface Loaded {
  readonly doc: RootDocHandle
  readonly ready: Promise<RootDocHandle>
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
  readonly pi: Pick<AgentDocuments, "root" | "rootOfLane">
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
   * Each root loaded in this host's life, by id, with its newest handle: a
   * handle Kyneta has let go reads its last value, and only the host writes
   * a root, only while it is loaded, so that value is the stored one. For
   * the suites' synchronous reads; a destroyed root is not among them.
   */
  lastRead(): ReadonlyMap<RootId, RootDocHandle>
  /** Stop following the documents Kyneta loads. */
  close(): void
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
  readonly peers?: PeerStates
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
    newest.set(root, doc)
    const entry: Loaded = {
      doc,
      ready: exchange.whenHydrated(id).then(() => {
        if (loaded.get(root) === entry) {
          entry.heard = true
          for (const listener of opened) listener(root, doc)
          if (!everLoaded.has(root)) {
            everLoaded.add(root)
            for (const listener of firstLoad) listener(root)
          }
        }
        return doc
      }),
      asked,
      heard: false,
    }
    loaded.set(root, entry)
    input.queueUpkeep()
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
        load(root, true)
      })
    }
  })

  /** Count a lease on `root` at once, then load it if it is not. */
  function lease(r: RootId): Lease {
    const entry = load(r, false)
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
      return load(r, false).ready
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
        const entry = loaded.get(root)
        if (
          entry === undefined ||
          (!stepping.has(root) && (leases.get(root) ?? 0) === 0)
        )
          throw new NotHeld(root)
        return entry.ready
      },
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
        const state = peers.state(entry.doc)
        if (state !== "none") entry.asked = false
        if (state !== "none" || entry.asked) shown.add(root)
      }
      const settled = settledRoots
      settledRoots = null
      // plan
      const plan = planUpkeep({
        settled,
        loaded: [...loaded.keys()],
        leased: new Set(leases.keys()),
        shown,
        watching: new Set(watching.keys()),
      })
      // execute: each root released before it is compacted, so what its
      // holders write as they let go is in its compaction, then let go
      const going = new Set(plan.unload)
      for (const root of plan.unload) {
        loaded.delete(root)
        watching.get(root)?.()
        watching.delete(root)
        await release(root, "unload")
      }
      for (const id of plan.compact)
        await exchange.compact(id).catch((error: unknown) => {
          input.failed?.(error)
        })
      // Decided again after the last await: a lease taken off the keeper
      // meanwhile loaded the root again, and keeps it.
      for (const root of going)
        if (!loaded.has(root)) exchange.unload(rootDocId(root))
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
